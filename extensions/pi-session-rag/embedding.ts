import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { parseEnv } from "node:util";
import { Tokenizer } from "@huggingface/tokenizers";
import { saveNewJson } from "./summary.ts";

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
export const TOKENIZER_REVISION = "5617a9f61b028005a4858fdac845db406aefb181";
export const MAX_EMBEDDING_TOKENS = 8192;

export interface TextChunk {
  // 원문에서의 UTF-16 위치입니다. end 바로 앞까지 포함합니다.
  start: number;
  end: number;
  text: string;
  tokens: number;
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
}

// 이 오류만 원문을 더 작은 청크로 나누어 다시 요청할 수 있다.
class CloudflareInputTooLongError extends Error {
  constructor() {
    super("Cloudflare 임베딩 입력이 모델의 토큰 한계를 초과했습니다.");
    this.name = "CloudflareInputTooLongError";
  }
}

export interface EmbeddingPolicy {
  format: string;
  model: string;
  dimensions: number;
  tokenizer: { model: string; revision: string; maxTokens: number };
}

export interface QueryEmbedding {
  vectors: number[][];
  chunks: TextChunk[];
  calls: number;
  elapsedMs: number;
}

interface EmbeddedChunk extends TextChunk {
  id: string;
  vector: number[];
}

export interface EmbeddingRecord extends EmbeddingPolicy {
  format: "pi-session-rag-embeddings/1";
  summaryFile: string;
  summaryHash: string;
  createdAt: string;
  elapsedMs: number;
  calls: number;
  chunks: EmbeddedChunk[];
}

export interface EmbeddingPlan {
  summaryFile: string;
  summaryHash: string;
  markdown: string;
  path: string;
  started: number;
  startedAt: string;
}

export interface EmbeddingResult {
  status: "created" | "reused" | "preserved";
  path: string;
  totalChunks: number;
  reusedChunks: number;
  calls: number;
  elapsedMs: number;
}

interface EmbeddingOptions {
  signal: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  fetcher?: typeof fetch;
}

const FORMAT = "pi-session-rag-embeddings/1";
const TOKENIZER = { model: "BAAI/bge-m3", revision: TOKENIZER_REVISION, maxTokens: MAX_EMBEDDING_TOKENS };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// 적재와 검색이 같은 모델·토크나이저 결과만 연결하도록 정책을 한곳에 둔다.
export function currentEmbeddingPolicy(): EmbeddingPolicy {
  return { format: FORMAT, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS,
    tokenizer: { ...TOKENIZER } };
}

export function embeddingPolicyId(policy: EmbeddingPolicy = currentEmbeddingPolicy()): string {
  const identity = { format: policy.format, model: policy.model, dimensions: policy.dimensions,
    tokenizer: { model: policy.tokenizer.model, revision: policy.tokenizer.revision, maxTokens: policy.tokenizer.maxTokens } };
  return hash(JSON.stringify(identity));
}

// 프로젝트 파일을 먼저 읽고 실행 환경의 값을 우선한다. 전역 환경은 수정하지 않는다.
export async function loadProjectEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  let values: NodeJS.ProcessEnv = {};
  for (const path of [join(cwd, ".pi", ".env"), join(cwd, ".env")]) {
    try {
      values = { ...values, ...parseEnv(await readFile(path, "utf8")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("프로젝트 .env 파일을 읽지 못했습니다.");
      }
    }
  }
  // undefined는 설정이 없는 값이다. 명시적인 빈 문자열은 그대로 유지한다.
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) values[key] = value;
  }
  return values;
}

// 프로젝트 설정만 읽는다. 기존 환경 변수를 우선하고 전역 환경은 바꾸지 않는다.
export async function loadCloudflareConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CloudflareConfig> {
  const values = await loadProjectEnv(cwd, env);

  return validatedConfig(values.CLOUDFLARE_ACCOUNT_ID, values.CLOUDFLARE_API_TOKEN);
}

// 실제 저장된 Markdown을 읽는다. 사용자 편집도 내용 해시에 반영하고 이전 벡터는 보존한다.
export async function prepareEmbedding(
  summaryFile: string,
  signal: AbortSignal,
): Promise<{ plan: EmbeddingPlan } | { result: EmbeddingResult }> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  signal.throwIfAborted();
  const file = resolve(summaryFile);
  if (!(await lstat(file)).isFile()) {
    throw new Error("임베딩할 요약 경로가 일반 파일이 아닙니다.");
  }

  const markdown = await readFile(file, "utf8");
  signal.throwIfAborted();
  if (!markdown.trim()) {
    throw new Error("빈 요약은 임베딩하지 않습니다.");
  }

  const summaryHash = hash(markdown);
  const key = hash(JSON.stringify({ format: FORMAT, summaryHash, model: EMBEDDING_MODEL, tokenizer: TOKENIZER }));
  const path = join(dirname(file), "embeddings", `${basename(file, ".md")}-${key}.json`);
  const plan: EmbeddingPlan = { summaryFile: file, summaryHash, markdown, path, started, startedAt };
  const existing = await readExisting(plan, signal);
  if (existing) {
    await ensureSummaryUnchanged(plan, signal);
    return { result: resultFor(plan, "reused", existing.chunks.length, 0) };
  }
  return { plan };
}

