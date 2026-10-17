import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserRegistry } from "./browser-registry.ts";

const stateDirectory = fileURLToPath(
  new URL("../../../../.local/context-connections/", import.meta.url),
);
const identifier = (value: string) => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new Error("잘못된 Pi 브라우저 연결 식별자입니다.");
  return value;
};
const pathKey = (path: string) =>
  resolve(path).replace(/\\/g, "/").toLowerCase();

export interface ContextGraphConnection {
  sessionId: string;
  browserId: string;
  registry: string;
  targetId: string;
  endpoint: string;
  bindingId: string;
  source: "verified" | "legacy";
}

type StateOptions = { stateDir?: string };
type Marker = {
  version: 1;
  sessionId: string;
  status: "pending" | "ready";
  browserId?: string;
  registry?: string;
  targetId?: string;
  updatedAt: string;
};

export class ContextGraphConnectionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ContextGraphConnectionError";
    this.code = code;
  }
}

function markerPath(sessionId: string, options: StateOptions) {
  return join(
    options.stateDir || stateDirectory,
    `${identifier(sessionId)}.json`,
  );
}

async function writeMarker(
  sessionId: string,
  marker: Marker,
  options: StateOptions,
) {
  const file = markerPath(sessionId, options);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(marker, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

/** A new connection attempt revokes readiness, including legacy fallback. */
export async function beginContextGraphConnection(
  sessionId: string,
  options: StateOptions = {},
) {
  await writeMarker(
    sessionId,
    {
      version: 1,
      sessionId,
      status: "pending",
      updatedAt: new Date().toISOString(),
    },
    options,
  );
}

/** Called by ContextGraph only after its existing authenticated check succeeds. */
export async function markContextGraphConnection(
  sessionId: string,
  browser: any,
  options: StateOptions = {},
) {
  const connection = browser?.mcp?.connection;
  const registry = connection?.registry;
  const spec = browser?.mcp?.spec;
  // ContextGraph also supports other providers. Preserve their read workflow;
  // a pending marker deliberately prevents time-log from falling back to a
  // different Chrome tab when that provider has no durable target identity.
  if (spec?.provider !== "chrome") return;
  if (!registry || !spec.sessionId || browser.pageId === undefined)
    throw new ContextGraphConnectionError(
      "context_chrome_required",
      "시간로그 공유 연결에는 ContextGraph의 Chrome 연결이 필요합니다.",
    );
  if (spec.sessionId !== sessionId)
    throw new ContextGraphConnectionError(
      "context_session_changed",
      "ContextGraph 브라우저 연결의 Pi 세션이 변경되었습니다. 다시 연결하세요.",
    );
  const state = await registry.session(spec.sessionId);
  const pin = state.browsers.find((item: any) => item.browserId === browser.id);
  if (typeof pin?.targetId !== "string" || !pin.targetId)
    throw new ContextGraphConnectionError(
      "context_pin_missing",
      "ContextGraph 연결 탭의 저장된 식별자를 확인할 수 없습니다.",
    );
  const current = await connection.describeCurrent();
  const actual = current.pages.filter(
    (page: any) => page.pageId === browser.pageId,
  );
  if (actual.length !== 1 || actual[0].targetId !== pin.targetId)
    throw new ContextGraphConnectionError(
      "context_pin_changed",
      "인증 확인 중 ContextGraph 연결 탭의 식별자가 변경되었습니다. 다시 연결하세요.",
    );
  await writeMarker(
    sessionId,
    {
      version: 1,
      sessionId,
      status: "ready",
      browserId: browser.id,
      registry: registry.root,
      targetId: pin.targetId,
      updatedAt: new Date().toISOString(),
    },
    options,
  );
}

function configuredBrowsers(config: any) {
  const browsers = config?.browsers || [{ provider: "chrome" }];
  if (!Array.isArray(browsers))
    throw new ContextGraphConnectionError(
      "context_config_invalid",
      "ContextGraph 브라우저 설정이 올바르지 않습니다.",
    );
  return browsers
    .filter((browser: any) => browser?.provider === "chrome")
    .map((browser: any) => ({
      browserId: identifier(browser.id || "default"),
      registry: new BrowserRegistry(browser.registry),
    }));
}

async function savedConnection(
  sessionId: string,
  configured: ReturnType<typeof configuredBrowsers>[number],
  source: ContextGraphConnection["source"],
  marker?: Marker,
): Promise<ContextGraphConnection | null> {
  const { registry, browserId } = configured;
  const state = await registry.session(sessionId);
  const pin = state.browsers.find((item: any) => item.browserId === browserId);
  if (typeof pin?.targetId !== "string" || !pin.targetId) return null;
  if (marker && pin.targetId !== marker.targetId)
    throw new ContextGraphConnectionError(
      "context_pin_changed",
      "ContextGraph 연결 탭이 변경되었습니다. /ec-connect로 다시 연결하세요.",
    );
  const browser = await registry.read(registry.file("browsers", browserId));
  let endpoint: URL;
  try {
    endpoint = new URL(browser?.endpoint);
  } catch {
    throw new ContextGraphConnectionError(
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
    throw new ContextGraphConnectionError(
      "context_browser_invalid",
      "저장된 ContextGraph Chrome 연결 주소가 올바르지 않습니다.",
    );
  const value = {
    sessionId,
    browserId,
    registry: registry.root,
    targetId: pin.targetId,
    endpoint: endpoint.href,
    source,
  };
  return {
    ...value,
    bindingId: createHash("sha256")
      .update(
        JSON.stringify({ ...value, verifiedAt: marker?.updatedAt || null }),
      )
      .digest("hex"),
  };
}

/**
 * Read durable identity only: no browser startup, page selection, API or login.
 * New readiness records are authoritative. Before the first record exists,
 * accept exactly one pre-existing pin from ContextGraph's configured registry.
 */
export async function readContextGraphConnection(
  sessionId: string,
  config: any = {},
  options: StateOptions = {},
): Promise<ContextGraphConnection> {
  identifier(sessionId);
  const configured = configuredBrowsers(config);
  let marker: Marker | undefined;
  let markerExists = false;
  try {
    marker = JSON.parse(await readFile(markerPath(sessionId, options), "utf8"));
    markerExists = true;
  } catch (error: any) {
    if (error?.code !== "ENOENT")
      throw new ContextGraphConnectionError(
        "context_connection_invalid",
        "ContextGraph 연결 상태를 읽을 수 없습니다. /ec-connect로 다시 연결하세요.",
      );
  }
  if (markerExists) {
    if (
      !marker ||
      marker.version !== 1 ||
      marker.sessionId !== sessionId ||
      !["pending", "ready"].includes(marker.status)
    )
      throw new ContextGraphConnectionError(
        "context_connection_invalid",
        "ContextGraph 연결 상태가 올바르지 않습니다. /ec-connect로 다시 연결하세요.",
      );
    if (marker.status === "pending")
      throw new ContextGraphConnectionError(
        "context_connection_pending",
        "ContextGraph 연결 검증이 완료되지 않았습니다. /ec-connect로 연결을 완료하세요.",
      );
    if (
      typeof marker.registry !== "string" ||
      typeof marker.targetId !== "string" ||
      !marker.targetId ||
      typeof marker.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.updatedAt))
    )
      throw new ContextGraphConnectionError(
        "context_connection_invalid",
        "ContextGraph 연결 식별자가 올바르지 않습니다.",
      );
    const selected = configured.find(
      (item) =>
        item.browserId === marker!.browserId &&
        pathKey(item.registry.root) === pathKey(marker!.registry!),
    );
    if (!selected)
      throw new ContextGraphConnectionError(
        "context_config_changed",
        "ContextGraph 브라우저 설정이 변경되었습니다. /ec-connect로 다시 연결하세요.",
      );
    const connection = await savedConnection(
      sessionId,
      selected,
      "verified",
      marker,
    );
    if (!connection)
      throw new ContextGraphConnectionError(
        "context_pin_missing",
        "ContextGraph 연결 탭의 저장된 식별자가 없습니다. /ec-connect로 다시 연결하세요.",
      );
    return connection;
  }
  const connections: ContextGraphConnection[] = [];
  for (const browser of configured) {
    const connection = await savedConnection(sessionId, browser, "legacy");
    if (connection) connections.push(connection);
  }
  const unique = [
    ...new Map(
      connections.map((connection) => [
        JSON.stringify([
          pathKey(connection.registry),
          connection.browserId,
          connection.targetId,
        ]),
        connection,
      ]),
    ).values(),
  ];
  if (unique.length !== 1)
    throw new ContextGraphConnectionError(
      unique.length ? "context_pin_ambiguous" : "context_pin_missing",
      unique.length
        ? "저장된 ContextGraph 탭이 여러 개입니다. /ec-connect로 사용할 탭을 연결하세요."
        : "현재 Pi 세션에 연결된 ContextGraph 탭이 없습니다. /ec-connect로 먼저 연결하세요.",
    );
  return unique[0];
}
