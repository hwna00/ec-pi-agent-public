import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { normalizeTimeLogDate } from "./payload.ts";
import {
  resolveTimeLogContext,
  type TimeLogContext,
  type TimeLogContextConfig,
} from "./context.ts";

export interface TimeLogSessionSource {
  sessionId: string;
  name: string;
  path: string | null;
  contextEntryId: string;
  entryKey: string;
  jobKey: string;
  fingerprint: string;
  contextFingerprint: string;
  /** Exact collected prefix. Later appends belong to the next draft. */
  snapshot?: { entryCount: number; lastEntryId: string };
  activityCount: number;
  firstActivity: string;
  lastActivity: string;
}
export interface TimeLogSessionRow {
  context: TimeLogContext;
  description: string;
  title: string;
  sources: TimeLogSessionSource[];
  /** Source dialogue for model-generated remarks; never sent to the ERP. */
  conversation?: TimeLogConversationMessage[];
}
export interface TimeLogConversationMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}
export interface TimeLogSkippedSession {
  sessionId: string;
  name: string;
  path: string | null;
  entryKey: string | null;
  reason:
    | "no_activity"
    | "missing_context"
    | "unresolved_context"
    | "missing_job"
    | "invalid_session";
  message: string;
}
export interface TimeLogSessionCollection {
  date: string;
  rows: TimeLogSessionRow[];
  skipped: TimeLogSkippedSession[];
  scanned: number;
}

type Entry = {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  customType?: string;
  data?: { entryKey?: unknown; jobKey?: unknown; version?: unknown };
  activityTime?: number;
  dialogue?: { role: "user" | "assistant"; text: string };
  targetId?: string;
  name?: string;
  hash: string;
};
type Header = {
  id: string;
  cwd: string;
  timestamp?: string;
  parentSession?: string;
};
type Snapshot = {
  header: Header;
  entries: Entry[];
  branch: Entry[];
  byId: Map<string, Entry>;
  inherited?: Set<string>;
  path: string | null;
  name: string;
};
type ActivityGroup = {
  selection: Entry;
  entries: Entry[];
  conversation: Entry[];
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: any) =>
  value && typeof value === "object" && !Array.isArray(value);
const cwdKey = (cwd: string) =>
  resolve(cwd).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
const sessionCwd = (ctx: any) =>
  ctx.sessionManager.getCwd?.() || ctx.cwd || process.cwd();
const kstDay = (time: number) =>
  new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
