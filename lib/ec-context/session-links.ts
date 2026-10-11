import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SessionManager,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { contextDirectory, privateJSON, readJSON } from "./session.ts";
import { piRoot } from "./transport.ts";
import type { ContextSummary } from "./workspace.ts";

type Reference = { entryKey: string; jobKey?: string | null };
type Relations = { references: Reference[]; currentEntryKey: string | null };
type CachedRelations = Relations & {
  path: string;
  size: number;
  mtimeMs: number;
};
type Entry = {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  data?: Record<string, unknown>;
};

export type LinkedSession = SessionInfo & {
  references: { entryKey: string; jobKey: string | null }[];
  currentEntryKey: string | null;
};

function validKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(job|dev|meeting|decision|tp|dp|hub):\d+$/.test(value) &&
    Number(value.split(":")[1]) > 0
  );
}
function validJob(value: unknown): value is string | null {
  return value === null || (validKey(value) && value.startsWith("job:"));
}
function reference(entry: Entry): Reference | null {
  const data = entry.data;
  if (!data || !validKey(data.entryKey)) return null;
  if (entry.customType === "session-label") return { entryKey: data.entryKey };
  if (entry.customType !== "ec-context-session") return null;
  if ("jobKey" in data) {
    if (!validJob(data.jobKey)) return null;
    return { entryKey: data.entryKey, jobKey: data.jobKey };
  }
  return { entryKey: data.entryKey };
}

// Read the saved tree without opening or migrating the session file.
function parseRelations(content: string): Relations {
  const entries: Entry[] = [];
  let header: Record<string, unknown> | undefined;
  for (const line of content.split("\n")) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!header) {
      if (value.type !== "session" || typeof value.id !== "string") break;
      header = value;
      continue;
    }
    if (typeof value.type !== "string" || value.type === "session") continue;
    const linear = Number(header.version || 1) < 2;
    if (
      !linear &&
      (typeof value.id !== "string" ||
        !value.id ||
        !(value.parentId === null || typeof value.parentId === "string"))
    )
      continue;
    entries.push({
      id: linear ? String(entries.length) : value.id,
      parentId: linear ? entries.at(-1)?.id || null : value.parentId,
      type: value.type,
      customType: value.type === "custom" ? value.customType : undefined,
      data:
        value.data &&
        typeof value.data === "object" &&
        !Array.isArray(value.data)
          ? value.data
          : undefined,
    });
  }
  const explicit = entries
    .filter((e) => e.customType === "ec-context-session")
    .map(reference)
    .filter((r): r is Reference => r !== null);
  const explicitKeys = new Set(explicit.map((r) => r.entryKey));
  const legacy = entries
    .filter((e) => e.customType === "session-label")
    .map(reference)
    .filter((r): r is Reference => r !== null && !explicitKeys.has(r.entryKey));
  const references = [
    ...new Map(
      [...explicit, ...legacy].map((r) => [JSON.stringify(r), r]),
    ).values(),
  ];

  const byId = new Map(entries.map((e) => [e.id, e]));
  const branch: Entry[] = [],
    seen = new Set<string>();
  let entry = entries.at(-1);
  while (entry && !seen.has(entry.id)) {
    seen.add(entry.id);
    branch.push(entry);
    entry = entry.parentId ? byId.get(entry.parentId) : undefined;
  }
  // An explicit clear takes precedence over any older label on this branch.
  const selected = branch.find(
    (e) =>
      e.customType === "ec-context-session" &&
      (e.data?.entryKey === null || reference(e)),
  );
  if (selected)
    return {
      references,
      currentEntryKey: reference(selected)?.entryKey || null,
    };
  const label = branch.find(
    (e) =>
      e.customType === "session-label" &&
      (reference(e) || e.data?.category === "default"),
  );
  return {
    references,
    currentEntryKey: label ? reference(label)?.entryKey || null : null,
  };
}

