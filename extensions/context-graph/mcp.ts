import type { ServerSpec, BrowserProvider, BrowserOptions } from "./types.ts";
import { createRequire } from "node:module";
import { resolve, dirname, isAbsolute } from "node:path";
import { RawMCP, piRoot } from "./transport.ts";
import { leaseConnection } from "./browser-session.ts";
export { piRoot };
const require = createRequire(import.meta.url);

export class MCP {
  spec: ServerSpec;
  lease?: Awaited<ReturnType<typeof leaseConnection>>;
  connection?: import("./browser-session.ts").BrowserConnection;
  raw?: RawMCP;
  tools: any[] = [];
  selectedPageId?: number;
  constructor(spec: ServerSpec) {
    this.spec = spec;
  }
  async start() {
    if (this.spec.piManaged) {
      this.lease = await leaseConnection(this.spec);
      this.connection = this.lease!.connection;
      this.tools = this.connection!.tools;
    } else {
      this.raw = await new RawMCP(this.spec).start();
      this.tools = this.raw!.tools;
    }
    return this;
  }
  async use() {
    return this.connection!.describeCurrent();
  }
  async remember(pageId) {
    return this.connection!.remember(pageId);
  }
  async call(name: string, args: Record<string, any> = {}) {
    if (!this.connection) return this.raw!.call(name, args);
    if (name === "select_page") {
      this.selectedPageId = args.pageId;
      return this.connection!.call(name, args);
    }
    const result = await this.connection!.call(name, args, this.selectedPageId);
    if (name === "new_page")
      this.selectedPageId = this.connection!.selectedPageId;
    return result;
  }
  async close() {
    await this.lease?.release();
    await this.raw?.close();
  }
}

export function serverSpec(
  provider: BrowserProvider,
  options: BrowserOptions = {},
): ServerSpec {
  if (!["chrome", "playwright"].includes(provider))
    throw new Error("Browser provider must be chrome or playwright");
  if (provider === "chrome") {
    const id = options.id || "default";
    const sessionId = options.sessionId;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId || ""))
      throw new Error("A stable Pi sessionId is required");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
      throw new Error("Invalid browser id");
    const mcpPath =
      options.localMcpPath ||
      resolve(
        dirname(require.resolve("chrome-devtools-mcp/package.json")),
        "build/src/bin/chrome-devtools-mcp.js",
      );
    if (!isAbsolute(mcpPath)) throw new Error("MCP path must be absolute");
    return {
      id,
      provider,
      sessionId,
      piManaged: true,
      reuseExisting: true,
      attachOnly: options.attachOnly,
      managedProfile: options.managedProfile,
      mcpPath,
      command: options.command,
      registry: options.registry,
      endpoint: options.endpoint,
      executablePath: options.executablePath,
      headless: options.headless,
    };
  }
  return {
    id: options.id || "playwright",
    provider,
    args: [
      resolve(
        dirname(require.resolve("@playwright/mcp/package.json")),
        "cli.js",
      ),
      "--browser",
      "chrome",
      ...(options.endpoint
        ? ["--cdp-endpoint", options.endpoint]
        : [
            "--user-data-dir",
            resolve(piRoot, ".local/ec-context/ec-browser"),
          ]),
      "--output-dir",
      resolve(piRoot, ".local/ec-context/mcp-output"),
    ],
  };
}
export function resultText(result): string {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
export function resultJSON(result) {
  const text = resultText(result);
  for (const source of [
    text,
    ...Array.from(
      text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g),
      (m) => m[1],
    ),
    text.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/)?.[1],
  ]) {
    if (!source) continue;
    try {
      return JSON.parse(source.trim());
    } catch {}
  }
  throw new Error("MCP JSON 응답을 해석할 수 없습니다.");
}