function dateValue(date: string) {
  const normalized = normalizeTimeLogDate(date, "시간로그 일자");
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function isActivity(message: any): boolean {
  if (
    !object(message) ||
    !["user", "assistant", "toolResult", "bashExecution"].includes(message.role)
  )
    return false;
  if (message.role === "toolResult" && message.toolName === "time_log_draft")
    return false;
  if (message.role === "assistant" && Array.isArray(message.content)) {
    const meaningful = message.content.filter(
      (part: any) => part?.type !== "thinking",
    );
    if (
      meaningful.length &&
      meaningful.every(
        (part: any) =>
          part?.type === "toolCall" && part.name === "time_log_draft",
      )
    )
      return false;
  }
  return true;
}

function compactEntry(
  value: any,
  index: number,
  linear: boolean,
  previous: Entry | undefined,
): Entry | null {
  if (
    !object(value) ||
    typeof value.type !== "string" ||
    value.type === "session"
  )
    return null;
  if (
    !linear &&
    (typeof value.id !== "string" ||
      !value.id ||
      !(value.parentId === null || typeof value.parentId === "string"))
  )
    return null;
  const appendedTime = Date.parse(value.timestamp);
  const messageTime = Number.isFinite(appendedTime)
    ? appendedTime
    : typeof value.message?.timestamp === "number" &&
        Number.isFinite(value.message.timestamp)
      ? value.message.timestamp
      : NaN;
  const entry: Entry = {
    id: linear ? String(index) : value.id,
    parentId: linear ? previous?.id || null : value.parentId,
    type: value.type,
    hash: hash(value),
  };
  if (typeof value.timestamp === "string") entry.timestamp = value.timestamp;
  if (value.type === "custom" && value.customType === "ec-context-session") {
    entry.customType = value.customType;
    if (object(value.data))
      entry.data = {
        entryKey: value.data.entryKey,
        ...("jobKey" in value.data ? { jobKey: value.data.jobKey } : {}),
        version: value.data.version,
      };
  }
  if (
    value.type === "message" &&
    isActivity(value.message) &&
    Number.isFinite(new Date(messageTime + 9 * 60 * 60 * 1000).getTime())
  )
    entry.activityTime = messageTime;
  if (
    entry.activityTime !== undefined &&
    ["user", "assistant"].includes(value.message?.role) &&
    (Array.isArray(value.message.content) ||
      typeof value.message.content === "string") &&
    (!Array.isArray(value.message.content) ||
      !value.message.content.some((part: any) => part?.type === "toolCall")) &&
    (!value.message.stopReason || value.message.stopReason === "stop")
  ) {
    const summary =
      typeof value.message.content === "string"
        ? value.message.content
        : value.message.content
            .filter(
              (part: any) =>
                part?.type === "text" && typeof part.text === "string",
            )
            .map((part: any) => part.text)
            .join("\n");
    if (summary.trim())
      entry.dialogue = { role: value.message.role, text: summary.trim() };
  }
  if (value.type === "context_edit" && typeof value.targetId === "string")
    entry.targetId = value.targetId;
  if (value.type === "session_info" && typeof value.name === "string")
    entry.name = value.name;
  return entry;
}

function snapshot(
  header: any,
  entries: Entry[],
  path: string | null,
): Snapshot {
  if (
    !object(header) ||
    typeof header.id !== "string" ||
    !header.id ||
    typeof header.cwd !== "string" ||
    !header.cwd ||
    (header.parentSession !== undefined &&
      typeof header.parentSession !== "string")
  )
    throw new Error("Pi 세션 헤더가 올바르지 않습니다.");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length)
    throw new Error("Pi 세션에 중복된 항목 ID가 있습니다.");
  for (const entry of entries) {
    if (entry.parentId !== null && !byId.has(entry.parentId))
      throw new Error("Pi 세션의 상위 항목이 없습니다.");
  }
  const complete = new Set<string>();
  for (const entry of entries) {
    const path = new Set<string>();
    let cursor: Entry | undefined = entry;
    while (cursor && !complete.has(cursor.id)) {
      if (path.has(cursor.id))
        throw new Error("Pi 세션의 분기 관계가 순환합니다.");
      path.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const id of path) complete.add(id);
  }
  const branch: Entry[] = [],
    seen = new Set<string>();
  let cursor = entries.at(-1);
  while (cursor) {
    if (seen.has(cursor.id))
      throw new Error("Pi 세션의 분기 관계가 순환합니다.");
    seen.add(cursor.id);
    branch.push(cursor);
    if (cursor.parentId === null) break;
    const parent = byId.get(cursor.parentId);
    if (!parent) throw new Error("Pi 세션의 상위 항목이 없습니다.");
    cursor = parent;
  }
  branch.reverse();
  return {
    header,
    entries,
    branch,
    byId,
    path,
    name:
      [...branch].reverse().find((entry) => entry.type === "session_info")
        ?.name || header.id,
  };
}

async function readSnapshot(
  path: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  signal?.throwIfAborted();
  let header: any;
  const entries: Entry[] = [];
  const input = createReadStream(path, { encoding: "utf8", signal });
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      signal?.throwIfAborted();
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error("Pi 세션 JSONL이 손상되었습니다.");
      }
      if (!header) {
        if (value.type !== "session")
          throw new Error("Pi 세션 헤더가 없습니다.");
        header = value;
        continue;
      }
      const entry = compactEntry(
        value,
        entries.length,
        Number(header.version || 1) < 2,
        entries.at(-1),
      );
      if (entry) entries.push(entry);
    }
    return snapshot(header, entries, path);
  } finally {
    reader.close();
    input.destroy();
  }
}

function currentSnapshot(ctx: any): Snapshot | null {
  const manager = ctx.sessionManager;
  const header = manager.getHeader?.();
  if (!header) return null;
  const values = manager.getEntries?.() || manager.getBranch?.() || [];
  const entries: Entry[] = [];
  for (const value of values) {
    const entry = compactEntry(
      value,
      entries.length,
      Number(header.version || 1) < 2,
      entries.at(-1),
    );
    if (entry) entries.push(entry);
  }
  return snapshot(header, entries, manager.getSessionFile?.() || null);
}

