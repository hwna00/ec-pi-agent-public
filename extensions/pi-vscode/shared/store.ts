import { randomUUID } from "node:crypto";
import { DEFAULT_LIMIT, MAX_ENTRY_BYTES, MAX_HISTORY_ENTRIES, MAX_LIMIT } from "./limits.ts";
import {
  PROTOCOL_VERSION,
  type DebugConsoleEntry,
  type DebugConsolePage,
  type DebugSessionInfo,
} from "./types.ts";

export class BridgeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Session = Omit<DebugSessionInfo, "entryCount" | "droppedEntries">;
export type EntryInput = Omit<DebugConsoleEntry, "id" | "timestamp" | "truncated">;

// 길이를 줄일 때 한글이나 이모지가 중간에서 잘리지 않게 한다.
export function truncateUtf8(value: string, maxBytes: number): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, truncated: false };

  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;

  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

// DebugConsoleStore는 우리가 만든 저장소다. VS Code 창이 열려 있는 동안만 기록을 보관한다.
export class DebugConsoleStore {
  readonly instanceId: string;
  private readonly entries: DebugConsoleEntry[] = [];
  private readonly sessions = new Map<string, DebugSessionInfo>();
  private nextId = 1;

  constructor(instanceId: string = randomUUID()) {
    this.instanceId = instanceId;
  }

  upsertSession(session: Session): void {
    const previous = this.sessions.get(session.id);

    // 세션 정보가 바뀌어도 이미 모은 기록 수는 유지한다.
    this.sessions.set(session.id, {
      ...session,
      entryCount: previous?.entryCount ?? 0,
      droppedEntries: previous?.droppedEntries ?? 0,
    });
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.active = false;

    // 디버깅이 끝나도 기록이 남아 있으면 세션을 유지한다.
    this.pruneSessions();
  }

  private pruneSessions(): void {
    for (const [id, session] of this.sessions) {
      if (!session.active && session.entryCount === 0) this.sessions.delete(id);
    }
  }

  append(input: EntryInput): void {
    // 새 출력에 번호와 시각을 붙인다. 길이 제한은 저장할 때 한 번만 적용한다.
    const clipped = truncateUtf8(input.output, MAX_ENTRY_BYTES);
    this.entries.push({
      ...input,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      output: clipped.text,
      truncated: clipped.truncated,
    });

    const session = this.sessions.get(input.sessionId);
    if (session) session.entryCount++;

    // 저장 공간이 가득 차면 모든 세션 중 가장 오래된 기록 하나를 지운다.
    if (this.entries.length <= MAX_HISTORY_ENTRIES) return;

    const dropped = this.entries.shift()!;
    const droppedSession = this.sessions.get(dropped.sessionId);
    if (droppedSession) {
      droppedSession.entryCount--;
      droppedSession.droppedEntries++;
    }

    this.pruneSessions();
  }

  read(
    query: { limit?: number; before?: string; sessionId?: string },
    activeSessionId?: string,
  ): DebugConsolePage {
    // 1. 요청한 개수와 이전 페이지의 시작점을 확인한다.
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BridgeError(400, `limit must be an integer from 1 to ${MAX_LIMIT}`);
    }

    const beforeEntryId = this.readBeforeCursor(query.before);
    const cursorSessionId = this.entries.find((entry) => entry.id === beforeEntryId)?.sessionId;
    if (query.before !== undefined && cursorSessionId === undefined && query.sessionId === undefined) {
      throw new BridgeError(410, "Cursor entry was evicted; specify sessionId or read the latest page");
    }

    // 2. 지정한 세션 → 이전 페이지의 세션 → 활성 세션 → 마지막 출력 세션 순으로 고른다.
    const selectedSessionId =
      query.sessionId ?? cursorSessionId ?? activeSessionId ?? this.entries.at(-1)?.sessionId ?? null;
    if (query.sessionId !== undefined && !this.sessions.has(query.sessionId)) {
      throw new BridgeError(404, "Unknown debug sessionId");
    }

    // 3. 해당 세션의 기록을 고른다. 보관된 텍스트는 더 자르지 않는다.
    const candidates = this.entries.filter(
      (entry) => entry.sessionId === selectedSessionId && entry.id < beforeEntryId,
    );
    const entries = candidates.slice(-limit).map((entry) => ({ ...entry }));
    const hasMore = candidates.length > entries.length;
    const nextBefore = hasMore
      ? `${this.instanceId}:${entries[0]!.id}`
      : null;
    const selectedSession = selectedSessionId ? this.sessions.get(selectedSessionId) : undefined;

    // 4. 출력과 함께 다음 조회에 필요한 정보도 돌려준다.
    return {
      protocolVersion: PROTOCOL_VERSION,
      instanceId: this.instanceId,
      selectedSessionId,
      entries,
      requestedLimit: limit,
      nextBefore,
      hasMore,
      droppedEntries: selectedSession?.droppedEntries ?? 0,
      sessions: [...this.sessions.values()].map((session) => ({ ...session })),
    };
  }

  // 커서는 "저장소 번호:기록 번호"다. 이 기록보다 오래된 출력을 읽는다.
  private readBeforeCursor(cursor: string | undefined): number {
    if (cursor === undefined) return Infinity;

    const separator = cursor.lastIndexOf(":");
    const instanceId = cursor.slice(0, separator);
    const idText = cursor.slice(separator + 1);
    const entryId = Number(idText);
    if (separator < 1 || !/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(entryId)) {
      throw new BridgeError(400, "Invalid before cursor");
    }

    // 창을 다시 로드하면 저장소가 바뀐다. 예전 커서는 사용할 수 없다.
    if (instanceId !== this.instanceId) {
      throw new BridgeError(409, "VS Code reloaded; read the latest page to obtain a new cursor");
    }
    if (entryId >= this.nextId) throw new BridgeError(400, "Invalid before cursor");

    return entryId;
  }
}