// 청크를 순서대로 임베딩한다. 명확한 입력 길이 오류만 원문을 더 나누어 다시 보낸다.
export async function generateEmbedding(
  plan: EmbeddingPlan,
  config: CloudflareConfig,
  options: EmbeddingOptions,
): Promise<EmbeddingResult> {
  const { signal } = options;
  const generated = await embedChunks(plan.markdown, config, options);
  const calls = generated.calls;
  const chunks = generated.chunks.map(chunk => ({ ...chunk, id: chunkId(plan.summaryHash, chunk) }));

  // 모두 완료된 뒤에만 게시한다. 생성 중 편집된 문서에는 이전 내용의 벡터를 붙이지 않는다.
  await ensureSummaryUnchanged(plan, signal);
  const record: EmbeddingRecord = {
    format: FORMAT,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    summaryFile: plan.summaryFile,
    summaryHash: plan.summaryHash,
    createdAt: plan.startedAt,
    tokenizer: { ...TOKENIZER },
    elapsedMs: performance.now() - plan.started,
    calls,
    chunks,
  };
  const saved = await saveNewJson(plan.path, record, signal);
  if (saved === "exists") {
    const existing = await readExisting(plan, signal);
    if (!existing) {
      throw new Error("다른 실행의 임베딩 파일을 확인하지 못했습니다.");
    }
    return resultFor(plan, "preserved", existing.chunks.length, calls);
  }
  return resultFor(plan, "created", chunks.length, calls);
}

function resultFor(
  plan: EmbeddingPlan,
  status: EmbeddingResult["status"],
  totalChunks: number,
  calls: number,
): EmbeddingResult {
  return {
    status,
    path: plan.path,
    totalChunks,
    reusedChunks: status === "created" ? 0 : totalChunks,
    calls,
    elapsedMs: performance.now() - plan.started,
  };
}

function chunkId(summaryHash: string, chunk: TextChunk): string {
  return hash(JSON.stringify({ summaryHash, start: chunk.start, end: chunk.end, text: chunk.text }));
}

async function ensureSummaryUnchanged(plan: EmbeddingPlan, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!(await lstat(plan.summaryFile)).isFile()
    || hash(await readFile(plan.summaryFile, "utf8")) !== plan.summaryHash) {
    throw new Error("임베딩 중 요약 파일이 바뀌어 벡터를 저장하지 않았습니다. 다시 실행하세요.");
  }
  signal.throwIfAborted();
}

// 업로드도 캐시 재사용과 같은 검증을 거친다. 실제 Markdown이 바뀌면 DB에 보내지 않는다.
export async function loadEmbeddingFile(
  path: string,
  signal: AbortSignal,
): Promise<{ record: EmbeddingRecord; markdown: string }> {
  const file = resolve(path);
  const value = await readEmbeddingJson(file, signal);
  const summaryFile = object(value)?.summaryFile;
  if (typeof summaryFile !== "string" || !(await lstat(summaryFile)).isFile()) {
    throw new Error("임베딩의 요약 경로가 일반 파일이 아닙니다.");
  }
  const markdown = await readFile(summaryFile, "utf8");
  signal.throwIfAborted();
  const plan: EmbeddingPlan = {
    path: file, summaryFile: resolve(summaryFile), markdown,
    summaryHash: hash(markdown), started: performance.now(), startedAt: new Date().toISOString(),
  };
  const record = validateEmbedding(value, plan);
  await ensureSummaryUnchanged(plan, signal);
  return { record, markdown };
}