function analyze(source: Snapshot, date: string) {
  const groups = new Map<string, ActivityGroup>();
  const relevant: Entry[] = [];
  const activityIds = new Set<string>();
  let missingContext = 0;
  const cutoff = source.header.parentSession
    ? Date.parse(source.header.timestamp || "")
    : NaN;
  const selectedById = new Map<string, Entry | undefined>();
  const selectedAt = (entry: Entry): Entry | undefined => {
    const path: Entry[] = [],
      visited = new Set<string>();
    let cursor: Entry | undefined = entry,
      selected: Entry | undefined;
    while (cursor) {
      if (visited.has(cursor.id))
        throw new Error("Pi 세션의 분기 관계가 순환합니다.");
      visited.add(cursor.id);
      if (selectedById.has(cursor.id)) {
        selected = selectedById.get(cursor.id);
        break;
      }
      path.push(cursor);
      if (cursor.customType === "ec-context-session") {
        selected = cursor;
        break;
      }
      cursor = cursor.parentId ? source.byId.get(cursor.parentId) : undefined;
    }
    for (const item of path) selectedById.set(item.id, selected);
    return selected;
  };
  for (const entry of source.entries) {
    if (
      entry.activityTime === undefined ||
      kstDay(entry.activityTime) !== date ||
      (Number.isFinite(cutoff) &&
        (entry.activityTime < cutoff ||
          (entry.activityTime === cutoff && !source.inherited))) ||
      source.inherited?.has(`${entry.id}:${entry.hash}`)
    )
      continue;
    const selected = selectedAt(entry);
    relevant.push(entry);
    activityIds.add(entry.id);
    if (!selected?.data?.entryKey) {
      missingContext++;
      continue;
    }
    let group = groups.get(selected.id);
    if (!group) {
      group = { selection: selected, entries: [], conversation: [] };
      groups.set(selected.id, group);
    }
    group.entries.push(entry);
  }
  const usedSelections = new Set(
    [...groups.values()].map((group) => group.selection.id),
  );
  // The date selects sessions worked on that day. Remarks describe the closed
  // issue conversation, including its original request and final conclusion.
  // Keep only dialogue with the same explicit issue/job context, within the
  // collected snapshot. Later appends are included when collecting a new draft.
  const conversationIds = new Set<string>();
  for (const group of groups.values()) {
    const prefix = new Set<string>();
    let cursor = group.selection.parentId
      ? source.byId.get(group.selection.parentId)
      : undefined;
    let priorContext = false;
    while (cursor) {
      if (prefix.has(cursor.id))
        throw new Error("Pi 세션의 분기 관계가 순환합니다.");
      if (cursor.customType === "ec-context-session") {
        priorContext = true;
        break;
      }
      prefix.add(cursor.id);
      cursor = cursor.parentId ? source.byId.get(cursor.parentId) : undefined;
    }
    group.conversation = source.entries.filter((entry) => {
      if (!entry.dialogue) return false;
      const selected = selectedAt(entry);
      const matches =
        (!priorContext && prefix.has(entry.id)) ||
        (selected?.data?.entryKey === group.selection.data?.entryKey &&
          selected?.data?.jobKey === group.selection.data?.jobKey);
      if (matches) {
        conversationIds.add(entry.id);
        if (selected) usedSelections.add(selected.id);
      }
      return matches;
    });
  }
  const fingerprintEntries = source.entries.filter(
    (entry) =>
      activityIds.has(entry.id) ||
      conversationIds.has(entry.id) ||
      usedSelections.has(entry.id) ||
      (entry.type === "context_edit" &&
        (activityIds.has(entry.targetId || "") ||
          conversationIds.has(entry.targetId || ""))),
  );
  const fingerprint = hash({
    sessionId: source.header.id,
    cwd: cwdKey(source.header.cwd),
    date,
    entries: fingerprintEntries.map((entry) => [entry.id, entry.hash]),
  });
  return {
    groups,
    fingerprint,
    fingerprintIds: new Set(fingerprintEntries.map((entry) => entry.id)),
    activityCount: relevant.length,
    missingContext,
  };
}

async function identifyInherited(
  source: Snapshot,
  directory: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const parentReference = source.header.parentSession;
  if (!parentReference || !directory) return;
  const candidates = [resolve(source.header.cwd, parentReference)];
  if (basename(parentReference) === parentReference)
    candidates.push(join(directory, parentReference));
  for (const path of new Set(candidates)) {
    if (
      cwdKey(dirname(path)) !== cwdKey(directory) ||
      !path.endsWith(".jsonl") ||
      (source.path && cwdKey(path) === cwdKey(source.path))
    )
      continue;
    try {
      const parent = await readSnapshot(path, signal);
      if (cwdKey(parent.header.cwd) === cwdKey(source.header.cwd)) {
        source.inherited = new Set(
          parent.entries.map((entry) => `${entry.id}:${entry.hash}`),
        );
        return;
      }
    } catch {
      signal?.throwIfAborted();
    }
  }
}

