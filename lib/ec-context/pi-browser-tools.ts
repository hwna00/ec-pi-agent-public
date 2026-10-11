import type { BrowserOptions } from "./types.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { RawMCP, piRoot } from "./transport.ts";
import { serverSpec } from "./mcp.ts";
import { BrowserRegistry } from "./browser-registry.ts";
import { leaseConnection } from "./browser-session.ts";

const exposed = [
  "list_pages",
  "new_page",
  "navigate_page",
  "list_network_requests",
  "get_network_request",
  "resend_network_request",
];
export default function installBrowserTools(
  pi,
  options: {
    config?: any;
    registry?: string;
    browserOptions?: BrowserOptions;
  } = {},
) {
  const sessions = new Map();
  let metadata;
  async function config() {
    return (
      options.config ??
      JSON.parse(
        await readFile(
          process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
          "utf8",
        ),
      )
    );
  }
  async function state(ctx) {
    const id = ctx.sessionManager.getSessionId();
    if (!sessions.has(id)) sessions.set(id, { id, leases: new Map() });
    return sessions.get(id);
  }
  async function connection(ctx, browserId = undefined, create = false) {
    const session = await state(ctx);
    const settings = await config();
    const defaults = settings.browsers?.[0] ?? {
      provider: "chrome",
      id: "default",
    };
    const registry = new BrowserRegistry(options.registry ?? defaults.registry);
    const saved = await registry.session(session.id);
    const id =
      browserId ?? session.active ?? saved.active ?? defaults.id ?? "default";
    if (!session.leases.has(id)) {
      const configured =
        settings.browsers?.find((browser) => browser.id === id) ?? defaults;
      const spec = serverSpec("chrome", {
        ...configured,
        ...options.browserOptions,
        id,
        registry: options.registry ?? configured.registry,
        sessionId: session.id,
      });
      session.leases.set(id, leaseConnection(spec, create));
    }
    session.active = id;
    await registry.bind(session.id, id);
    let lease;
    try {
      lease = await session.leases.get(id);
    } catch (error) {
      session.leases.delete(id);
      throw error;
    }
    if (sessions.get(session.id) !== session)
      throw new Error("Pi session changed while connecting");
    return lease.connection;
  }
  async function closeSessions() {
    const pending: Promise<unknown>[] = [];
    for (const session of sessions.values())
      for (const lease of session.leases.values())
        pending.push(
          lease.then(
            (value) => value.release(),
            () => {},
          ),
        );
    sessions.clear();
    await Promise.all(pending);
  }
  pi.registerTool({
    name: "resend_poc_browser_session",
    label: "Browser session (Pi)",
    description:
      "Pi-owned browser bindings. List, reuse, explicitly create a browser, or remember a tab. No custom Chrome DevTools MCP API is required.",
    parameters: Type.Object({
      action: Type.Union(
        ["list", "use", "create", "remember"].map((value) =>
          Type.Literal(value),
        ),
      ),
      sessionId: Type.Optional(Type.String()),
      browserId: Type.Optional(Type.String()),
      pageId: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      const session = await state(ctx);
      if (
        args.sessionId &&
        args.sessionId !== session.id &&
        args.action !== "list"
      ) {
        throw new Error("Use the current Pi session ID, or omit sessionId.");
      }
      if (args.action === "list") {
        const settings = await config();
        const registry = new BrowserRegistry(
          options.registry ?? settings.browsers?.[0]?.registry,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                session: await registry.session(args.sessionId ?? session.id),
                browsers: await registry.list(),
              }),
            },
          ],
          details: {},
        };
      }
      if (!args.browserId) throw new Error("browserId is required");
      const browser = await connection(
        ctx,
        args.browserId,
        args.action === "create",
      );
      if (args.action === "remember") {
        if (!args.pageId) throw new Error("pageId is required");
        return { ...(await browser.remember(args.pageId)), details: {} };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await browser.describeCurrent()),
          },
        ],
        details: {},
      };
    },
  });
  pi.on("session_start", async () => {
    await closeSessions();
    if (metadata) return;
    const settings = await config();
    const spec = serverSpec("chrome", {
      ...settings.browsers?.[0],
      sessionId: "metadata",
    });
    // Listing tools does not attach to or launch a browser.
    const probe = await new RawMCP({
      id: "metadata",
      command: spec.command,
      args: [
        spec.mcpPath!,
        "--autoConnect",
        "--no-usage-statistics",
        "--no-performance-crux",
      ],
    }).start();
    try {
      metadata = probe.tools;
    } finally {
      await probe.close();
    }
    for (const tool of metadata.filter((tool) => exposed.includes(tool.name))) {
      pi.registerTool({
        name: `resend_poc_${tool.name}`,
        label: tool.name,
        description: tool.description,
        parameters: Type.Unsafe(tool.inputSchema),
        async execute(_id, args, _signal, _update, ctx) {
          return {
            ...(await (await connection(ctx)).call(tool.name, args)),
            details: {},
          };
        },
      });
    }
  });
  pi.on("session_shutdown", closeSessions);
  return { close: closeSessions };
}
