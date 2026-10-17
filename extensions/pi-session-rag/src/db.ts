import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BSON, GridFSBucket, MongoClient, ObjectId, type Collection, type Db, type Document } from "mongodb";
import { loadProjectEnv, loadEmbeddingFile, currentEmbeddingPolicy, embeddingPolicyId, type EmbeddingRecord } from "./embedding.ts";

export interface MongoConfig {
  uri: string;
  database: string;
  projectId: string;
}

export interface UploadResult {
  status: "created" | "reused" | "repaired";
  documentId: string;
  database: string;
  totalChunks: number;
  insertedChunks: number;
  reusedChunks: number;
  elapsedMs: number;
}

interface MongoOptions {
  signal: AbortSignal;
  clientFactory?: (uri: string) => MongoClient;
}

interface UploadOptions extends MongoOptions {
  onProgress?: (completed: number, total: number) => void;
}

export interface SourceReference {
  ordinal: number;
  userEntryId: string;
  assistantEntryIds: string[];
}

interface SourceSection {
  start: number;
  end: number;
  reference: SourceReference;
}

interface RagDocument extends Document {
  _id: string;
}

export interface SearchIndexState { name: string; status: string; queryable: boolean }

export interface SearchIndexResult { status: "ready" | "building"; indexes: SearchIndexState[]; created: string[] }

interface IndexOptions extends MongoOptions {
  onProgress?: (stage: string) => void;
}

interface LexicalCandidate { _id: string; score: number }

interface LexicalResult { candidates: LexicalCandidate[]; fragments: number; requests: number }

export interface SearchHit {
  evidenceKind: "generated-session-summary";
  validationStatus: "unverified";
  similarity: number;
  score: number;
  scoreBreakdown: { lexicalRank: number | null; vectorRanks: (number | null)[] };
  text: string;
  documentId: string;
  chunkId: string;
  projectId: string;
  sessionId: string;
  leafId: string | null;
  sourceHash: string;
  summaryHash: string;
  ordinal: number;
  start: number;
  end: number;
  sourceRefs: SourceReference[];
}

export interface SearchResult {
  hits: SearchHit[];
  limit: number;
  queryChunks: number;
  elapsedMs: number;
  mode: "hybrid";
  minSimilarity: number;
  warnings: string[];
}

export interface SearchOptions extends MongoOptions {
  limit?: number;
  sessionId?: string;
  onProgress?: (stage: string) => void;
}

interface RankedCandidate {
  id: string;
  score: number;
  lexicalRank: number | null;
  vectorRanks: (number | null)[];
}

const MAX_BSON_BYTES = 16 * 1024 * 1024;
const SEARCH_POLICY = currentEmbeddingPolicy();
const SEARCH_POLICY_ID = embeddingPolicyId(SEARCH_POLICY);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const VECTOR_INDEX_NAME = "pi_rag_vector_v1";
export const TEXT_INDEX_NAME = "pi_rag_text_v1";
export const MIN_SIMILARITY = 0.59;
export const SEARCH_INDEXES = [
  { name: VECTOR_INDEX_NAME, type: "vectorSearch", definition: { fields: [
    { type: "vector", path: "vector", numDimensions: SEARCH_POLICY.dimensions, similarity: "cosine" },
    ...["projectId", "policyId", "searchable", "documentId"].map(path => ({ type: "filter", path })),
  ] } },
  { name: TEXT_INDEX_NAME, type: "search", definition: {
    analyzer: "lucene.standard", mappings: { dynamic: false, fields: {
      text: { type: "string", indexOptions: "offsets", store: true, norms: "include" },
      projectId: { type: "token", normalizer: "none" },
      policyId: { type: "token", normalizer: "none" }, documentId: { type: "token", normalizer: "none" },
      searchable: { type: "boolean" },
    } },
  } },
] as const;
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const GRIDFS_WARNING = "GridFS 본문은 키워드 인덱스에 포함되지 않습니다. 벡터 검색으로 찾으며 반환 전에 원문을 검증합니다.";

class DbError extends Error {}
class InvalidEvidence extends Error {}

