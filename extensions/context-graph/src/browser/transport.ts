import type { ServerSpec } from "../types.ts";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
export const piRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(new URL("../../package.json", import.meta.url));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
    .href
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"))
    .href
);
export class RawMCP {
  spec: ServerSpec;
  client: any;
  transport: any;
  tools: any[] = [];
  constructor(spec: ServerSpec) {
    this.spec = spec;
  }
  async start() {
    this.client = new Client(
      { name: "pi-ec-context", version: "1.0.0" },
      { capabilities: {} },
    );
    this.transport = new StdioClientTransport({
      command: this.spec.command || process.execPath,
      args: this.spec.args,
      cwd: piRoot,
      stderr: "pipe",
    });
    this.transport.stderr?.resume(); // May contain inspected URLs: never log MCP stderr.
    try {
      await this.client.connect(this.transport);
      this.tools = (await this.client.listTools()).tools;
    } catch (error) {
      await this.close();
      throw new Error(`MCP 연결 실패 (${this.spec.id})`);
    }
    return this;
  }
  async call(name, args = {}) {
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 90000 },
    );
    if (result.isError) {
      const detail = (result.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const reason = detail.match(
        /net::ERR_[A-Z_]+|Could not find DevToolsActivePort|Unsafe[^\n]*|not enabled[^\n]*/,
      )?.[0];
      const error = new Error(
        `MCP ${this.spec.id}: ${name} 실패${reason ? " (" + reason + ")" : ""}`,
      );
      (error as Error & { detail: string }).detail = detail;
      throw error;
    }
    return result;
  }
  async close() {
    await this.client?.close().catch(() => {});
  }
}
