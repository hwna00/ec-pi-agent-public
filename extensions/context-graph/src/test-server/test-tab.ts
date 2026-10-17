import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserRegistry } from "../browser/browser-registry.ts";
import { leaseConnection } from "../browser/browser-session.ts";
import { serverSpec } from "../browser/mcp.ts";
import { MCPToolError } from "../browser/transport.ts";

const stateDirectory = fileURLToPath(
  new URL("../../../../.local/test-server-tabs/", import.meta.url),
);
const pathKey = (path: string) =>
  resolve(path).replace(/\\/g, "/").toLowerCase();
const fingerprint = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

type Marker = {
  version: 1;
  sessionId: string;
  status: "pending" | "ready";
  bindingId: string;
  updatedAt: string;
  browserId?: string;
  registry?: string;
  targetId?: string;
  browserInstance?: string;
};
type Lease = Awaited<ReturnType<typeof leaseConnection>>;
type Capture = {
  bindingId: string;
  captureId: string;
  lease: Lease;
  state: Map<string, unknown>;
};

export type TestTabOptions = {
  stateDir?: string;
  acquire?: typeof leaseConnection;
};
export type TestTabContext = {
  captureId: string;
  state: Map<string, unknown>;
  tools: any[];
  call(tool: string, args?: Record<string, unknown>): Promise<any>;
};

