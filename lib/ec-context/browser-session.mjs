// Pi owns browser lifetime and persistent identities. Upstream is a plain MCP client.
import { randomUUID } from "node:crypto";
import { BrowserRegistry } from "./browser-registry.mjs";
import { RawMCP } from "./transport.mjs";

const connections = new Map();
export function text(result) {
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}
export function json(result) {
  const value = text(result);
  for (const candidate of [
    value,
    ...Array.from(
      value.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g),
      (match) => match[1],
    ),
  ]) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error("Cannot read MCP JSON response");
}
export function pages(result) {
  return (
    result.structuredContent?.pages?.map((page) => ({
      pageId: page.id,
      selected: page.selected ?? page.isSelected,
    })) ||
    text(result)
      .split("\n")
      .flatMap((line) => {
        const match = /^(\d+):\s/.exec(line);
        return match
          ? [
              {
                pageId: Number(match[1]),
                selected: line.includes("[selected]"),
              },
            ]
          : [];
      })
  );
}

export class BrowserConnection {
  constructor(spec) {
    this.spec = spec;
    this.registry = new BrowserRegistry(spec.registry);
    this.queue = Promise.resolve();
  }
  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async start(create = false) {
    this.browser = await this.registry.acquire(this.spec.id, {
      create,
      endpoint: this.spec.endpoint,
      executablePath: this.spec.executablePath,
      headless: this.spec.headless,
    });
    try {
      this.upstream = await new RawMCP({
        id: this.spec.id,
        command: this.spec.command,
        args: [
          this.spec.mcpPath,
          "--wsEndpoint",
          this.browser.wsEndpoint(),
          "--no-usage-statistics",
          "--no-performance-crux",
        ],
      }).start();
      this.tools = this.upstream.tools;
      await this.registry.bind(this.spec.sessionId, this.spec.id);
      await this.restore();
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  // MCP does not expose CDP target IDs. A short-lived random page marker joins
  // the public pageId API with Pi's CDP connection, without matching URLs.
  async identities() {
    const listed = pages(await this.upstream.call("list_pages"));
    const key = `pi-browser-${randomUUID()}`;
    const marked = [];
    try {
      for (const page of await this.browser.pages()) {
        const cdp = await page.createCDPSession();
        let targetId;
        try {
          targetId = (await cdp.send("Target.getTargetInfo")).targetInfo
            .targetId;
        } finally {
          await cdp.detach();
        }
        await page.evaluate(
          ({ key, targetId }) => {
            Object.defineProperty(globalThis, key, {
              value: targetId,
              configurable: true,
            });
          },
          { key, targetId },
        );
        marked.push(page);
      }
      const result = [];
      for (const page of listed) {
        const targetId = json(
          await this.upstream.call("evaluate_script", {
            pageId: page.pageId,
            function: `() => globalThis[${JSON.stringify(key)}] ?? null`,
          }),
        );
        if (typeof targetId === "string") result.push({ ...page, targetId });
      }
      return result;
    } finally {
      await Promise.allSettled(
        marked.map((page) =>
          page.evaluate((key) => {
            delete globalThis[key];
          }, key),
        ),
      );
    }
  }
  async restore() {
    const state = await this.registry.session(this.spec.sessionId);
    const targetId = state.browsers.find(
      (item) => item.browserId === this.spec.id,
    )?.targetId;
    const current = await this.identities();
    const saved = current.find((page) => page.targetId === targetId);
    this.selectedPageId =
      saved?.pageId ??
      current.find((page) => page.selected)?.pageId ??
      current[0]?.pageId;
    if (this.selectedPageId !== undefined) {
      await this.upstream.call("select_page", {pageId:this.selectedPageId});
    }
    this.savedPageFound = Boolean(saved);
    return this.describe(current);
  }
  describe(current) {
    return {
      sessionId: this.spec.sessionId,
      browserId: this.spec.id,
      pages: current.map((page) => ({
        ...page,
        selected: page.pageId === this.selectedPageId,
      })),
      savedPageFound: this.savedPageFound,
    };
  }
  async describeCurrent() {
    return this.exclusive(async () => this.describe(await this.identities()));
  }
  async remember(pageId) {
    return this.exclusive(async () => {
      const page = (await this.identities()).find(
        (page) => page.pageId === pageId,
      );
      if (!page) throw new Error("Page is no longer available");
      await this.registry.bind(
        this.spec.sessionId,
        this.spec.id,
        page.targetId,
      );
      await this.upstream.call("select_page", {pageId});
      this.selectedPageId = pageId;
      this.savedPageFound = true;
      return {
        content: [{ type: "text", text: "Page identity saved by Pi." }],
      };
    });
  }
  async call(name, args = {}, selectedPageId) {
    return this.exclusive(async () => {
      const tool = this.tools.find((tool) => tool.name === name);
      if (!tool)
        throw new Error(
          `MCP tool ${name} is unavailable. Use a Chrome DevTools MCP version providing this tool.`,
        );
      const params = { ...args };
      if (tool.inputSchema.properties?.pageId && params.pageId === undefined) {
        params.pageId = selectedPageId ?? this.selectedPageId;
      }
      const result = await this.upstream.call(name, params);
      if (name === "select_page") this.selectedPageId = params.pageId;
      if (name === "new_page") {
        const current = pages(result);
        this.selectedPageId =
          current.find((page) => page.selected)?.pageId ??
          current.at(-1)?.pageId;
      }
      return result;
    });
  }
  async close() {
    await this.queue;
    await this.upstream?.close();
    await this.browser?.disconnect();
  }
}

export async function leaseConnection(spec, create = false) {
  const key = JSON.stringify([
    spec.registry,
    spec.sessionId,
    spec.id,
    spec.command,
    spec.mcpPath,
    spec.endpoint,
  ]);
  let entry = connections.get(key);
  if (!entry) {
    entry = { refs: 0, ready: new BrowserConnection(spec).start(create) };
    connections.set(key, entry);
  }
  entry.refs++;
  let connection;
  try {
    connection = await entry.ready;
  } catch (error) {
    if (connections.get(key) === entry) connections.delete(key);
    throw error;
  }
  let released = false;
  return {
    connection,
    async release() {
      if (released) return;
      released = true;
      if (--entry.refs === 0) {
        if (connections.get(key) === entry) connections.delete(key);
        await connection.close();
      }
    },
  };
}
