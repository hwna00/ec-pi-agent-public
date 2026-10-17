import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { privateJSON } from "./state.ts";
import type { TimeLogPayload } from "./payload.ts";
import type { TimeLogSessionSource } from "./sessions.ts";
import type { TimeLogResponseDiagnostics } from "./transport.ts";
import type { RemarksGeneration } from "./summarize.ts";

export type DraftStatus = "draft" | "submitting" | "submitted" | "uncertain";
export interface TimeLogDraft {
  version: 1;
  id: string;
  sessionId: string;
  contextEntryId: string | null;
  entryKey: string | null;
  jobKey: string | null;
  host: string;
  createdAt: string;
  status: DraftStatus;
  payloadHash: string;
  reviewHash: string;
  profileHash: string;
  summary: string;
  payload: TimeLogPayload;
  scope?: "session" | "date";
  workDate?: string;
  inputPolicyVersion?: number;
  sources?: TimeLogSessionSource[];
  remarksGeneration?: RemarksGeneration;
  /** Daily save lock key; transport state is outside the reviewed content. */
  claimKey?: string;
  result?: { dataSid: string; boardNumber: number; title: string };
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new Error("잘못된 시간로그 식별자입니다.");
  return value;
}

export function draftPath(root: string, sessionId: string, id: string): string {
  return join(root, safeId(sessionId), safeId(id) + ".json");
}

export function responseDiagnosticsPath(
  root: string,
  sessionId: string,
  id: string,
): string {
  return join(root, safeId(sessionId), safeId(id) + ".response.json");
}

/** Persist only the bounded, credential-redacted transport diagnostics. */
export function saveResponseDiagnostics(
  root: string,
  draft: TimeLogDraft,
  diagnostics: TimeLogResponseDiagnostics,
): string {
  const path = responseDiagnosticsPath(root, draft.sessionId, draft.id);
  privateJSON(path, {
    version: 1,
    draftId: draft.id,
    payloadHash: draft.payloadHash,
    recordedAt: new Date().toISOString(),
    diagnostics,
  });
  return path;
}

function reviewHash(
  draft: Pick<
    TimeLogDraft,
    | "sessionId"
    | "contextEntryId"
    | "entryKey"
    | "jobKey"
    | "host"
    | "profileHash"
    | "summary"
    | "payload"
    | "scope"
    | "workDate"
    | "inputPolicyVersion"
    | "sources"
    | "remarksGeneration"
  >,
): string {
  return hashValue({
    sessionId: draft.sessionId,
    contextEntryId: draft.contextEntryId,
    entryKey: draft.entryKey,
    jobKey: draft.jobKey,
    host: draft.host,
    profileHash: draft.profileHash,
    summary: draft.summary,
    payload: draft.payload,
    scope: draft.scope,
    workDate: draft.workDate,
    inputPolicyVersion: draft.inputPolicyVersion,
    sources: draft.sources,
    remarksGeneration: draft.remarksGeneration,
  });
}

export function saveDraft(
  root: string,
  input: Omit<
    TimeLogDraft,
    "version" | "id" | "createdAt" | "status" | "payloadHash" | "reviewHash"
  >,
): TimeLogDraft {
  const draft: TimeLogDraft = {
    ...input,
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "draft",
    payloadHash: hashValue(input.payload),
    reviewHash: reviewHash(input),
  };
  privateJSON(draftPath(root, draft.sessionId, draft.id), draft);
  return draft;
}

export function readDraft(
  root: string,
  sessionId: string,
  id: string,
): TimeLogDraft {
  const draft = JSON.parse(
    readFileSync(draftPath(root, sessionId, id), "utf8"),
  ) as TimeLogDraft;
  if (
    draft.version !== 1 ||
    draft.sessionId !== sessionId ||
    draft.id !== id ||
    draft.payloadHash !== hashValue(draft.payload) ||
    draft.reviewHash !== reviewHash(draft)
  )
    throw new Error("시간로그 초안이 변경되었거나 다른 세션의 초안입니다.");
  return draft;
}

