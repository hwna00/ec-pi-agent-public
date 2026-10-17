import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readJSON, piRoot } from "./state.ts";

export interface ContextGraphConnection {
  sessionId: string;
  browserId: string;
  registry: string;
  targetId: string;
  endpoint: string;
  bindingId: string;
  source: "verified" | "legacy";
}

export const registryRoot = (root?: string) =>
  root ?? join(homedir(), ".cache", "chrome-devtools-mcp", "registry");
export const pathKey = (path: string) =>
  resolve(path).replace(/\\/g, "/").toLowerCase();
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code });
};

/** Consume ContextGraph's persisted connection contract. Never write or launch. */
export async function readContextGraphConnection(
  sessionId: string,
  config: any = {},
  options: { stateDir?: string } = {},
): Promise<ContextGraphConnection> {
  if (!validId(sessionId))
    fail("context_connection_invalid", "잘못된 Pi 브라우저 연결 식별자입니다.");
  const browsers = config?.browsers || [{ provider: "chrome" }];
  if (!Array.isArray(browsers))
    fail(
      "context_config_invalid",
      "ContextGraph 브라우저 설정이 올바르지 않습니다.",
    );
  const configured = browsers
    .filter((browser: any) => browser?.provider === "chrome")
    .map((browser: any) => {
      const browserId = browser.id || "default";
      if (
        !validId(browserId) ||
        (browser.registry !== undefined && typeof browser.registry !== "string")
      )
        fail(
          "context_config_invalid",
          "ContextGraph 브라우저 설정이 올바르지 않습니다.",
        );
      return { browserId, registry: registryRoot(browser.registry) };
    });
  const absent = Symbol("absent");
  let marker: any;
  try {
    marker = readJSON(
      join(
        options.stateDir || join(piRoot, ".local", "context-connections"),
        `${sessionId}.json`,
      ),
      absent,
    );
  } catch {
    fail(
      "context_connection_invalid",
      "ContextGraph 연결 상태를 읽을 수 없습니다. /ec-connect로 다시 연결하세요.",
    );
  }
  const hasMarker = marker !== absent;
  if (hasMarker) {
    if (
      !marker ||
      marker.version !== 1 ||
      marker.sessionId !== sessionId ||
      !["pending", "ready"].includes(marker.status)
    )
      fail(
        "context_connection_invalid",
        "ContextGraph 연결 상태가 올바르지 않습니다. /ec-connect로 다시 연결하세요.",
      );
    if (marker.status === "pending")
      fail(
        "context_connection_pending",
        "ContextGraph 연결 검증이 완료되지 않았습니다. /ec-connect로 연결을 완료하세요.",
      );
    if (
      !validId(marker.browserId) ||
      typeof marker.registry !== "string" ||
      typeof marker.targetId !== "string" ||
      !marker.targetId ||
      typeof marker.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.updatedAt))
    )
      fail(
        "context_connection_invalid",
        "ContextGraph 연결 식별자가 올바르지 않습니다.",
      );
  }
  const selected = hasMarker
    ? configured.filter(
        (item) =>
          item.browserId === marker.browserId &&
          pathKey(item.registry) === pathKey(marker.registry),
      )
    : configured;
  if (hasMarker && !selected.length)
    fail(
      "context_config_changed",
      "ContextGraph 브라우저 설정이 변경되었습니다. /ec-connect로 다시 연결하세요.",
    );
  const connections = new Map<string, ContextGraphConnection>();
  for (const { browserId, registry } of selected) {
    const session = readJSON(join(registry, "sessions", `${sessionId}.json`), {
      version: 1,
      browsers: [],
    });
    if (
      !session ||
      session.version !== 1 ||
      !Array.isArray(session.browsers) ||
      (session.active !== undefined && !validId(session.active)) ||
      session.browsers.some(
        (item: any) =>
          !validId(item?.browserId) ||
          (item.targetId !== undefined && typeof item.targetId !== "string"),
      )
    )
      fail(
        "context_connection_invalid",
        "저장된 ContextGraph 세션 정보가 올바르지 않습니다.",
      );
    const pin = session.browsers.find(
      (item: any) => item.browserId === browserId,
    );
    if (!pin?.targetId) continue;
    if (hasMarker && pin.targetId !== marker.targetId)
      fail(
        "context_pin_changed",
        "ContextGraph 연결 탭이 변경되었습니다. /ec-connect로 다시 연결하세요.",
      );
    const browser = readJSON(join(registry, "browsers", `${browserId}.json`));
    let endpoint: URL;
    try {
      endpoint = new URL(browser?.endpoint);
    } catch {
      return fail(
        "context_browser_missing",
        "저장된 ContextGraph 브라우저 연결을 확인할 수 없습니다.",
      );
    }
    if (
      browser.version !== 1 ||
      browser.browserId !== browserId ||
      endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      fail(
        "context_browser_invalid",
        "저장된 ContextGraph Chrome 연결 주소가 올바르지 않습니다.",
      );
    const value = {
      sessionId,
      browserId,
      registry,
      targetId: pin.targetId as string,
      endpoint: endpoint.href,
      source: hasMarker ? ("verified" as const) : ("legacy" as const),
    };
    connections.set(
      JSON.stringify([pathKey(registry), browserId, pin.targetId]),
      {
        ...value,
        bindingId: createHash("sha256")
          .update(
            JSON.stringify({
              ...value,
              verifiedAt: hasMarker ? marker.updatedAt : null,
            }),
          )
          .digest("hex"),
      },
    );
  }
  if (connections.size !== 1)
    fail(
      connections.size ? "context_pin_ambiguous" : "context_pin_missing",
      connections.size
        ? "저장된 ContextGraph 탭이 여러 개입니다. /ec-connect로 사용할 탭을 연결하세요."
        : "현재 Pi 세션에 연결된 ContextGraph 탭이 없습니다. /ec-connect로 먼저 연결하세요.",
    );
  return [...connections.values()][0];
}