// 기존 파일은 내용·정책·문자 위치·벡터를 검사한 뒤에만 재사용한다. 잘못된 파일도 덮어쓰지 않는다.
async function readExisting(plan: EmbeddingPlan, signal: AbortSignal): Promise<EmbeddingRecord | undefined> {
  try {
    return validateEmbedding(await readEmbeddingJson(plan.path, signal), plan);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readEmbeddingJson(path: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (!(await lstat(path)).isFile()) {
    throw new Error("임베딩 출력 경로가 일반 파일이 아닙니다.");
  }
  const raw = await readFile(path, "utf8");
  signal.throwIfAborted();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("기존 임베딩 JSON이 올바르지 않습니다. 파일은 보존했습니다.");
  }
}

function validateEmbedding(value: unknown, plan: EmbeddingPlan): EmbeddingRecord {
  const record = object(value);
  const tokenizer = object(record?.tokenizer);
  if (!record || record.format !== FORMAT || record.model !== EMBEDDING_MODEL
    || record.dimensions !== EMBEDDING_DIMENSIONS || record.summaryFile !== plan.summaryFile
    || record.summaryHash !== plan.summaryHash || tokenizer?.model !== TOKENIZER.model
    || tokenizer.revision !== TOKENIZER.revision || tokenizer.maxTokens !== TOKENIZER.maxTokens
    || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.elapsedMs !== "number" || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0
    || !Number.isSafeInteger(record.calls) || (record.calls as number) < 1
    || !Array.isArray(record.chunks) || !record.chunks.length) {
    throw new Error("기존 임베딩의 모델·출처·청킹 형식이 올바르지 않습니다. 파일은 보존했습니다.");
  }

  let end = 0;
  for (const value of record.chunks) {
    const chunk = object(value);
    if (!chunk || chunk.start !== end || !Number.isSafeInteger(chunk.end)
      || (chunk.end as number) <= end || (chunk.end as number) > plan.markdown.length
      || chunk.text !== plan.markdown.slice(end, chunk.end as number)
      || !Number.isSafeInteger(chunk.tokens) || (chunk.tokens as number) < 1
      || (chunk.tokens as number) > MAX_EMBEDDING_TOKENS
      || chunk.id !== chunkId(plan.summaryHash, chunk as unknown as TextChunk)
      || !validVector(chunk.vector)) {
      throw new Error("기존 임베딩 청크의 원문·위치·벡터가 올바르지 않습니다. 파일은 보존했습니다.");
    }
    end = chunk.end as number;
  }
  if (end !== plan.markdown.length) {
    throw new Error("기존 임베딩이 요약 전체를 포함하지 않습니다. 파일은 보존했습니다.");
  }
  return value as EmbeddingRecord;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// 검색도 문서와 같은 모델과 청킹을 사용한다. 원문의 모든 조각을 검색에 사용한다.
export async function embedQuery(
  query: string,
  config: CloudflareConfig,
  options: EmbeddingOptions,
): Promise<QueryEmbedding> {
  const started = performance.now();
  options.signal.throwIfAborted();
  if (typeof query !== "string" || !query.trim()) throw new Error("검색어를 입력하세요.");
  const result = await embedChunks(query, config, options, true);
  return {
    chunks: result.chunks.map(({ vector, ...chunk }) => chunk),
    vectors: result.chunks.map(chunk => chunk.vector),
    calls: result.calls,
    elapsedMs: performance.now() - started,
  };
}

// 실패한 입력만 재분할한다. 완료한 청크는 다시 호출하지 않는다.
async function embedChunks(
  text: string,
  config: CloudflareConfig,
  options: EmbeddingOptions,
  requireNonzero = false,
): Promise<{ chunks: Array<TextChunk & { vector: number[] }>; calls: number }> {
  const { signal } = options;
  const pending = await chunkMarkdown(text, signal);
  const chunks: Array<TextChunk & { vector: number[] }> = [];
  let calls = 0;
  while (chunks.length < pending.length) {
    signal.throwIfAborted();
    options.onProgress?.(chunks.length, pending.length);
    const chunk = pending[chunks.length];
    try {
      calls++;
      const [vector] = await embedTexts(config, [chunk.text], signal, options.fetcher);
      signal.throwIfAborted();
      if (requireNonzero && !vector.some(value => value !== 0)) {
        throw new Error("검색 벡터가 모두 0입니다.");
      }
      chunks.push({ ...chunk, vector });
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof CloudflareInputTooLongError)) throw error;
      pending.splice(chunks.length, 1, ...await splitChunk(chunk, signal));
    }
    options.onProgress?.(chunks.length, pending.length);
  }
  signal.throwIfAborted();
  return { chunks, calls };
}


let tokenizerPromise: Promise<Tokenizer> | undefined;