// A durable daily claim prevents concurrent/uncertain saves across Pi sessions.
// The legacy unscoped claim keeps its original permanent duplicate guard.
export function claimDraft(
  root: string,
  draft: TimeLogDraft,
  operationKey?: string,
): void {
  if (draft.status !== "draft")
    throw new Error(
      "이미 저장을 시도한 초안입니다. ERP에서 저장 여부를 확인하세요.",
    );
  const scoped = operationKey !== undefined;
  if (scoped && !operationKey.trim())
    throw new Error("시간로그 저장 범위를 확인할 수 없습니다.");
  const directory = scoped
    ? join(root, ".claims")
    : join(root, safeId(draft.sessionId));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const claimKey = scoped ? hashValue(operationKey) : draft.payloadHash;
  const claim = join(directory, claimKey + ".claim");
  if (existsSync(claim))
    throw new Error(
      "같은 요청의 저장을 이미 시도했습니다. ERP에서 저장 여부를 확인하세요.",
    );
  try {
    writeFileSync(
      claim,
      JSON.stringify({
        draftId: draft.id,
        sessionId: draft.sessionId,
        startedAt: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("같은 요청의 저장이 이미 진행 중입니다.");
    throw error;
  }
  const previousClaimKey = draft.claimKey;
  if (scoped) draft.claimKey = claimKey;
  draft.status = "submitting";
  try {
    privateJSON(draftPath(root, draft.sessionId, draft.id), draft);
  } catch (error) {
    // No transport has run. A local persistence failure must not retain a
    // newly acquired daily lock and block every other Pi session.
    try {
      removeClaim(root, draft);
    } catch {}
    draft.status = "draft";
    if (previousClaimKey === undefined) delete draft.claimKey;
    else draft.claimKey = previousClaimKey;
    // rename may have succeeded before a later chmod failed. Restore the disk
    // state when possible without replacing the original persistence error.
    try {
      privateJSON(draftPath(root, draft.sessionId, draft.id), draft);
    } catch {}
    throw error;
  }
}

export function finishDraft(
  root: string,
  draft: TimeLogDraft,
  result?: TimeLogDraft["result"],
): void {
  draft.status = result ? "submitted" : "uncertain";
  if (result) draft.result = result;
  privateJSON(draftPath(root, draft.sessionId, draft.id), draft);
  // A confirmed receipt is already durable. Cleanup must not turn it into an
  // uncertain write; a stale lock is safer than losing that receipt.
  if (result && draft.claimKey) {
    try {
      removeClaim(root, draft);
    } catch {}
  }
}

function activeClaimPath(root: string, draft: TimeLogDraft): string {
  return draft.claimKey
    ? join(root, ".claims", safeId(draft.claimKey) + ".claim")
    : join(root, safeId(draft.sessionId), draft.payloadHash + ".claim");
}

function removeClaim(root: string, draft: TimeLogDraft): void {
  const claim = activeClaimPath(root, draft);
  const owner = JSON.parse(readFileSync(claim, "utf8"));
  if (
    owner.draftId !== draft.id ||
    (draft.claimKey && owner.sessionId !== draft.sessionId)
  )
    throw new Error("다른 시간로그 초안의 전송 잠금입니다.");
  unlinkSync(claim);
}

/** Release only when the transport proves that no modifying request started. */
export function releaseDraft(root: string, draft: TimeLogDraft): void {
  const claim = activeClaimPath(root, draft);
  const owner = JSON.parse(readFileSync(claim, "utf8"));
  if (
    owner.draftId !== draft.id ||
    (draft.claimKey && owner.sessionId !== draft.sessionId)
  )
    throw new Error("다른 시간로그 초안의 전송 잠금입니다.");
  draft.status = "draft";
  privateJSON(draftPath(root, draft.sessionId, draft.id), draft);
  unlinkSync(claim);
}