async function resolveGroup(
  _ctx: any,
  source: Snapshot,
  group: ActivityGroup,
  config: TimeLogContextConfig,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const selection = group.selection;
  const storedJob =
    typeof selection.data?.jobKey === "string"
      ? selection.data.jobKey
      : config.jobKey;
  return resolveTimeLogContext(
    {
      cwd: source.header.cwd,
      sessionManager: {
        getSessionId: () => source.header.id,
        getBranch: () => [selection],
        getCwd: () => source.header.cwd,
      },
    },
    {
      ...config,
      resolveKnownJob: true,
      ...(storedJob ? { jobKey: storedJob } : {}),
    },
  );
}

/** Inspect only root Pi session files and the current manager; never open/migrate sessions. */
export async function collectTimeLogSessions(
  ctx: any,
  date: string,
  config: TimeLogContextConfig = {},
  signal?: AbortSignal,
): Promise<TimeLogSessionCollection> {
  date = dateValue(date);
  signal?.throwIfAborted();
  const manager = ctx.sessionManager;
  const directory =
    manager.getSessionDir?.() ||
    (manager.getSessionFile?.()
      ? dirname(manager.getSessionFile())
      : undefined);
  const skipped: TimeLogSkippedSession[] = [];
  const snapshots: Snapshot[] = [];
  const current = currentSnapshot(ctx);
  if (directory) {
    let files;
    try {
      files = await readdir(directory, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      files = [];
    }
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted();
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const path = join(directory, file.name);
      if (current?.path && cwdKey(current.path) === cwdKey(path)) continue;
      try {
        const source = await readSnapshot(path, signal);
        if (
          cwdKey(source.header.cwd) !== cwdKey(sessionCwd(ctx)) ||
          source.header.id === current?.header.id
        )
          continue;
        snapshots.push(source);
      } catch (error) {
        signal?.throwIfAborted();
        skipped.push({
          sessionId: file.name,
          name: file.name,
          path,
          entryKey: null,
          reason: "invalid_session",
          message:
            error instanceof Error ? error.message : "세션을 읽을 수 없습니다.",
        });
      }
    }
  }
  if (current && cwdKey(current.header.cwd) === cwdKey(sessionCwd(ctx)))
    snapshots.push(current);
  const rows = new Map<string, TimeLogSessionRow>();
  const notes = new Map<
    string,
    Array<TimeLogConversationMessage & { time: number }>
  >();
  for (const source of snapshots) {
    signal?.throwIfAborted();
    await identifyInherited(source, directory, signal);
    const activity = analyze(source, date);
    const skip = (
      reason: TimeLogSkippedSession["reason"],
      message: string,
      entryKey: string | null = null,
    ) =>
      skipped.push({
        sessionId: source.header.id,
        name: source.name,
        path: source.path,
        entryKey,
        reason,
        message,
      });
    if (!activity.activityCount) {
      skip("no_activity", "지정한 한국 날짜에 대화 또는 작업 기록이 없습니다.");
      continue;
    }
    if (activity.missingContext)
      skip(
        "missing_context",
        `${activity.missingContext}개 대화 또는 작업 기록에 적용된 맥락이 없습니다.`,
      );
    for (const group of activity.groups.values()) {
      try {
        const context = await resolveGroup(ctx, source, group, config, signal);
        if (!context.job) {
          skip(
            "missing_job",
            "거래에 연결된 작업 정보가 로컬에 없습니다.",
            context.entryKey,
          );
          continue;
        }
        const times = group.entries.map((entry) => entry.activityTime!);
        const evidence: TimeLogSessionSource = {
          sessionId: source.header.id,
          name: source.name,
          path: source.path,
          contextEntryId: group.selection.id,
          entryKey: context.entryKey,
          jobKey: context.job.entryKey,
          fingerprint: activity.fingerprint,
          contextFingerprint: hash(context),
          snapshot: {
            entryCount: source.entries.length,
            lastEntryId: source.entries.at(-1)!.id,
          },
          activityCount: times.length,
          firstActivity: new Date(
            times.reduce((first, time) => Math.min(first, time), Infinity),
          ).toISOString(),
          lastActivity: new Date(
            times.reduce((last, time) => Math.max(last, time), -Infinity),
          ).toISOString(),
        };
        const key = hash([
          context.project.code,
          context.job.bizzSid,
          context.job.dataSid,
          context.transaction.bizzSid,
          context.transaction.dataSid,
        ]);
        const row = rows.get(key);
        const texts = group.conversation
          .filter((entry) => entry.dialogue)
          .map((entry) => ({
            id: `${source.header.id}/${entry.id}`,
            sessionId: source.header.id,
            role: entry.dialogue!.role,
            text: entry.dialogue!.text,
            timestamp: new Date(entry.activityTime!).toISOString(),
            time: entry.activityTime!,
          }));
        notes.set(key, [...(notes.get(key) || []), ...texts]);
        if (row) row.sources.push(evidence);
        else
          rows.set(key, {
            context,
            description: context.transaction.name,
            title: context.transaction.name,
            sources: [evidence],
          });
      } catch (error) {
        signal?.throwIfAborted();
        skip(
          "unresolved_context",
          error instanceof Error
            ? error.message
            : "저장된 맥락을 확인할 수 없습니다.",
          typeof group.selection.data?.entryKey === "string"
            ? group.selection.data.entryKey
            : null,
        );
      }
    }
  }
  for (const [key, row] of rows)
    row.conversation = [
      ...new Map(
        (notes.get(key) || [])
          .sort((a, b) => a.time - b.time)
          .map((item) => [item.id, item]),
      ).values(),
    ].map(({ time: _time, ...item }) => item);
  return {
    date,
    rows: [...rows.values()],
    skipped,
    scanned:
      snapshots.length +
      skipped.filter((item) => item.reason === "invalid_session").length,
  };
}