// 미설정은 로컬 저장만 뜻한다. 설정 일부가 빠졌을 때는 접속을 시도하지 않는다.
export async function loadMongoConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MongoConfig | undefined> {
  const values = await loadProjectEnv(cwd, env);
  const uri = values.MONGODB_URI?.trim();
  const database = values.MONGODB_DB?.trim();
  if (!uri && !database) return undefined;
  if (!uri || !database) {
    throw new Error("MongoDB 업로드에는 MONGODB_URI와 MONGODB_DB가 함께 필요합니다.");
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error("MONGODB_URI는 MongoDB 연결 문자열이어야 합니다.");
  }
  if (/[\/\\. "$*<>:|?\0]/.test(database)) {
    throw new Error("MONGODB_DB에 사용할 수 없는 문자가 있습니다.");
  }
  return { uri, database, projectId: values.MONGODB_PROJECT_ID?.trim() || basename(resolve(cwd)) };
}

// 완성된 로컬 결과만 적재한다. 같은 ID의 기존 본문·벡터는 덮어쓰지 않는다.
export async function uploadEmbedding(
  embeddingFile: string,
  config: MongoConfig,
  options: UploadOptions,
): Promise<UploadResult> {
  const started = performance.now();
  const { signal } = options;
  const { record, markdown } = await loadEmbeddingFile(embeddingFile, signal);
  const { source, sections } = readSource(markdown);
  const embedding = { format: record.format, model: record.model, dimensions: record.dimensions, tokenizer: record.tokenizer };
  const policyId = embeddingPolicyId(embedding);
  const documentId = hash(JSON.stringify({ projectId: config.projectId, sessionId: source.sessionId,
    sourceHash: source.sourceHash, summaryHash: record.summaryHash, policyId }));
  const manifest = { _id: documentId, schemaVersion: 1, projectId: config.projectId, ...source,
    summaryHash: record.summaryHash, embedding, policyId, chunkCount: record.chunks.length };
  const generation = { createdAt: record.createdAt, elapsedMs: record.elapsedMs, calls: record.calls };

  return withMongo(config, options, "업로드", async db => {
    const documents = db.collection<RagDocument>("rag_documents");
    const chunks = db.collection<RagDocument>("rag_chunks");
    await documents.createIndex({ projectId: 1, sessionId: 1, sourceHash: 1 });
    signal.throwIfAborted();
    await chunks.createIndex({ documentId: 1, ordinal: 1 }, { unique: true });
    signal.throwIfAborted();

    let existing = await documents.findOne({ _id: documentId }, { signal });
    let insertedDocument = false;
    if (!existing) {
      insertedDocument = await insertOnly(documents, { ...manifest, generation, state: "staging" }, signal);
      existing = await documents.findOne({ _id: documentId }, { signal });
    }
    assertFields(existing, manifest, "기존 MongoDB 문서의 출처·임베딩 정보가 다릅니다.");
    assertGeneration(existing!.generation);
    if (existing!.state !== "staging" && existing!.state !== "ready") {
      throw new DbError("기존 MongoDB 문서의 저장 상태가 올바르지 않습니다.");
    }

    let insertedChunks = 0;
    let needsRepair = existing!.state !== "ready";
    options.onProgress?.(0, record.chunks.length);
    for (const [ordinal, chunk] of record.chunks.entries()) {
      signal.throwIfAborted();
      const expected = chunkDocument(chunk, ordinal, manifest, sections);
      const saved = await saveChunk(db, chunks, expected, signal);
      insertedChunks += Number(saved.inserted);
      needsRepair ||= saved.searchable !== true;
      options.onProgress?.(ordinal + 1, record.chunks.length);
    }

    // 부분 저장이나 중간 편집을 완료로 인정하지 않는다. 실패해도 이전 ready는 유지한다.
    signal.throwIfAborted();
    if (await chunks.countDocuments({ documentId }, { signal }) !== record.chunks.length) {
      throw new DbError("MongoDB 청크 개수가 원본 임베딩과 다릅니다.");
    }
    const current = await loadEmbeddingFile(embeddingFile, signal);
    if (!isDeepStrictEqual(current.record, record) || current.markdown !== markdown) {
      throw new DbError("업로드 중 로컬 임베딩이나 요약이 바뀌었습니다. 다시 실행하세요.");
    }
    signal.throwIfAborted();
    if (existing!.state === "staging") {
      await documents.updateOne({ ...immutableFilter(manifest), state: "staging" },
        { $set: { state: "ready", uploadedAt: new Date() } });
    }
    signal.throwIfAborted();
    const ready = await documents.findOne({ _id: documentId }, { signal });
    assertFields(ready, manifest, "완료 확인 중 MongoDB 문서의 출처가 바뀌었습니다.");
    if (ready!.state !== "ready") throw new DbError("MongoDB 문서 저장을 완료하지 못했습니다.");
    if (needsRepair || insertedChunks) {
      const expectedIds = record.chunks.map(chunk => chunkId(documentId, chunk.id));
      await chunks.updateMany({ documentId, _id: { $in: expectedIds } }, { $set: { searchable: true } });
    }
    signal.throwIfAborted();
    if (await chunks.countDocuments({ documentId, searchable: true }, { signal }) !== record.chunks.length) {
      throw new DbError("MongoDB 청크의 검색 활성화를 완료하지 못했습니다. 다시 실행하세요.");
    }

    return { status: insertedDocument ? "created" : needsRepair || insertedChunks ? "repaired" : "reused",
      documentId, database: config.database, totalChunks: record.chunks.length, insertedChunks,
      reusedChunks: record.chunks.length - insertedChunks, elapsedMs: performance.now() - started };
  });
}

// 검색 엔진의 본문은 신뢰하지 않는다. 후보 ID만 받고 DB의 현재 본문·출처를 다시 확인한다.
export async function searchChunks(config: MongoConfig, query: string, vectors: number[][],
  options: SearchOptions): Promise<SearchResult> {
  const started = performance.now();
  const { signal } = options;
  const limit = options.limit ?? 10;
  if (typeof query !== "string" || !query.trim()) throw new DbError("검색 질문이 비어 있습니다.");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new DbError("검색 결과 수는 양의 정수여야 합니다.");
  if (!Array.isArray(vectors) || !vectors.length || vectors.some(vector => !validVector(vector))) {
    throw new DbError("검색 질문의 임베딩 벡터가 올바르지 않습니다.");
  }
  if (options.sessionId !== undefined && (typeof options.sessionId !== "string" || !options.sessionId.trim())) {
    throw new DbError("검색할 세션 ID가 비어 있습니다.");
  }
  const queryUnits = vectors.map(unitVector);

  return withMongo(config, options, "검색", async db => {
    const chunks = db.collection<RagDocument>("rag_chunks");
    const documents = db.collection<RagDocument>("rag_documents");
    const policyId = SEARCH_POLICY_ID;
    options.onProgress?.("인덱스 확인");
    await requireSearchIndexes(chunks, signal);

    const filter: Document = { projectId: config.projectId, policyId, searchable: true };
    const textFilters: Document[] = Object.entries(filter).map(([path, value]) => ({ equals: { path, value } }));
    if (options.sessionId !== undefined) {
      const parents = await documents.find({ projectId: config.projectId, policyId, state: "ready", sessionId: options.sessionId },
        { projection: { _id: 1 }, signal }).toArray();
      signal.throwIfAborted();
      const ids = parents.map(parent => parent._id).filter(validHash);
      if (!ids.length) return result([], [GRIDFS_WARNING], started, limit, vectors.length);
      filter.documentId = { $in: ids };
      textFilters.push({ in: { path: "documentId", value: ids } });
    }

    const vectorPipelines = vectors.map(queryVector => [
        { $vectorSearch: { index: VECTOR_INDEX_NAME, path: "vector", queryVector, exact: true, limit, filter } },
        { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
    ]);
    const run = async (pipeline: Document[]): Promise<LexicalCandidate[]> => {
      const cursor = chunks.aggregate<LexicalCandidate>(pipeline, { signal });
      try {
        const rows = await cursor.toArray();
        if (rows.some(row => !validCandidate(row))) throw new DbError("MongoDB 검색 후보 형식이 올바르지 않습니다.");
        return rows;
      }
      finally { await cursor.close().catch(() => {}); }
    };
    let lexicalFragments = 1;
    let lexicalRequests = 0;
    options.onProgress?.("하이브리드 검색");
    const searches = await Promise.allSettled([
      searchLexicalQuery(query, fragment => run([
        { $search: { index: TEXT_INDEX_NAME, compound: {
          must: [{ text: { path: "text", query: fragment, matchCriteria: "any" } }], filter: textFilters,
        } } }, { $limit: limit }, { $project: { _id: 1, score: { $meta: "searchScore" } } },
      ]), signal).then(result => {
        lexicalFragments = result.fragments;
        lexicalRequests = result.requests;
        return result.candidates;
      }),
      ...vectorPipelines.map(run),
    ]);
    signal.throwIfAborted();
    const failed = searches.find(search => search.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const branches = searches.map(search => (search as PromiseFulfilledResult<Document[]>).value);
    options.onProgress?.("유사도·근거 검증");
    let rejected = 0;
    let belowThreshold = 0;
    const ids = [...new Set(branches.flatMap(rows => rows.map(row => row._id)))];
    const initial = await readEvidence(chunks, documents, ids, signal);
    const similarities = new Map<string, number[]>();
    // BM25 후보도 현재 DB 벡터로 판정한다. 엔진의 정규화 점수나 RRF 점수를 유사도로 사용하지 않는다.
    for (const id of ids) {
      signal.throwIfAborted();
      const chunk = initial.chunks.get(id);
      if (!chunk || !validVector(chunk.vector)) { rejected++; continue; }
      const unit = unitVector(chunk.vector);
      const values = queryUnits.map(query => cosine(query, unit));
      similarities.set(id, values);
      if (values.every(value => value < MIN_SIMILARITY)) belowThreshold++;
    }
    const candidates = fuseRanks(branches.map((rows, branch) => rows.filter(row => {
      const values = similarities.get(row._id);
      return values && (branch === 0 ? values.some(value => value >= MIN_SIMILARITY)
        : values[branch - 1] >= MIN_SIMILARITY);
    })));
    const checked: { candidate: RankedCandidate; chunk: Document; parent: Document; text: string }[] = [];
    for (const candidate of candidates) {
      signal.throwIfAborted();
      const chunk = initial.chunks.get(candidate.id);
      if (!chunk || !eligibleChunk(chunk, config, policyId)) { rejected++; continue; }
      const parent = initial.parents.get(chunk.documentId);
      if (!parent || !eligibleParent(parent, config, policyId, options.sessionId)) { rejected++; continue; }
      try {
        const text = await readText(db, chunk, signal);
        validateChunk(chunk, parent, text);
        checked.push({ candidate, chunk, parent, text });
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof InvalidEvidence)) throw error;
        rejected++;
      }
    }

    // 검증 중 삭제·변경된 근거도 제외한다. 오래된 인덱스 상태를 접근 권한으로 사용하지 않는다.
    const current = await readEvidence(chunks, documents, checked.map(evidence => evidence.chunk._id), signal);
    const hits: SearchHit[] = [];
    for (const evidence of checked) {
      signal.throwIfAborted();
      const chunk = current.chunks.get(evidence.chunk._id);
      const parent = current.parents.get(evidence.parent._id);
      if (!chunk || !parent || !isDeepStrictEqual(chunk, evidence.chunk) || !isDeepStrictEqual(parent, evidence.parent)) {
        rejected++; continue;
      }
      const candidate = evidence.candidate;
      hits.push({ evidenceKind: "generated-session-summary", validationStatus: "unverified",
        similarity: similarities.get(candidate.id)!.reduce((best, value) => Math.max(best, value), -1), score: candidate.score,
        scoreBreakdown: { lexicalRank: candidate.lexicalRank, vectorRanks: candidate.vectorRanks },
        text: evidence.text, documentId: parent._id, chunkId: chunk._id, projectId: parent.projectId,
        sessionId: parent.sessionId, leafId: parent.leafId, sourceHash: parent.sourceHash, summaryHash: parent.summaryHash,
        ordinal: chunk.ordinal, start: chunk.start, end: chunk.end, sourceRefs: chunk.sourceRefs });
      if (hits.length === limit) break;
    }
    signal.throwIfAborted();
    const warnings = [GRIDFS_WARNING];
    if (belowThreshold) warnings.push(`코사인 유사도 ${MIN_SIMILARITY} 미만 후보 ${belowThreshold}개를 제외했습니다.`);
    if (lexicalFragments > 1) {
      warnings.push(`MongoDB 절 개수 한계에 따라 키워드 질문 전체를 ${lexicalFragments}개 조각으로 검색했습니다. 요청 ${lexicalRequests}회.`);
    }
    if (rejected) warnings.push(`현재 상태·출처 검증을 통과하지 못한 검색 후보 ${rejected}개를 제외했습니다.`);
    return result(hits, warnings, started, limit, vectors.length);
  });
}

// 명시적인 준비 요청에서만 없는 인덱스를 만든다. 기존 정의는 수정하지 않는다.
export async function ensureSearchIndexes(config: MongoConfig, options: IndexOptions): Promise<SearchIndexResult> {
  return withMongo(config, options, "검색 인덱스 준비", async db => {
    const collection = db.collection("rag_chunks");
    const created: string[] = [];
    let rows = await listIndexes(collection, options.signal);
    for (const expected of SEARCH_INDEXES) {
      const existing = rows.find(row => row.name === expected.name);
      if (existing) validateIndex(existing, expected);
    }
    for (const expected of SEARCH_INDEXES) {
      options.signal.throwIfAborted();
      const existing = rows.find(row => row.name === expected.name);
      if (existing) continue;
      options.onProgress?.(`${expected.name} 생성 요청`);
      try {
        await collection.createSearchIndex(expected);
      } catch (error) {
        // 동시 준비가 먼저 만들었을 수 있다. 읽어서 같은 정의인 경우만 받아들인다.
        options.signal.throwIfAborted();
        rows = await listIndexes(collection, options.signal);
        const winner = rows.find(row => row.name === expected.name);
        if (!winner) throw error;
        validateIndex(winner, expected);
        continue;
      }
      created.push(expected.name);
    }
    rows = await listIndexes(collection, options.signal);
    const indexes = SEARCH_INDEXES.map(expected => {
      const row = rows.find(value => value.name === expected.name);
      if (row) validateIndex(row, expected);
      return { name: expected.name, status: typeof row?.status === "string" ? row.status : "PENDING",
        queryable: row?.queryable === true };
    });
    options.signal.throwIfAborted();
    return { status: indexes.every(row => row.status === "READY" && row.queryable) ? "ready" : "building", indexes, created };
  });
}

function chunkDocument(chunk: EmbeddingRecord["chunks"][number], ordinal: number,
  manifest: Document, sections: SourceSection[]): RagDocument {
  return { _id: chunkId(manifest._id, chunk.id),
    documentId: manifest._id, projectId: manifest.projectId, embeddingModel: manifest.embedding.model,
    policyId: manifest.policyId, ordinal, sourceChunkId: chunk.id, start: chunk.start, end: chunk.end,
    tokens: chunk.tokens, textHash: hash(chunk.text), vector: chunk.vector, text: chunk.text,
    textStorage: "inline", sourceRefs: sections.filter(section => section.start < chunk.end && section.end > chunk.start)
      .map(section => section.reference) };
}

function chunkId(documentId: string, sourceChunkId: string): string {
  return hash(JSON.stringify({ documentId, sourceChunkId }));
}

function immutableFilter(fields: Document, prefix = ""): Document {
  const filter: Document = {};
  for (const [key, value] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(filter, immutableFilter(value, path));
    } else {
      filter[path] = value;
    }
  }
  return filter;
}