// 모델의 토크나이저만 불러옵니다. 길이를 줄이는 설정은 허용하지 않습니다.
async function loadTokenizer(): Promise<Tokenizer> {
  const [json, config] = await Promise.all([
    readFile(new URL("./tokenizer/tokenizer.json", import.meta.url), "utf8"),
    readFile(new URL("./tokenizer/tokenizer_config.json", import.meta.url), "utf8"),
  ]);
  const tokenizer = JSON.parse(json);
  const settings = JSON.parse(config);

  if (tokenizer.truncation != null || tokenizer.padding != null) {
    throw new Error("임베딩 토크나이저에 자르기나 패딩 설정이 있습니다.");
  }
  if (settings.model_max_length !== MAX_EMBEDDING_TOKENS ||
      settings.tokenizer_class !== "XLMRobertaTokenizer") {
    throw new Error("임베딩 토크나이저가 BGE-M3 설정과 다릅니다.");
  }

  return new Tokenizer(tokenizer, settings);
}

// 시작·종료 특수 토큰까지 포함해 BGE-M3 토크나이저로 토큰 수를 셉니다.
export async function countTokens(text: string): Promise<number> {
  tokenizerPromise ??= loadTokenizer().catch(error => {
    tokenizerPromise = undefined;
    throw error;
  });
  const tokenizer = await tokenizerPromise;
  return tokenizer.encode(text).ids.length;
}

// 한도 안의 문서는 그대로 두고, 넘는 조각만 나눕니다.
async function chunkMarkdown(markdown: string, signal: AbortSignal): Promise<TextChunk[]> {
  signal.throwIfAborted();
  if (!markdown) return [];

  const pending = [await makeChunk(markdown, 0, signal)];
  const chunks: TextChunk[] = [];

  while (pending.length) {
    await allowCancellation(signal);
    const chunk = pending.pop()!;

    if (chunk.tokens <= MAX_EMBEDDING_TOKENS) {
      chunks.push(chunk);
      continue;
    }

    const [left, right] = await splitChunk(chunk, signal);
    pending.push(right, left);
  }

  return chunks;
}

// 서비스가 더 작은 입력을 요구해도 원문을 버리지 않고 두 조각으로 나눕니다.
async function splitChunk(chunk: TextChunk, signal: AbortSignal): Promise<[TextChunk, TextChunk]> {
  signal.throwIfAborted();
  const text = chunk.text;
  const firstCharacterEnd = text.codePointAt(0)! > 0xffff ? 2 : 1;

  if (text.length <= firstCharacterEnd) {
    throw new Error("임베딩 입력을 더 나눌 수 없습니다.");
  }

  // 문단, 줄바꿈, 문자 순서로 경계를 고릅니다. 원문의 공백도 그대로 남깁니다.
  const middle = Math.floor(text.length / 2);
  const paragraph = closestBoundary(text, middle, ["\n\n", "\r\n\r\n"]);
  const line = paragraph ?? closestBoundary(text, middle, ["\n"]);
  const boundary = line ?? characterBoundary(text, middle);

  const left = await makeChunk(text.slice(0, boundary), chunk.start, signal);
  const right = await makeChunk(text.slice(boundary), chunk.start + boundary, signal);
  return [left, right];
}

// 경계를 찾을 때 문서 전체를 문단 배열로 복사하지 않습니다.
function closestBoundary(text: string, middle: number, separators: string[]): number | undefined {
  let closest: number | undefined;

  for (const separator of separators) {
    const before = text.lastIndexOf(separator, middle - separator.length);
    const after = text.indexOf(separator, Math.max(0, middle - separator.length + 1));

    for (const index of [before, after]) {
      if (index < 0) continue;
      const boundary = index + separator.length;
      if (boundary <= 0 || boundary >= text.length) continue;

      if (closest === undefined || Math.abs(boundary - middle) < Math.abs(closest - middle)) {
        closest = boundary;
      }
    }
  }

  return closest;
}

// 이모지 같은 두 칸짜리 UTF-16 문자의 가운데를 자르지 않습니다.
function characterBoundary(text: string, middle: number): number {
  const before = text.charCodeAt(middle - 1);
  const after = text.charCodeAt(middle);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    return middle - 1 || middle + 1;
  }
  return middle;
}

// 토큰을 센 뒤에도 취소를 확인해서 오래 걸린 작업의 결과가 뒤늦게 쓰이지 않게 합니다.
async function makeChunk(text: string, start: number, signal: AbortSignal): Promise<TextChunk> {
  await allowCancellation(signal);
  const tokens = await countTokens(text);
  await allowCancellation(signal);
  return { start, end: start + text.length, text, tokens };
}

// 반복 작업 사이에 TUI가 Esc 입력과 화면 갱신을 처리할 시간을 줍니다.
async function allowCancellation(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await setImmediate();
  signal.throwIfAborted();
}