/** Session-owned test tab identity and collector lifetime, independent of tools. */
export class TestTab {
  private options: TestTabOptions;
  private captures = new Map<string, Capture>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(options: TestTabOptions = {}) {
    this.options = options;
  }
  private exclusive<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = (this.queues.get(sessionId) || Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.queues.set(sessionId, result);
    return result.finally(() => {
      if (this.queues.get(sessionId) === result) this.queues.delete(sessionId);
    });
  }
  private file(sessionId: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId))
      throw new Error("잘못된 Pi 세션 식별자입니다.");
    return join(this.options.stateDir || stateDirectory, `${sessionId}.json`);
  }
  private async marker(sessionId: string): Promise<Marker> {
    let value: Marker;
    try {
      value = JSON.parse(await readFile(this.file(sessionId), "utf8"));
    } catch {
      throw new Error("이 세션에서 /test-server를 먼저 실행하세요.");
    }
    if (
      value.version !== 1 ||
      value.sessionId !== sessionId ||
      typeof value.bindingId !== "string"
    )
      throw new Error(
        "테스트 탭 기록을 확인할 수 없습니다. /test-server를 다시 실행하세요.",
      );
    return value;
  }
  private async write(marker: Marker) {
    const file = this.file(marker.sessionId);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(marker, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, file);
  }
  private async current(sessionId: string, bindingId: string) {
    const marker = await this.marker(sessionId);
    if (marker.bindingId !== bindingId)
      throw new Error(
        "테스트 탭 연결이 변경되었습니다. /test-tab을 다시 실행하세요.",
      );
    return marker;
  }
  private async release(sessionId: string) {
    const capture = this.captures.get(sessionId);
    this.captures.delete(sessionId);
    await capture?.lease.release();
  }
  begin(sessionId: string) {
    return this.exclusive(sessionId, async () => {
      const bindingId = randomUUID();
      await this.write({
        version: 1,
        sessionId,
        status: "pending",
        bindingId,
        updatedAt: new Date().toISOString(),
      });
      await this.release(sessionId);
      return bindingId;
    });
  }
  bind(sessionId: string, browser: any, bindingId: string) {
    return this.exclusive(sessionId, async () => {
      await this.current(sessionId, bindingId);
      const { spec, connection, selectedPageId } = browser.mcp || {};
      if (
        spec?.provider !== "chrome" ||
        spec.sessionId !== sessionId ||
        !connection ||
        selectedPageId === undefined
      )
        throw new Error(
          "테스트 탭에는 같은 Pi 세션의 Chrome 연결이 필요합니다.",
        );
      const page = (await connection.describeCurrent()).pages.find(
        (item) => item.pageId === selectedPageId,
      );
      if (!page?.targetId)
        throw new Error("열린 테스트 탭의 고유 식별자를 확인할 수 없습니다.");
      // Retain the original collector, including initial navigation/login.
      const lease = await (this.options.acquire || leaseConnection)(spec);
      try {
        if (lease.connection !== connection)
          throw new Error(
            "테스트 탭의 수집 연결이 변경되었습니다. 다시 실행하세요.",
          );
        await this.current(sessionId, bindingId);
        await this.write({
          version: 1,
          sessionId,
          status: "ready",
          bindingId,
          browserId: spec.id,
          registry: connection.registry.root,
          targetId: page.targetId,
          browserInstance: fingerprint(connection.browser.wsEndpoint()),
          updatedAt: new Date().toISOString(),
        });
        await this.release(sessionId);
        this.captures.set(sessionId, {
          bindingId,
          captureId: randomUUID().replace(/-/g, "").slice(0, 16),
          lease,
          state: new Map(),
        });
      } catch (error) {
        await lease.release();
        throw error;
      }
    });
  }
  run<T>(
    sessionId: string,
    config: any,
    operation: (tab: TestTabContext) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(sessionId, () =>
      this.runCurrent(sessionId, config, operation),
    );
  }
  private async runCurrent<T>(
    sessionId: string,
    config: any,
    operation: (tab: TestTabContext) => Promise<T>,
  ): Promise<T> {
    const marker = await this.marker(sessionId);
    if (
      marker.status !== "ready" ||
      !marker.browserId ||
      !marker.registry ||
      !marker.targetId ||
      !marker.browserInstance
    )
      throw new Error(
        "열기가 완료된 테스트 탭이 없습니다. /test-server를 다시 실행하세요.",
      );
    const configured = (config?.browsers || [{ provider: "chrome" }]).find(
      (item) =>
        item.provider === "chrome" &&
        (item.id || "default") === marker.browserId &&
        pathKey(new BrowserRegistry(item.registry).root) ===
          pathKey(marker.registry!),
    );
    if (!configured)
      throw new Error(
        "테스트 탭의 브라우저 설정이 변경되었습니다. /test-server를 다시 실행하세요.",
      );
    const registry = new BrowserRegistry(marker.registry);
    const record = await registry.read(
      registry.file("browsers", marker.browserId),
    );
    if (
      typeof record?.endpoint !== "string" ||
      fingerprint(record.endpoint) !== marker.browserInstance
    )
      throw new Error(
        "테스트 탭의 Chrome 인스턴스가 변경되었습니다. /test-server를 다시 실행하세요.",
      );
    let capture = this.captures.get(sessionId);
    if (capture && capture.bindingId !== marker.bindingId) {
      await this.release(sessionId);
      capture = undefined;
    }
    if (!capture) {
      // Attach to the recorded browser only; reads never launch another one.
      const spec = serverSpec("chrome", {
        ...configured,
        sessionId,
        managedProfile: false,
        attachOnly: true,
        endpoint: record.endpoint,
      });
      const lease = await (this.options.acquire || leaseConnection)(spec);
      try {
        await this.current(sessionId, marker.bindingId);
        capture = {
          bindingId: marker.bindingId,
          captureId: randomUUID().replace(/-/g, "").slice(0, 16),
          lease,
          state: new Map(),
        };
        this.captures.set(sessionId, capture);
      } catch (error) {
        await lease.release();
        throw error;
      }
    }
    const connection = capture.lease.connection;
    const disconnected = async (error: unknown): Promise<never> => {
      if (error instanceof MCPToolError) throw error;
      await this.release(sessionId).catch(() => {});
      throw new Error(
        "테스트 탭의 MCP 연결이 끊겼습니다. /test-tab을 다시 실행하여 같은 테스트 탭에 재연결하세요.",
      );
    };
    const description = await connection.describeCurrent().catch(disconnected);
    const page = description.pages.find(
      (item) => item.targetId === marker.targetId,
    );
    if (!page)
      throw new Error(
        "저장한 테스트 탭이 닫혔습니다. /test-server로 다시 여세요.",
      );
    await this.current(sessionId, marker.bindingId);
    let active = true;
    const context: TestTabContext = {
      captureId: capture.captureId,
      state: capture.state,
      tools: connection.tools,
      call: async (name, args = {}) => {
        if (!active) throw new Error("테스트 탭 실행 범위가 종료되었습니다.");
        if (Object.prototype.hasOwnProperty.call(args, "pageId"))
          throw new Error(
            "pageId는 현재 세션의 테스트 탭으로 자동 지정됩니다.",
          );
        const tool = connection.tools.find((item) => item.name === name);
        if (!tool)
          throw new Error(
            `Chrome DevTools MCP 도구를 찾을 수 없습니다: ${name}`,
          );
        if (!tool.inputSchema?.properties?.pageId)
          throw new Error(
            "탭을 지정할 수 있는 Chrome DevTools MCP 도구가 필요합니다.",
          );
        await this.current(sessionId, marker.bindingId);
        const result = await connection
          .call(name, { ...args, pageId: page.pageId })
          .catch(disconnected);
        await this.current(sessionId, marker.bindingId);
        return result;
      },
    };
    try {
      const result = await operation(context);
      await this.current(sessionId, marker.bindingId);
      return result;
    } finally {
      active = false;
    }
  }
  call(
    sessionId: string,
    config: any,
    tool: string,
    args: Record<string, unknown> = {},
  ) {
    return this.run(sessionId, config, (tab) => tab.call(tool, args));
  }
  async close() {
    await Promise.allSettled([...this.queues.values()]);
    await Promise.all(
      [...this.captures.keys()].map((sessionId) => this.release(sessionId)),
    );
  }
}