async function insertOnly(collection: Collection<RagDocument>, document: RagDocument, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  try {
    const result = await collection.updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
    signal.throwIfAborted();
    if (!result.acknowledged) throw new DbError("MongoDB가 저장 완료를 확인하지 않았습니다.");
    return result.upsertedCount === 1;
  } catch (error) {
    signal.throwIfAborted();
    // 동시 실행이 먼저 넣었을 때도 아래의 읽기 검증을 반드시 거친다.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

// BSON의 실제 16 MiB 한계를 넘는 본문만 GridFS로 보관한다. 텍스트를 자르지 않는다.
async function saveChunk(db: Db, collection: Collection<RagDocument>, expected: RagDocument,
  signal: AbortSignal): Promise<{ inserted: boolean; searchable: boolean }> {
  let existing = await collection.findOne({ _id: expected._id }, { signal });
  let inserted = false;
  if (!existing) {
    let candidate: RagDocument = { ...expected, searchable: false };
    let fileId: ObjectId | undefined;
    if (BSON.calculateObjectSize(candidate) > MAX_BSON_BYTES) {
      fileId = await saveText(db, expected, signal);
      const { text: _text, ...fields } = candidate;
      candidate = { ...fields, textStorage: "gridfs", textFileId: fileId };
    }
    // 전송 후 응답을 잃으면 저장 여부가 불명확하다. 참조될 수 있는 GridFS 파일은 지우지 않는다.
    inserted = await insertOnly(collection, candidate, signal);
    existing = await collection.findOne({ _id: expected._id }, { signal });
    if (fileId && (existing?.textStorage === "inline"
      || existing?.textFileId instanceof ObjectId && !fileId.equals(existing.textFileId))) {
      await new GridFSBucket(db, { bucketName: "rag_chunk_text" }).delete(fileId);
    }
  }
  await verifyChunk(db, existing, expected, signal);
  return { inserted, searchable: existing!.searchable === true };
}

async function saveText(db: Db, expected: Document, signal: AbortSignal): Promise<ObjectId> {
  const bucket = new GridFSBucket(db, { bucketName: "rag_chunk_text" });
  const id = new ObjectId();
  const stream = bucket.openUploadStreamWithId(id, expected._id,
    { metadata: { chunkId: expected._id, textHash: expected.textHash } });
  try {
    await pipeline(Readable.from([Buffer.from(expected.text, "utf8")]), stream, { signal });
    signal.throwIfAborted();
    return id;
  } catch (error) {
    await stream.abort().catch(() => {});
    await bucket.delete(id).catch(() => {});
    throw error;
  }
}

async function verifyChunk(db: Db, stored: Document | null, expected: Document,
  signal: AbortSignal): Promise<void> {
  const { text, textStorage: _storage, ...fields } = expected;
  assertFields(stored, fields, "기존 MongoDB 청크의 본문·출처·벡터가 다릅니다.");
  if (typeof stored!.searchable !== "boolean") throw new DbError("MongoDB 청크의 검색 상태가 올바르지 않습니다.");
  if (stored!.textStorage === "inline" && stored!.text === text) return;
  if (stored!.textStorage !== "gridfs" || !(stored!.textFileId instanceof ObjectId) || stored!.text !== undefined) {
    throw new DbError("기존 MongoDB 청크의 본문 저장 형식이 다릅니다.");
  }
  if (await readGridFs(db, stored!.textFileId, signal) !== text) {
    throw new DbError("GridFS 본문이 원본 임베딩과 다릅니다.");
  }
}

function assertFields(stored: Document | null, expected: Document, message: string): void {
  if (!stored || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(stored[key], value))) {
    throw new DbError(message);
  }
}

// 생성 시각·사용량은 첫 적재 기록을 보존한다. 같은 내용의 재생성은 새 문서가 아니다.
function assertGeneration(value: unknown): void {
  const generation = value as { createdAt?: unknown; elapsedMs?: unknown; calls?: unknown } | null;
  if (!generation || typeof generation.createdAt !== "string" || !Number.isFinite(Date.parse(generation.createdAt))
    || typeof generation.elapsedMs !== "number" || !Number.isFinite(generation.elapsedMs) || generation.elapsedMs < 0
    || !Number.isSafeInteger(generation.calls) || (generation.calls as number) < 1) {
    throw new DbError("기존 MongoDB 문서의 최초 생성 기록이 올바르지 않습니다.");
  }
}

// 생성기가 기록한 출처만 읽는다. Markdown 안의 임의 지시나 YAML 객체는 실행하지 않는다.
function readSource(markdown: string): { source: Document; sections: SourceSection[] } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!frontmatter) throw new DbError("요약 Markdown에 원문 출처가 없습니다.");
  const fields = new Map<string, string>();
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match || fields.has(match[1])) throw new DbError("요약 Markdown의 출처 형식이 올바르지 않습니다.");
    fields.set(match[1], match[2]);
  }
  const scalar = (key: string): unknown => {
    try { return JSON.parse(fields.get(key) ?? ""); }
    catch { throw new DbError("요약 Markdown의 원문 출처 값이 올바르지 않습니다."); }
  };
  const sessionId = scalar("session_id");
  const leafId = scalar("leaf_id");
  const capturedAt = scalar("captured_at");
  const sourceHash = fields.get("source_hash");
  if (fields.get("format") !== "pi-session-rag/1" || fields.get("status") !== "unverified"
    || typeof sessionId !== "string" || !sessionId || !(leafId === null || typeof leafId === "string" && !!leafId)
    || typeof capturedAt !== "string" || !Number.isFinite(Date.parse(capturedAt))
    || !sourceHash || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new DbError("요약 Markdown의 세션·스냅샷 출처가 올바르지 않습니다.");
  }

  const headings = [...markdown.matchAll(/^## Q&A (\d+)\r?$/gm)];
  if (!headings.length) throw new DbError("요약 Markdown에 Q&A 출처가 없습니다.");
  const sections = headings.map((heading, ordinal): SourceSection => {
    const start = heading.index!;
    const end = headings[ordinal + 1]?.index ?? markdown.length;
    const comments = [...markdown.slice(start, end).matchAll(/^<!-- source: (.+) -->\r?$/gm)];
    let value: { user?: unknown; assistant?: unknown };
    try { value = JSON.parse(comments.length === 1 ? comments[0][1] : ""); }
    catch { throw new DbError("요약 Markdown의 Q&A 출처가 올바르지 않습니다."); }
    if (Number(heading[1]) !== ordinal + 1 || !value || typeof value.user !== "string" || !value.user
      || !Array.isArray(value.assistant) || value.assistant.some(id => typeof id !== "string" || !id)) {
      throw new DbError("요약 Markdown의 Q&A entry 출처가 올바르지 않습니다.");
    }
    return { start, end, reference: { ordinal, userEntryId: value.user, assistantEntryIds: value.assistant as string[] } };
  });
  return { source: { sessionId, leafId, sourceHash, capturedAt, validationStatus: "unverified" }, sections };
}

// 검색은 인덱스를 만들지 않는다. 생성 완료와 실제 queryable 상태를 둘 다 확인한다.
async function requireSearchIndexes(collection: Pick<Collection<Document>, "listSearchIndexes">, signal: AbortSignal): Promise<void> {
  const rows = await listIndexes(collection, signal);
  for (const expected of SEARCH_INDEXES) {
    const row = rows.find(value => value.name === expected.name);
    if (!row) throw new DbError("검색 인덱스가 없습니다. /rag-search-setup을 실행하세요.");
    validateIndex(row, expected);
    if (row.status !== "READY" || row.queryable !== true) {
      throw new DbError("검색 인덱스가 아직 준비되지 않았습니다. /rag-search-setup으로 상태를 확인하세요.");
    }
  }
}

async function listIndexes(collection: Pick<Collection<Document>, "listSearchIndexes">, signal: AbortSignal): Promise<Document[]> {
  signal.throwIfAborted();
  const cursor = collection.listSearchIndexes();
  const onAbort = () => { void cursor.close().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const rows = await cursor.toArray();
    signal.throwIfAborted();
    return rows;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await cursor.close().catch(() => {});
  }
}

function validateIndex(row: Document, expected: typeof SEARCH_INDEXES[number]): void {
  const type = row.type ?? "search";
  if (type !== expected.type || !isDeepStrictEqual(canonical(row.latestDefinition), canonical(expected.definition))) {
    throw new DbError("기존 검색 인덱스 정의가 이 확장과 다릅니다. 기존 인덱스는 보존했습니다.");
  }
  if (row.status === "FAILED") {
    throw new DbError("검색 인덱스 생성에 실패했습니다. Atlas에서 상태를 확인하세요. 기존 인덱스는 보존했습니다.");
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

function safeDbError(error: unknown, action: string): Error {
  if (error instanceof DbError) return error;
  const info = error as { code?: number; name?: string; message?: string } | null;
  if (info?.code === 18 || info?.code === 8000 && typeof info.message === "string"
    && /authentication failed|bad auth|auth failed/i.test(info.message)) {
    return new Error("MongoDB 인증에 실패했습니다. DB 사용자와 비밀번호를 확인하세요.");
  }
  if (info?.code === 13) return new Error(`MongoDB ${action} 권한이 없습니다. DB 사용자 권한을 확인하세요.`);
  if (info?.name === "MongoParseError" || info?.name === "MongoInvalidArgumentError") {
    return new Error("MongoDB 연결 설정이 올바르지 않습니다.");
  }
  return new Error(action === "업로드"
    ? "MongoDB 업로드에 실패했습니다. 연결·IP 허용·DB 권한을 확인하고 다시 실행하세요."
    : `MongoDB ${action}에 실패했습니다. 연결과 Atlas 검색 지원을 확인하고 /rag-search-setup을 실행하세요.`);
}

// 연결은 작업마다 하나만 열고, 취소와 완료가 겹쳐도 한 번만 닫는다.
async function withMongo<T>(config: MongoConfig, options: MongoOptions,
  action: string, run: (db: Db) => Promise<T>): Promise<T> {
  const { signal } = options;
  let client: MongoClient | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= client?.close().catch(() => {}) ?? Promise.resolve();
  const onAbort = () => { void close(); };
  try {
    signal.throwIfAborted();
    client = options.clientFactory?.(config.uri) ?? new MongoClient(config.uri,
      action === "업로드" ? { writeConcern: { w: "majority" } } : {});
    signal.addEventListener("abort", onAbort, { once: true });
    await client.connect();
    signal.throwIfAborted();
    const result = await run(client.db(config.database));
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) throw new DOMException(`${action} 취소`, "AbortError");
    throw safeDbError(error, action);
  } finally {
    signal.removeEventListener("abort", onAbort);
    await close();
  }
}

// MongoDB의 명확한 BooleanQuery 절 개수 오류만 분할 대상으로 삼는다.
function isClauseLimitError(error: unknown): boolean {
  const info = error as { code?: unknown; message?: unknown } | null;
  return info?.code === 8 && typeof info.message === "string"
    && /too\s+many(?:\s+nested)?\s+clauses|too\s+many\s+sub-queries|\bTooManyClauses\b/i.test(info.message);
}

// 단어 사이에서 나누고, 단일 단어라면 완전한 문자 경계를 사용한다. 공백도 그대로 보존한다.
function splitLexicalQuery(query: string): [string, string] | undefined {
  const firstContent = query.search(/\S/u);
  const contentEnd = query.trimEnd().length;
  const middle = query.length / 2;
  const boundary = (granularity: "word" | "grapheme"): number | undefined => {
    let nearest: number | undefined;
    for (const segment of new Intl.Segmenter(undefined, { granularity }).segment(query)) {
      const position = segment.index;
      if (position <= firstContent || position >= contentEnd) continue;
      if (nearest === undefined || Math.abs(position - middle) < Math.abs(nearest - middle)) nearest = position;
    }
    return nearest;
  };
  const split = boundary("word") ?? boundary("grapheme");
  return split === undefined ? undefined : [query.slice(0, split), query.slice(split)];
}

// 성공한 모든 조각의 BM25 점수를 합친다. 조각 수는 최종 lexical 가중치를 늘리지 않는다.
async function searchLexicalQuery(query: string, run: (fragment: string) => Promise<LexicalCandidate[]>,
  signal: AbortSignal): Promise<LexicalResult> {
  const pending = [query];
  const totals = new Map<string, number>();
  let fragments = 0;
  let requests = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const fragment = pending.pop()!;
    let rows: LexicalCandidate[];
    try {
      requests++;
      rows = await run(fragment);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (!isClauseLimitError(error)) throw error;
      const smaller = splitLexicalQuery(fragment);
      if (!smaller) throw new DbError("키워드 검색의 최소 단위가 MongoDB 절 개수 한계를 초과했습니다.");
      pending.push(smaller[1], smaller[0]);
      continue;
    }
    const unique = new Map<string, number>();
    for (const row of rows) {
      unique.set(row._id, Math.max(unique.get(row._id) ?? 0, row.score));
    }
    for (const [id, score] of unique) {
      const sum = (totals.get(id) ?? 0) + score;
      if (!Number.isFinite(sum)) throw new DbError("MongoDB 키워드 검색 점수가 올바르지 않습니다.");
      totals.set(id, sum);
    }
    fragments++;
  }
  signal.throwIfAborted();
  const candidates = [...totals].map(([_id, score]) => ({ _id, score }))
    .sort((a, b) => b.score - a.score || a._id.localeCompare(b._id));
  return { candidates, fragments, requests };
}

// 청크와 부모를 묶어 읽는다. 본문 검증 전후에 호출해 검색 중 변경도 확인한다.
async function readEvidence(chunks: Collection<RagDocument>, documents: Collection<RagDocument>,
  ids: string[], signal: AbortSignal): Promise<{ chunks: Map<string, Document>; parents: Map<string, Document> }> {
  if (!ids.length) return { chunks: new Map(), parents: new Map() };
  const rows = await chunks.find({ _id: { $in: ids } }, { signal }).toArray();
  signal.throwIfAborted();
  const parentIds = [...new Set(rows.map(row => row.documentId).filter(validHash))];
  const parents = parentIds.length ? await documents.find({ _id: { $in: parentIds } }, { signal }).toArray() : [];
  signal.throwIfAborted();
  return { chunks: new Map(rows.map(row => [row._id, row])), parents: new Map(parents.map(row => [row._id, row])) };
}

function validCandidate(row: Document): boolean {
  return !!row && validHash(row._id) && typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0;
}

// 순위만 합친다. 긴 질문의 벡터 수가 늘어도 전체 벡터 가중치는 1/2로 유지한다.
function fuseRanks(branches: Document[][]): RankedCandidate[] {
  const byId = new Map<string, RankedCandidate>();
  for (const [branch, rows] of branches.entries()) {
    const sorted = [...rows].sort((a, b) => b.score - a.score || a._id.localeCompare(b._id));
    const seen = new Set<string>();
    let rank = 0;
    for (const row of sorted) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      rank++;
      let candidate = byId.get(row._id);
      if (!candidate) {
        candidate = { id: row._id, score: 0, lexicalRank: null, vectorRanks: Array(branches.length - 1).fill(null) };
        byId.set(row._id, candidate);
      }
      const weight = branch === 0 ? 0.5 : 0.5 / (branches.length - 1);
      candidate.score += weight / (60 + rank);
      if (branch === 0) candidate.lexicalRank = rank;
      else candidate.vectorRanks[branch - 1] = rank;
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function eligibleChunk(chunk: Document, config: MongoConfig, policyId: string): boolean {
  return chunk.projectId === config.projectId && chunk.policyId === policyId && chunk.searchable === true
    && chunk.embeddingModel === SEARCH_POLICY.model && validHash(chunk.documentId);
}

function eligibleParent(parent: Document, config: MongoConfig, policyId: string, sessionId?: string): boolean {
  if (parent.state !== "ready" || parent.projectId !== config.projectId || parent.policyId !== policyId
    || parent.schemaVersion !== 1 || parent.validationStatus !== "unverified"
    || typeof parent.sessionId !== "string" || !parent.sessionId || sessionId !== undefined && parent.sessionId !== sessionId
    || !(parent.leafId === null || typeof parent.leafId === "string" && !!parent.leafId)
    || !validHash(parent.sourceHash) || !validHash(parent.summaryHash)
    || typeof parent.capturedAt !== "string" || !Number.isFinite(Date.parse(parent.capturedAt))
    || !Number.isSafeInteger(parent.chunkCount) || parent.chunkCount < 1
    || !isDeepStrictEqual(parent.embedding, SEARCH_POLICY)) return false;
  return parent._id === hash(JSON.stringify({ projectId: parent.projectId, sessionId: parent.sessionId,
    sourceHash: parent.sourceHash, summaryHash: parent.summaryHash, policyId }));
}

function validateChunk(chunk: Document, parent: Document, text: string): void {
  if (!Number.isSafeInteger(chunk.ordinal) || chunk.ordinal < 0 || chunk.ordinal >= parent.chunkCount
    || !Number.isSafeInteger(chunk.start) || chunk.start < 0 || !Number.isSafeInteger(chunk.end) || chunk.end <= chunk.start
    || !validHash(chunk.textHash) || !validHash(chunk.sourceChunkId)
    || !Number.isSafeInteger(chunk.tokens) || chunk.tokens < 1 || chunk.tokens > SEARCH_POLICY.tokenizer.maxTokens
    || !validVector(chunk.vector) || !validSourceRefs(chunk.sourceRefs)
    || chunk._id !== hash(JSON.stringify({ documentId: parent._id, sourceChunkId: chunk.sourceChunkId }))) {
    throw new InvalidEvidence();
  }
  if (text.length !== chunk.end - chunk.start || hash(text) !== chunk.textHash
    || chunk.sourceChunkId !== hash(JSON.stringify({ summaryHash: parent.summaryHash, start: chunk.start, end: chunk.end, text }))) {
    throw new InvalidEvidence();
  }
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === SEARCH_POLICY.dimensions
    && value.every(n => typeof n === "number" && Number.isFinite(n)) && value.some(n => n !== 0);
}

// 크기가 다른 벡터도 방향만 비교하며, 큰 유한 값의 제곱으로 overflow가 생기지 않게 한다.
function unitVector(vector: number[]): number[] {
  const scale = Math.max(...vector.map(Math.abs));
  const scaled = vector.map(value => value / scale);
  const norm = Math.hypot(...scaled);
  return scaled.map(value => value / norm);
}

function cosine(left: number[], right: number[]): number {
  const value = left.reduce((sum, component, index) => sum + component * right[index], 0);
  return Math.max(-1, Math.min(1, value));
}

function validSourceRefs(value: unknown): value is SourceReference[] {
  if (!Array.isArray(value)) return false;
  let previous = -1;
  for (const ref of value) {
    if (!ref || !Number.isSafeInteger(ref.ordinal) || ref.ordinal <= previous
      || typeof ref.userEntryId !== "string" || !ref.userEntryId || !Array.isArray(ref.assistantEntryIds)
      || ref.assistantEntryIds.some((id: unknown) => typeof id !== "string" || !id)) return false;
    previous = ref.ordinal;
  }
  return true;
}

async function readText(db: Db, chunk: Document, signal: AbortSignal): Promise<string> {
  if (chunk.textStorage === "inline") {
    if (typeof chunk.text !== "string" || chunk.textFileId !== undefined) throw new InvalidEvidence();
    return chunk.text;
  }
  if (chunk.textStorage !== "gridfs" || !(chunk.textFileId instanceof ObjectId) || chunk.text !== undefined) {
    throw new InvalidEvidence();
  }
  try {
    return await readGridFs(db, chunk.textFileId, signal);
  } catch (error) {
    const info = error as { code?: string; name?: string };
    if (info.code === "ENOENT" || info.name === "MongoGridFSChunkError" || info.name === "MongoGridFSStreamError") {
      throw new InvalidEvidence();
    }
    throw error;
  }
}

async function readGridFs(db: Db, fileId: ObjectId, signal: AbortSignal): Promise<string> {
  const stream = new GridFSBucket(db, { bucketName: "rag_chunk_text" }).openDownloadStream(fileId);
  const onAbort = () => stream.destroy(new DOMException("본문 읽기 취소", "AbortError"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    const buffers: Buffer[] = [];
    for await (const buffer of stream) {
      signal.throwIfAborted();
      buffers.push(buffer as Buffer);
    }
    signal.throwIfAborted();
    return Buffer.concat(buffers).toString("utf8");
  } finally {
    signal.removeEventListener("abort", onAbort);
    stream.destroy();
  }
}

function result(hits: SearchHit[], warnings: string[], started: number, limit: number, queryChunks: number): SearchResult {
  return { hits, warnings, limit, queryChunks, elapsedMs: performance.now() - started, mode: "hybrid", minSimilarity: MIN_SIMILARITY };
}