/** Verify the captured work and references while allowing later appended work. */
export async function validateTimeLogSessionSources(
  ctx: any,
  date: string,
  sources: TimeLogSessionSource[],
  config: TimeLogContextConfig = {},
  signal?: AbortSignal,
): Promise<void> {
  date = dateValue(date);
  const current = currentSnapshot(ctx);
  const directory =
    ctx.sessionManager.getSessionDir?.() ||
    (ctx.sessionManager.getSessionFile?.()
      ? dirname(ctx.sessionManager.getSessionFile())
      : undefined);
  const loaded = new Map<string, Snapshot>();
  for (const evidence of sources) {
    signal?.throwIfAborted();
    let source =
      current?.header.id === evidence.sessionId ? current : undefined;
    if (!source) {
      if (!evidence.path)
        throw new Error(
          `${evidence.name}: 저장되지 않은 원본 세션을 확인할 수 없습니다.`,
        );
      source = loaded.get(evidence.path);
      if (!source) {
        source = await readSnapshot(evidence.path, signal);
        loaded.set(evidence.path, source);
      }
    }
    if (
      source.header.id !== evidence.sessionId ||
      cwdKey(source.header.cwd) !== cwdKey(sessionCwd(ctx))
    )
      throw new Error(
        `${evidence.name}: 원본 세션 또는 작업 경로가 변경되었습니다.`,
      );
    const changed = () =>
      new Error(
        `${evidence.name}: 해당 날짜의 대화, 작업 또는 적용 맥락이 변경되었습니다. 초안을 다시 만드세요.`,
      );
    let captured = source;
    // Older drafts have no boundary and retain their original strict check.
    if (evidence.snapshot !== undefined) {
      const boundary = evidence.snapshot;
      if (
        !object(boundary) ||
        !Number.isSafeInteger(boundary.entryCount) ||
        boundary.entryCount < 1 ||
        typeof boundary.lastEntryId !== "string" ||
        !boundary.lastEntryId ||
        source.entries[boundary.entryCount - 1]?.id !== boundary.lastEntryId
      )
        throw changed();
      const prefix = source.entries.slice(0, boundary.entryCount);
      captured = snapshot(source.header, prefix, source.path);
    }
    await identifyInherited(captured, directory, signal);
    const activity = analyze(captured, date);
    // Pi appends context edits. Protect the evidence already summarized while
    // allowing edits to later work or an unrelated conversation.
    if (
      captured !== source &&
      source.entries
        .slice(captured.entries.length)
        .some(
          (entry) =>
            entry.type === "context_edit" &&
            activity.fingerprintIds.has(entry.targetId || ""),
        )
    )
      throw changed();
    if (activity.fingerprint !== evidence.fingerprint) throw changed();
    const group = activity.groups.get(evidence.contextEntryId);
    if (!group)
      throw new Error(
        `${evidence.name}: 해당 날짜에 사용한 적용 맥락이 없습니다.`,
      );
    const context = await resolveGroup(
      ctx,
      captured,
      group,
      { ...config, jobKey: evidence.jobKey },
      signal,
    );
    if (hash(context) !== evidence.contextFingerprint)
      throw new Error(
        `${evidence.name}: 저장된 작업 또는 거래 정보가 변경되었습니다. 초안을 다시 만드세요.`,
      );
  }
}
