import { PROTOCOL_VERSION, type DebugConsolePage } from "../shared/types.ts";
import type { DebugRequest, DebugControlResult } from "../shared/debug.ts";
import { connectionUrl, type Connection } from "../shared/connection.ts";

export interface ReadParams {
  limit?: number;
  before?: string;
  sessionId?: string;
}

export async function readDebugConsole(
  connection: Connection,
  params: ReadParams = {},
  signal?: AbortSignal,
): Promise<DebugConsolePage> {
  return requestBridge(connection, "/debug-console", params, signal) as Promise<DebugConsolePage>;
}

export async function controlDebug(connection: Connection, params: DebugRequest, signal?: AbortSignal): Promise<DebugControlResult> {
  return requestBridge(connection, "/debug", params, signal) as Promise<DebugControlResult>;
}

async function requestBridge(connection: Connection, route: string, params: object, signal?: AbortSignal): Promise<DebugConsolePage | DebugControlResult> {
  // 이 컴퓨터의 VS Code에만 연결하고, 복사한 토큰으로 인증한다.
  const url = connectionUrl(connection);

  // 조회 조건을 보낸다. 기본값과 잘못된 조건의 검사는 서버에서 맡는다.
  url.pathname = route;
  const isControl = route === "/debug";
  if (!isControl) for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  // 조회는 5초, 디버그 제어는 최대 120초 기다린다. 취소는 원격 실행을 되돌리지 않는다.
  const timeout = AbortSignal.timeout(isControl ? 120_000 : 5_000);
  const response = await fetch(url, {
    method: isControl ? "POST" : "GET",
    headers: { Authorization: `Bearer ${connection.token}`, ...(isControl ? { "Content-Type": "application/json" } : {}) },
    body: isControl ? JSON.stringify(params) : undefined,
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  // JSON을 한 번 읽고, 서버의 오류 또는 보관된 출력 전체를 돌려준다.
  const page = await response.json();
  if (!response.ok) {
    throw new Error(typeof page?.error === "string" ? page.error : `VS Code bridge returned HTTP ${response.status}.`);
  }

  if (page?.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(isControl ? page?.runs : page?.entries)) {
    throw new Error("Incompatible pi-vscode bridge protocol. Update the Pi and VS Code extensions together.");
  }

  return page as DebugConsolePage | DebugControlResult;
}
