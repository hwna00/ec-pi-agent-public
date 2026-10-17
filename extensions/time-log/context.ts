import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJSON, piRoot } from "./state.ts";
import {
  digest,
  contextSessionEntry,
  parseReference,
  siteTypes,
  owner,
  record,
  missing,
  readStoredContext,
  type StoredContext,
  type PostNode,
  type PostType,
} from "./stored-context.ts";

export interface TimeLogReference {
  entryKey: string;
  type: PostType;
  number: string;
  bizzSid: string;
  bizzName: string;
  dataSid: string;
  name: string;
  plName?: string;
  source: "capture";
}

export interface TimeLogContext {
  sessionId: string;
  contextEntryId?: string;
  entryKey: string;
  only: boolean;
  project: { code: string | null; name: string | null };
  job: TimeLogReference | null;
  transaction: TimeLogReference;
}

export interface TimeLogContextConfig {
  contextDir?: string;
  /** Explicitly select a locally cached job when --only excluded its graph. */
  jobKey?: string;
  /** Resolve a confirmed owner from local cache without expanding its graph. */
  resolveKnownJob?: boolean;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const pick = (row: Record<string, any>, name: string) => {
  for (const key of ["board_s$" + name, "board_b$" + name, name])
    if (key in row) return row[key];
  return null;
};

function capturedPLName(metadata: Record<string, any>): string | null {
  const connection = record(metadata["board_s$conn_data_002"])
    ? metadata["board_s$conn_data_002"]
    : {};
  const sid =
    text(connection.sid) || text(metadata["board_s$conn_data_sid_002"]);
  const name =
    text(connection.name) || text(metadata["board_s$conn_data_nm_002"]);
  const flatSid = text(metadata["board_s$conn_data_sid_002"]);
  const business =
    text(connection.bizz_sid) ||
    text(metadata["board_s$conn_data_bizz_sid_002"]);
  if (
    !sid ||
    !name ||
    (flatSid && flatSid !== sid) ||
    (business && business !== "B_000000E074028")
  )
    return null;
  if (business === "B_000000E074028") return name;
  const prefix = "b_000000e074028_002$board_s$";
  const joinedBusiness =
    text(metadata[prefix + "bizz_sid"]) || text(metadata[prefix + "bizz"]?.sid);
  return joinedBusiness === "B_000000E074028" &&
    text(metadata[prefix + "data_sid"]) === sid
    ? name
    : null;
}

async function cachedJob(
  store: StoredContext,
  jobKey: string,
): Promise<PostNode> {
  const catalog = store.catalog;
  const item = catalog.posts[jobKey];
  if (!item) throw new Error(`${jobKey}: 로컬에 저장된 작업이 없습니다.`);
  const node = await store.readPost(jobKey);
  if (
    node.key !== jobKey ||
    node.type !== "job" ||
    item.type !== node.type ||
    item.number !== node.id ||
    item.title !== node.metadata.title ||
    owner(node) !== jobKey
  )
    throw new Error(`${jobKey}: 저장된 작업 메타데이터가 일치하지 않습니다.`);
  const markdown = await readFile(await store.safePath(item.path));
  if (digest(markdown) !== item.hash)
    throw new Error(`${jobKey}: 저장된 작업 파일이 변경되었습니다.`);
  return node;
}

/** Read complete, exact matching captures; never guess a SID from a display number. */
async function reference(
  store: StoredContext,
  node: PostNode,
  expectedOwner: string | null = owner(node),
): Promise<TimeLogReference> {
  const expected = siteTypes[node.type];
  const captureRoot = join(store.internal, "captures");
  let entries;
  try {
    entries = await readdir(await store.safePath(captureRoot), {
      withFileTypes: true,
    });
  } catch (error) {
    if (!missing(error)) throw error;
    entries = [];
  }
  const identities = new Map<string, { bizzSid: string; dataSid: string }>();
  const plNames = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(`${node.type}-${node.id}-`)
    )
      continue;
    const directory = join(captureRoot, entry.name);
    let capture, raw;
    try {
      // raw-post.json is written only after a capture finishes successfully.
      raw = JSON.parse(
        await readFile(
          await store.safePath(join(directory, "raw-post.json")),
          "utf8",
        ),
      );
      capture = JSON.parse(
        await readFile(
          await store.safePath(join(directory, "post.json")),
          "utf8",
        ),
      );
    } catch (error) {
      if (missing(error)) continue;
      throw new Error(`${node.key}: 완료된 로컬 캡처를 읽을 수 없습니다.`);
    }
    const metadata = record(capture?.metadata) ? capture.metadata : {};
    const identifiers = record(capture?.identifiers) ? capture.identifiers : {};
    const bizzSid = text(identifiers.bizz_sid);
    const dataSid = text(identifiers.data_sid);
    const rowBizz = pick(metadata, "bizz_sid");
    const rowSid = pick(metadata, "data_sid");
    const rowNumber = pick(metadata, "data_no");
    const capturedOwner = raw?.job?.number
      ? parseReference(`job:${raw.job.number}`)
      : node.type === "job"
        ? node.key
        : null;
    if (
      capture?.board !== expected.name ||
      String(capture?.number) !== node.id ||
      raw?.ref?.type !== node.type ||
      String(raw?.ref?.id) !== node.id ||
      bizzSid !== expected.bizz ||
      !dataSid ||
      !/^[a-z0-9_-]+$/i.test(dataSid) ||
      (rowBizz !== null && rowBizz !== bizzSid) ||
      (rowSid !== null && rowSid !== dataSid) ||
      (rowNumber !== null && String(rowNumber) !== node.id) ||
      (expectedOwner && capturedOwner && expectedOwner !== capturedOwner)
    )
      throw new Error(
        `${node.key}: 캡처의 게시글 번호, 업무, 거래 또는 연결 작업이 일치하지 않습니다.`,
      );
    identities.set(`${bizzSid}\0${dataSid}`, { bizzSid, dataSid });
    if (node.type === "job") {
      const plName = capturedPLName(metadata);
      if (plName) plNames.add(plName);
    }
  }
  if (!identities.size)
    throw new Error(
      `${node.key}: 거래 SID가 포함된 완료된 로컬 캡처가 없습니다. 실제 API 조회는 수행하지 않습니다.`,
    );
  if (identities.size !== 1)
    throw new Error(
      `${node.key}: 로컬 캡처에 서로 다른 거래 SID가 있습니다. 대상을 확정할 수 없습니다.`,
    );
  const identity = [...identities.values()][0];
  const name = text(node.metadata.title);
  if (!name) throw new Error(`${node.key}: 저장된 거래명이 없습니다.`);
  return {
    entryKey: node.key,
    type: node.type,
    number: node.id,
    ...identity,
    bizzName: expected.name,
    name,
    ...(plNames.size === 1 ? { plName: [...plNames][0] } : {}),
    source: "capture",
  };
}

