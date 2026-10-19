import { readFile, copyFile, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { GraphService, ContextError, ref, key, parsePost } from "./graph.ts";
import { WorkspaceStore, WorkspaceSession } from "../workspace/workspace.ts";
import { LivePostReader, FixtureReader } from "./posts.ts";
import { siteTypes, abortable, dump, type ReaderBrowser } from "./site-api.ts";
import type { ReaderOptions } from "../types.ts";
export function currentFromDOM(text: string): string {
  const found: string[] = [];
  for (const [type, config] of Object.entries(siteTypes)) {
    const name = config.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      pattern = new RegExp(name + "\\s*View\\b", "g");
    for (const m of text.matchAll(pattern)) {
      const number = text
        .slice(m.index + m[0].length)
        .match(/(?:^|\n)\s*(\d+)\s*[|｜]/);
      if (number) found.push(type + ":" + number[1]);
    }
  }
  if (found.length !== 1)
    throw new ContextError(
      "Cannot unambiguously identify current detail popup",
    );
  return found[0];
}
export interface ReaderArguments {
  entry?: string;
  fixtures?: string;
  noDownloads: boolean;
  only: boolean;
  maxNodes: number;
  command: string;
  post?: string;
}
export function readerArguments(args: string[]): ReaderArguments {
  const rest: string[] = [],
    options: ReaderArguments = {
      noDownloads: false,
      only: false,
      maxNodes: Infinity,
      command: "",
    };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--entry", "--fixtures", "--max-nodes"].includes(a)) {
      const value = args[++i];
      if (!value) throw new ContextError("Missing " + a + " value");
      if (a === "--entry") options.entry = key(value);
      else if (a === "--fixtures") options.fixtures = resolve(value);
      else {
        options.maxNodes = Number(value);
        if (!Number.isInteger(options.maxNodes) || options.maxNodes < 1)
          throw new ContextError("Invalid node limit");
      }
    } else if (a === "--no-downloads") options.noDownloads = true;
    else if (a === "--only") {
      if (options.only) throw new ContextError("Duplicate --only option");
      options.only = true;
    } else if (a === "--recursive") continue;
    else if (a.startsWith("--")) throw new ContextError("Unknown option: " + a);
    else rest.push(a);
  }
  if (rest.length < 1 || rest.length > 2)
    throw new ContextError("Expected command and optional post reference");
  options.command = rest[0];
  options.post = rest[1];
  if (options.only && options.command !== "collect")
    throw new ContextError("--only is supported only for collect");
  return options;
}
export async function runReader(
  directory: string,
  args: string[],
  browser?: ReaderBrowser,
  options: ReaderOptions = {},
): Promise<string> {
  const controller = new AbortController(),
    cancelled = () =>
      Object.assign(new Error("컨텍스트 수집이 취소되었습니다."), {
        name: "AbortError",
      });
  const externalAbort = () => controller.abort(cancelled());
  if (options.signal?.aborted) throw cancelled();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error("컨텍스트 수집 제한 시간 초과. 기존 컨텍스트는 유지됩니다."),
      ),
    options.timeout ?? 15 * 60 * 1000,
  );
  try {
    const a = readerArguments(args),
      signal = controller.signal,
      store = new WorkspaceStore(directory, signal);
    if (a.command === "migrate-paths")
      return JSON.stringify(await store.locked(() => store.migratePaths()));
    if (a.command === "repair-grouping")
      return JSON.stringify(await store.locked(() => store.repairGrouping()));
    if (a.command === "list-contexts")
      return JSON.stringify(await store.locked(() => store.listContexts()));
    if (a.command === "assign-job") {
      if (!a.entry || !a.post)
        throw new ContextError("DP entry and local job reference required");
      return JSON.stringify(
        await store.locked(() => store.assignJob(a.entry!, key(a.post!))),
      );
    }
    if (a.command === "apply") {
      const entry = a.post ? key(a.post) : a.entry;
      if (!entry) throw new ContextError("Post reference required");
      return JSON.stringify(await store.locked(() => store.apply(entry)));
    }
    if (a.command === "save-test-account") {
      if (!a.entry || !options.testAccountUpdate)
        throw new ContextError("Entry and test account update required");
      return JSON.stringify(
        await store.locked(() =>
          store.saveTestAccount(a.entry!, options.testAccountUpdate!),
        ),
      );
    }
    if (["load", "context", "describe", "test-accounts"].includes(a.command)) {
      if (!a.entry) throw new ContextError("--entry is required");
      return JSON.stringify(
        await store.locked<unknown>(() =>
          a.command === "test-accounts"
            ? store.testAccounts(a.entry!)
            : store.describe(a.entry!),
        ),
      );
    }
    if (!browser && !a.fixtures)
      throw new ContextError("Browser connection required; run /ec-connect");
    const only =
      a.only ||
      (["add", "refresh"].includes(a.command) && a.entry
        ? (await store.locked(() => store.load(a.entry!))).only === true
        : false);
    const reader = a.fixtures
      ? new FixtureReader(a.fixtures)
      : new LivePostReader(browser!, join(store.internal, "captures"), signal, {
          includeParentJob: !only,
          includeParentJobMetadata: only,
        });
    const current = async () =>
      a.fixtures
        ? key(
            JSON.parse(
              await readFile(join(a.fixtures, "current.json"), "utf8"),
            ),
          )
        : currentFromDOM(
            (
              await abortable(
                browser!.evaluate!("() => ({text:document.body.innerText})"),
                signal,
              )
            ).text,
          );
    const downloader = a.noDownloads
      ? undefined
      : async (file, target, downloadSignal) => {
          if (a.fixtures) {
            if (!file.fixturePath)
              throw new ContextError("File download fixture is missing");
            const source = await realpath(
                resolve(a.fixtures, String(file.fixturePath)),
              ),
              base = await realpath(a.fixtures),
              r = relative(base, source);
            if (r === ".." || r.startsWith(".." + sep) || isAbsolute(r))
              throw new ContextError("File fixture escapes directory");
            await copyFile(source, target);
          } else {
            if (!browser!.download)
              throw new ContextError("Browser download unavailable");
            await browser!.download!(file, target, { signal: downloadSignal });
          }
        };
    const session = new WorkspaceSession(
      store,
      new GraphService(reader, a.maxNodes, signal),
      downloader,
    );
    let result: unknown;
    if (a.command === "read-current") {
      const r = ref(await current()),
        raw = await reader.readById(r.type, r.id),
        node = parsePost(raw),
        artifact = join(store.internal, "current-post.json");
      await dump(artifact, raw);
      result = {
        key: node.key,
        markdown_characters: node.data.length,
        artifact,
      };
    } else if (a.command === "collect") {
      if (!a.post) throw new ContextError("Post reference required");
      result = await session.collect(
        a.post === "current" ? await current() : key(a.post),
        { only: a.only },
      );
    } else if (["add", "refresh"].includes(a.command)) {
      if (!a.entry) throw new ContextError("--entry is required for updates");
      const add = a.command === "add";
      if (add && !a.post) throw new ContextError("Post reference required");
      result = await session.update(
        a.entry,
        a.post ? key(a.post) : undefined,
        add,
      );
    } else throw new ContextError("Unknown command: " + a.command);
    signal.throwIfAborted();
    return JSON.stringify(result);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}