function cachedRelations(value: unknown): value is CachedRelations {
  if (!value || typeof value !== "object") return false;
  const item = value as CachedRelations;
  return (
    Object.keys(item).every((key) =>
      ["path", "size", "mtimeMs", "references", "currentEntryKey"].includes(
        key,
      ),
    ) &&
    typeof item.path === "string" &&
    Number.isFinite(item.size) &&
    item.size >= 0 &&
    Number.isFinite(item.mtimeMs) &&
    (item.currentEntryKey === null || validKey(item.currentEntryKey)) &&
    Array.isArray(item.references) &&
    item.references.every(
      (r) =>
        r &&
        validKey(r.entryKey) &&
        Object.keys(r).every((key) => ["entryKey", "jobKey"].includes(key)) &&
        (!("jobKey" in r) || validJob(r.jobKey)),
    )
  );
}

export async function listLinkedSessions(
  ctx,
  stored: ContextSummary[],
  signal?: AbortSignal,
): Promise<LinkedSession[]> {
  signal?.throwIfAborted();
  const config = readJSON(
    process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
    {},
  );
  const cachePath = join(
    contextDirectory(ctx, config),
    ".context",
    "session-links.json",
  );
  let cache: CachedRelations[] = [];
  let validCache = false;
  try {
    const saved = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      saved.version === 1 &&
      Object.keys(saved).every((key) =>
        ["version", "sessions"].includes(key),
      ) &&
      Array.isArray(saved.sessions) &&
      saved.sessions.every(cachedRelations)
    ) {
      cache = saved.sessions;
      validCache = true;
    }
  } catch {
    // Missing or corrupt derived data is rebuilt from the session originals.
  }
  const byPath = new Map(cache.map((item) => [item.path, item]));
  const posts = new Map(stored.map((post) => [post.key, post]));
  const sessions = await SessionManager.list(
    ctx.cwd,
    ctx.sessionManager.getSessionDir(),
    undefined,
    signal,
  );
  const nextCache: CachedRelations[] = [],
    linked: LinkedSession[] = [];
  for (const session of sessions) {
    signal?.throwIfAborted();
    try {
      let stats = await stat(session.path);
      let relations: Relations;
      const saved = byPath.get(session.path);
      if (
        saved &&
        saved.size === stats.size &&
        saved.mtimeMs === stats.mtimeMs
      ) {
        relations = saved;
        nextCache.push(saved);
      } else {
        let stable = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const content = await readFile(session.path, {
            encoding: "utf8",
            signal,
          });
          relations = parseRelations(content);
          const after = await stat(session.path);
          stable = after.size === stats.size && after.mtimeMs === stats.mtimeMs;
          stats = after;
          if (stable) break;
        }
        if (stable)
          nextCache.push({
            path: session.path,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            ...relations!,
          });
      }
      const references = relations!.references.map((ref) => ({
        entryKey: ref.entryKey,
        jobKey:
          "jobKey" in ref
            ? ref.jobKey!
            : ref.entryKey.startsWith("job:")
              ? ref.entryKey
              : posts.get(ref.entryKey)?.jobKey || null,
      }));
      if (references.length)
        linked.push({
          ...session,
          references,
          currentEntryKey: relations!.currentEntryKey,
        });
    } catch {
      signal?.throwIfAborted();
      // Deleted or unreadable sessions cannot prevent the others from loading.
    }
  }
  signal?.throwIfAborted();
  if (!validCache || JSON.stringify(cache) !== JSON.stringify(nextCache)) {
    try {
      privateJSON(cachePath, { version: 1, sessions: nextCache });
    } catch {
      // Resume remains usable when the optional cache cannot be saved.
    }
  }
  return linked;
}

export function filterLinkedSessions(
  sessions: LinkedSession[],
  target: { jobKey: string | null; entryKey?: string },
): LinkedSession[] {
  return sessions.filter((session) =>
    session.references.some(
      (ref) =>
        ref.jobKey === target.jobKey &&
        (!target.entryKey || ref.entryKey === target.entryKey),
    ),
  );
}