/** Resolve the active Pi branch and its local ContextGraph without any network access. */
export async function resolveTimeLogContext(
  ctx: any,
  config: TimeLogContextConfig = {},
): Promise<TimeLogContext> {
  const manager = ctx.sessionManager;
  const selected = contextSessionEntry(manager);
  if (!selected?.data?.entryKey)
    throw new Error(
      "현재 세션에 적용된 맥락이 없습니다. 저장된 맥락을 /apply-context로 선택하세요.",
    );
  const entryKey = parseReference(selected.data.entryKey);
  const sessionId = manager.getSessionId();
  const initialSelection = JSON.stringify(selected);
  const saved = readJSON(
    process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
    {},
  );
  const store = await readStoredContext(
    resolve(
      ctx.cwd || manager.getCwd?.() || process.cwd(),
      process.env.ECOUNT_CONTEXT_DIR ||
        (config.contextDir === undefined
          ? saved.contextDir
          : config.contextDir) ||
        ".pi/context",
    ),
    entryKey,
  );
  const node = store.nodes.find((item) => item.key === entryKey)!;
  const knownOwner = owner(node);
  // A null selection records unknown ownership, including --only captures whose
  // grouping was later recovered locally. A known job must still match exactly.
  if (
    "jobKey" in selected.data &&
    selected.data.jobKey !== null &&
    selected.data.jobKey !== knownOwner
  )
    throw new Error(
      `${entryKey}: 세션에 적용된 작업과 현재 저장된 연결 작업이 다릅니다. 저장된 맥락을 다시 적용하세요.`,
    );
  let jobNode = store.nodes.find(
    (item) => item.key === knownOwner && item.type === "job",
  );
  if (config.jobKey) {
    const explicit = parseReference(config.jobKey);
    if (!explicit.startsWith("job:"))
      throw new Error("jobKey는 job:<번호> 형식이어야 합니다.");
    if (knownOwner && explicit !== knownOwner)
      throw new Error(
        `${entryKey}: 명시한 작업 ${explicit}이 저장된 연결 작업 ${knownOwner}과 다릅니다.`,
      );
    jobNode = jobNode || (await cachedJob(store, explicit));
  }
  if (!jobNode && knownOwner && config.resolveKnownJob)
    jobNode = await cachedJob(store, knownOwner);
  // This resolves local identifiers only; the collected graph remains scoped.
  const job = jobNode ? await reference(store, jobNode) : null;
  const transaction =
    node.type === "job" && job
      ? job
      : await reference(store, node, jobNode?.key || knownOwner);
  const projectCode =
    text(jobNode?.metadata.job?.projectCode) || text(store.projectCode);
  const projectName = text(jobNode?.metadata.title) || text(store.projectTitle);
  if (
    manager.getSessionId() !== sessionId ||
    JSON.stringify(contextSessionEntry(manager)) !== initialSelection
  )
    throw new Error(
      "맥락을 읽는 동안 Pi 세션 또는 적용된 맥락이 변경되었습니다. 다시 실행하세요.",
    );
  return {
    sessionId,
    ...(selected.id ? { contextEntryId: selected.id } : {}),
    entryKey,
    only: store.only === true,
    project: { code: projectCode, name: projectName },
    job,
    transaction,
  };
}