// 계정 ID는 URL에 사용되므로 형식을 확인한다. 오류에는 실제 설정 값을 넣지 않는다.
function validatedConfig(
  accountId: string | undefined,
  apiToken: string | undefined,
): CloudflareConfig {
  const account = accountId?.trim();
  const token = apiToken?.trim();

  if (!account || !token) {
    throw new Error(".env 또는 환경 변수에 CLOUDFLARE_ACCOUNT_ID와 CLOUDFLARE_API_TOKEN이 필요합니다.");
  }

  if (!/^[a-f0-9]{32}$/i.test(account)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID는 32자리 16진수여야 합니다.");
  }

  return { accountId: account, apiToken: token };
}

// 청크 원문을 그대로 보내고, HTTP 응답과 취소 상태를 먼저 확인한다.
async function embedTexts(
  config: CloudflareConfig,
  texts: readonly string[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<number[][]> {
  ensureActive(signal);
  const credentials = validatedConfig(config.accountId, config.apiToken);

  if (!texts.length) return [];

  if (texts.some((text) => typeof text !== "string" || text.length === 0)) {
    throw new Error("임베딩할 텍스트가 비어 있습니다.");
  }

  let response: Response;
  try {
    response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/${EMBEDDING_MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: texts, truncate_inputs: false }),
        redirect: "error",
        signal,
      });
  } catch {
    ensureActive(signal);
    throw new Error("Cloudflare 임베딩 서버에 연결하지 못했습니다.");
  }

  ensureActive(signal);
  if (response.status === 413) throw new CloudflareInputTooLongError();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    ensureActive(signal);
    if (!response.ok) throw httpError(response.status);
    throw new Error("Cloudflare 임베딩 응답이 올바른 JSON이 아닙니다.");
  }

  ensureActive(signal);
  if (inputTooLong(body)) throw new CloudflareInputTooLongError();
  if (!response.ok) throw httpError(response.status);

  return validatedVectors(body, texts.length);
}

// HTTP 상태만 안내한다. 서버 본문은 입력이나 비밀 값을 포함할 수 있다.
function httpError(status: number): Error {
  return new Error(`Cloudflare 임베딩 요청 실패 (HTTP ${status}).`);
}

// 모델 길이 초과라는 근거가 있을 때만 분류한다. 인증·할당량·호출 빈도 오류는 재분할하지 않는다.
function inputTooLong(body: unknown): boolean {
  const errors = object(body)?.errors;
  if (!Array.isArray(errors)) return false;

  return errors.some((error) => {
    const details = object(error);
    if (details?.code === 3006) return true;

    const message = details?.message;
    if (typeof message !== "string"
      || /\b(?:rate limit|quota|per (?:second|minute|hour|day)|too many requests)\b/i.test(message)) {
      return false;
    }

    const length = /\b(?:tokens|token\s+(?:count|length|limit)|context\s+(?:length|window|size|limit)|sequence\s+(?:length|limit))\b/i;
    const exceeded = /\b(?:exceed(?:s|ed|ing)?|too\s+(?:long|large|many)|(?:maximum|max)\s+(?:(?:input|context|sequence|token)\s+)?(?:length|limit|size)|(?:maximum|max)\s+(?:number\s+of\s+)?tokens)\b/i;
    return length.test(message) && exceeded.test(message);
  });
}

// 성공 응답만 받아들이고, 청크별로 유한한 1024차원 벡터가 하나씩 있는지 확인한다.
function validatedVectors(body: unknown, count: number): number[][] {
  const envelope = object(body);
  if (envelope?.success !== true || !Array.isArray(envelope.errors) || envelope.errors.length) {
    throw new Error("Cloudflare가 임베딩 요청을 성공적으로 처리하지 못했습니다.");
  }

  const result = object(envelope.result);
  const shape = result?.shape;
  const data = result?.data;
  if (shape !== undefined && (!Array.isArray(shape)
    || shape.length !== 2 || shape[0] !== count || shape[1] !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Cloudflare 임베딩 응답의 벡터 크기가 올바르지 않습니다.");
  }

  if (!Array.isArray(data) || data.length !== count) {
    throw new Error("Cloudflare 임베딩 응답의 벡터 개수가 올바르지 않습니다.");
  }

  for (const vector of data) {
    if (!validVector(vector)) {
      throw new Error("Cloudflare 임베딩 응답에 올바르지 않은 벡터가 있습니다.");
    }
  }

  return data as number[][];
}

function validVector(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) return false;
  for (const n of value) {
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
  }
  return true;
}

// 취소 이유나 서버 오류에 들어 있을 수 있는 비밀 값은 외부로 전달하지 않는다.
function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("임베딩 요청이 취소되었습니다.", "AbortError");
  }
}
