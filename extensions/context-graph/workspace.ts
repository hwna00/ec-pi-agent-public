import {
  mkdir,
  readFile,
  open,
  rename,
  rm,
  mkdtemp,
  lstat,
  readdir,
  rmdir,
} from "node:fs/promises";
import {
  resolve,
  relative,
  dirname,
  join,
  isAbsolute,
  sep,
  basename,
} from "node:path";
import { randomUUID } from "node:crypto";
import { lock } from "proper-lockfile";
import { setTimeout as delay } from "node:timers/promises";
import {
  ContextError,
  SnapshotError,
  GraphService,
  validate,
  serialize,
  digest,
  key,
  ref,
  graphJobKey,
  nodeJobKey,
  scopeGraph,
  type Graph,
  type PostNode,
  type Edge,
  type PostType,
  type CollectionOptions,
} from "./graph.ts";
import { htmlToMarkdown, tree, textContent, cleanURL } from "./html.ts";
import { abortable } from "./site-api.ts";
import { attachmentIdentity, isECDriveAttachment } from "./download.ts";
import type { Attachment, TestAccountUpdate } from "./types.ts";
import {
  effectiveTestAccounts,
  parseAccounts,
  replaceAccounts,
  sameAccount,
  storedAccount,
  targetAccount,
} from "./test-accounts.ts";
import { testURL } from "./session.ts";
import { recoverJobGrouping } from "./grouping-repair.ts";
export { parseAccounts } from "./test-accounts.ts";
export type { StoredAccount } from "./types.ts";
export const categories: Partial<Record<PostType, string>> = {
  plan: "기획",
  dev: "개발_스프린트",
  meeting: "회의록",
  decision: "방향결정",
  tp: "오류_수정",
  dp: "오류_수정",
  hub: "개발본부_Hub",
};
export function component(value: unknown): string {
  const text = String(value);
  const normalized = text.replace(/\s+/g, "_");
  let safe =
    normalized
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
      .trim()
      .replace(/^\.+|\.+$/g, "") || "file";
  if (safe !== normalized) safe += "-" + digest(text).slice(0, 8);
  if (safe.length > 180)
    safe = safe.slice(0, 170) + "-" + digest(text).slice(0, 8);
  return safe;
}
const quoted = (value: unknown) =>
  value == null ? "null" : JSON.stringify(String(value));
export function frontmatter(node: PostNode): string {
  const m = node.metadata,
    lines = [
      "---",
      "type: " + quoted(node.type),
      "number: " + quoted(node.id),
      "title: " + quoted(m.title ?? node.key),
    ];
  if (node.type === "job")
    lines.push("project_code: " + quoted(m.job?.projectCode));
  const targets = effectiveTestAccounts(m.testServers, m.manualTestAccounts);
  if (node.type === "tp" || targets.length) {
    lines.push(targets.length ? "test_accounts:" : "test_accounts: []");
    for (const t of targets)
      for (const [i, [name, value]] of Object.entries({
        server: t.server,
        company_code: t.company_code,
        account_id: t.account_id,
        password: t.password,
      }).entries())
        lines.push((i === 0 ? "  - " : "    ") + name + ": " + quoted(value));
  }
  return lines.concat("---", "").join("\n");
}
const link = (label: string, source: string, target: string) =>
  "[" +
  label.replace(/([\[\]])/g, "\\$1") +
  "](<" +
  relative(dirname(source), target).split(sep).join("/") +
  ">)";
export function renderPost(
  node: PostNode,
  path: string,
  paths: Map<string, string>,
  edges: Edge[],
  root: string,
): string {
  const m = node.metadata,
    base = m.sourceUrl || "https://logine.ecount.com",
    title = m.title ?? node.key,
    lines = [frontmatter(node), "# " + title, "", "## 내용 요약", ""];
  const missingAreas = [
    ...(m.failedWidgets || []).map((w) => w.label),
    ...(m.failedAttachments || []).map((f) =>
      f.owner === "본문" ? "본문 첨부" : "답글 첨부",
    ),
  ];
  if (missingAreas.length)
    lines.push(
      "수집하지 못한 영역: " +
        [...new Set(missingAreas)].join(", ") +
        ". /load-context " +
        node.key +
        "로 재수집하세요.",
      "",
    );
  const relationStart = node.data.lastIndexOf("\n\n## 게시글 관계\n\n"),
    body = relationStart >= 0 ? node.data.slice(0, relationStart) : node.data,
    source = (m.sections || []).map((s) => s.html).join(" ") || body,
    text = textContent(tree(source)).replace(/\s+/g, " ").trim();
  lines.push(
    text
      ? text.slice(0, 400) + (text.length > 400 ? "…" : "")
      : "본문이 없습니다.",
  );
  if (m.sections !== undefined) {
    m.sections.forEach((s, i) => {
      const content = htmlToMarkdown(s.html, base);
      if (content)
        lines.push(
          "",
          "## " + (s.label || (i === 0 ? "본문" : "추가 본문")),
          "",
          content,
        );
    });
    if (m.replies?.length) lines.push("", "## 답글", "");
    for (const r of m.replies || [])
      lines.push(
        "### 답글 " +
          r.number +
          (r.parentNumber != null
            ? " (답글 " + r.parentNumber + "에 대한 답글)"
            : "") +
          (r.writer ? " · " + r.writer : ""),
        "",
        htmlToMarkdown(r.html, base),
        "",
      );
  } else lines.push("", "## 본문", "", body);
  const owned = edges.filter((e) => e.from === node.key && paths.has(e.to)),
    names = {
      belongs_to: "연결 작업",
      attach_to: "첨부 게시글",
      related_to: "관련 게시글",
    };
  if (owned.length) lines.push("", "## 관련 게시글", "");
  for (const e of owned.sort((a, b) =>
    (a.relation + a.to).localeCompare(b.relation + b.to),
  ))
    lines.push(
      "- " + names[e.relation] + ": " + link(e.to, path, paths.get(e.to)!),
    );
  if (m.files?.length) lines.push("", "## 첨부 파일", "");
  for (const f of m.files || []) {
    const name = f.name || "첨부파일",
      size = f.size != null ? " (" + f.size + " bytes)" : "";
    lines.push(
      "- " +
        (f.storedPath
          ? link(name, path, resolve(root, String(f.storedPath))) + size
          : name + size + " · " + (f.downloadStatus || "not_downloaded")),
    );
  }
  return lines.join("\n").trimEnd() + "\n";
}
interface CatalogPost {
  path: string;
  rootPath: string;
  hash: string;
  type: PostType;
  number: string;
  title: string;
}
interface Catalog {
  version: number;
  posts: Record<string, CatalogPost>;
  entries: Record<string, { nodes: string[]; only?: true }>;
  indexes?: Record<string, string>;
}
export interface ContextSummary {
  key: string;
  type: PostType;
  number: string;
  title: string;
  jobKey: string | null;
  projectCode: string | null;
  projectTitle: string | null;
}
export type Downloader = (
  file: Attachment,
  target: string,
  signal?: AbortSignal,
) => Promise<unknown>;
const missing = (e: unknown) =>
  e instanceof Error && "code" in e && e.code === "ENOENT";
export class WorkspaceStore {
  directory: string;
  internal: string;
  signal?: AbortSignal;
  constructor(directory: string, signal?: AbortSignal) {
    this.directory = resolve(directory);
    this.internal = join(this.directory, ".context");
    this.signal = signal;
  }
  path(value: string): string {
    const target = resolve(this.directory, value),
      r = relative(this.directory, target);
    if (r === ".." || r.startsWith(".." + sep) || isAbsolute(r))
      throw new SnapshotError("Path escapes workspace");
    return target;
  }
  async safePath(value: string): Promise<string> {
    const target = this.path(value);
    let cursor = this.directory;
    // Refuse symbolic links in every existing path component, including the root.
    const parts = relative(this.directory, target).split(sep).filter(Boolean);
    for (const part of ["", ...parts]) {
      cursor = join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new SnapshotError("Workspace path contains a symbolic link");
      } catch (e) {
        if (missing(e)) break;
        throw e;
      }
    }
    return target;
  }
  async locked<T>(operation: () => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    await this.safePath(this.internal);
    await mkdir(this.internal, { recursive: true });
    let release: () => Promise<void>;
    for (;;) {
      this.signal?.throwIfAborted();
      try {
        release = await lock(this.internal, {
          realpath: false,
          stale: 30000,
          update: 10000,
          retries: 0,
        });
        break;
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "ELOCKED"))
          throw e;
        await delay(100, undefined, { signal: this.signal });
      }
    }
    try {
      this.signal?.throwIfAborted();
      return await operation();
    } finally {
      await release();
    }
  }
  async catalog(): Promise<Catalog> {
    try {
      const c = JSON.parse(
        await readFile(
          await this.safePath(join(this.internal, "catalog.json")),
          "utf8",
        ),
      );
      if (c.version !== 1 || !c.posts || !c.entries) throw new Error();
      return c;
    } catch (e) {
      if (missing(e)) return { version: 1, posts: {}, entries: {} };
      throw new SnapshotError("Workspace catalog is invalid; reload required");
    }
  }
  slug(k: string) {
    const r = ref(k);
    return r.type + "-" + component(r.id) + ".json";
  }
  nodePath(k: string) {
    return join(this.internal, "posts", this.slug(k));
  }
  entryPath(k: string) {
    return join(this.internal, "entries", this.slug(k));
  }
  onlyIndexPath(k: string, root = this.directory) {
    return join(
      root,
      ".context",
      "only",
      this.slug(k).slice(0, -5),
      "index.md",
    );
  }
  locations(node: PostNode): [string, string] {
    const job = node.metadata.job,
      number = node.type === "job" ? node.id : job?.number;
    let root: string,
      category = "";
    if (number) {
      root = join(
        ...(job?.projectCode ? [component(job.projectCode)] : []),
        "job_" + component(number),
      );
      if (node.type !== "job") category = categories[node.type] || "";
    } else root = node.type + "_" + component(node.id);
    return [
      this.path(
        join(root, category, node.type + "_" + component(node.id) + ".md"),
      ),
      this.path(root),
    ];
  }
  async replace(path: string, data: Buffer) {
    await this.safePath(path);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), ".context-" + randomUUID());
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async transaction(writes: Map<string, Buffer>, removals: string[] = []) {
    const previous = new Map<string, Buffer | null>();
    for (const path of new Set([...writes.keys(), ...removals])) {
      await this.safePath(path);
      try {
        previous.set(path, await readFile(path));
      } catch (e) {
        if (!missing(e)) throw e;
        previous.set(path, null);
      }
    }
    this.signal?.throwIfAborted();
    try {
      for (const [path, data] of writes) {
        this.signal?.throwIfAborted();
        await this.replace(path, data);
      }
      for (const path of removals) {
        this.signal?.throwIfAborted();
        await rm(path);
      }
    } catch (e) {
      for (const [path, data] of previous) {
        if (data === null) await rm(path, { force: true });
        else await this.replace(path, data);
      }
      throw e;
    }
  }
  private renderWrites(
    catalog: Catalog,
    nodes: Map<string, PostNode>,
    entries: Map<string, Graph>,
  ) {
    const paths = new Map<string, string>(),
      roots = new Map<string, string>(),
      grouped = new Map<string, string[]>(),
      writes = new Map<string, Buffer>(),
      edges = [...nodes.values()].flatMap(
        (node) => node.metadata.workspaceEdges || [],
      );
    for (const [entry, node] of nodes) {
      const [path, root] = this.locations(node);
      paths.set(entry, path);
      roots.set(entry, root);
    }
    for (const [entry, node] of nodes) {
      const path = paths.get(entry)!,
        root = roots.get(entry)!,
        data = Buffer.from(
          renderPost(node, path, paths, edges, this.directory),
        );
      writes.set(path, data);
      writes.set(this.nodePath(entry), serialize(node));
      catalog.posts[entry] = {
        path: relative(this.directory, path),
        rootPath: relative(this.directory, root),
        hash: digest(data),
        type: node.type,
        number: node.id,
        title: node.metadata.title ?? entry,
      };
      if (!grouped.has(root)) grouped.set(root, []);
      grouped.get(root)!.push(entry);
    }
    for (const [root, keys] of grouped) {
      const index = join(root, "index.md"),
        title = basename(root) + " 게시글 목록",
        data = Buffer.from(
          [
            "---",
            'type: "index"',
            "number: null",
            "title: " + quoted(title),
            "---",
            "",
            "# " + title,
            "",
            ...keys
              .sort()
              .map((entry) => "- " + link(entry, index, paths.get(entry)!)),
            "",
          ].join("\n"),
        );
      writes.set(index, data);
      (catalog.indexes ??= {})[relative(this.directory, index)] = digest(data);
    }
    for (const [entry, previous] of entries) {
      const keys = new Set(previous.nodes.map((node) => node.key)),
        current: Graph = {
          entryKey: entry,
          ...(previous.only ? { only: true as const } : {}),
          nodes: previous.nodes.map((node) => nodes.get(node.key)!),
          edges: previous.only
            ? previous.edges
            : edges.filter((edge) => keys.has(edge.from) && keys.has(edge.to)),
        },
        graph = validate(scopeGraph(current));
      catalog.entries[entry] = {
        nodes: graph.nodes.map((node) => node.key),
        ...(graph.only ? { only: true as const } : {}),
      };
      writes.set(this.entryPath(entry), serialize(graph));
      if (graph.only) {
        const index = this.onlyIndexPath(entry, roots.get(entry)!),
          data = Buffer.from(
            [
              "---",
              'type: "index"',
              "number: null",
              "title: " + quoted(entry + " 수집 범위"),
              "---",
              "",
              "# " + entry + " 수집 범위",
              "",
              "선택 게시글과 명시적으로 참조한 게시글만 포함합니다.",
              "",
              ...graph.nodes.map(
                (node) => "- " + link(node.key, index, paths.get(node.key)!),
              ),
              "",
            ].join("\n"),
          );
        writes.set(index, data);
        (catalog.indexes ??= {})[relative(this.directory, index)] =
          digest(data);
      }
    }
    writes.set(join(this.internal, "catalog.json"), serialize(catalog));
    return writes;
  }
  async repairGrouping() {
    const recovered = await recoverJobGrouping(this);
    const result = await this.migratePaths(recovered);
    return { ...result, repaired: [...recovered.keys()].sort() };
  }
  async migratePaths(replacements = new Map<string, PostNode>()) {
    const catalog = await this.catalog(),
      nodes = new Map<string, PostNode>(),
      entries = new Map<string, Graph>(),
      moves = new Map<string, string>(),
      targetRoots = new Map<string, string>(),
      oldFiles = new Set<string>(),
      attachments = new Map<string, Buffer>();
    const moving = (source: string, target: string) => {
      oldFiles.add(source);
      moves.set(source, target);
    };
    for (const entry of Object.keys(catalog.posts).sort()) {
      this.signal?.throwIfAborted();
      const stored = await this.storedNode(entry, catalog),
        node = replacements.get(entry) || stored,
        item = catalog.posts[entry],
        oldRoot = this.path(item.rootPath),
        oldPath = this.path(item.path),
        [newPath, newRoot] = this.locations(node),
        oldIndex = join(oldRoot, "index.md");
      if (
        !replacements.has(entry) &&
        targetRoots.has(newRoot) &&
        targetRoots.get(newRoot) !== oldRoot
      )
        throw new SnapshotError(
          "Normalized group paths collide; migration cancelled",
          entry,
        );
      if (!replacements.has(entry)) targetRoots.set(newRoot, oldRoot);
      await this.verifyFile(oldPath, item.hash, entry);
      await this.verifyFile(
        oldIndex,
        catalog.indexes?.[relative(this.directory, oldIndex)],
        entry,
      );
      moving(oldPath, newPath);
      moving(oldIndex, join(newRoot, "index.md"));
      for (const file of node.metadata.files || []) {
        if (!file.storedPath) continue;
        const source = this.path(String(file.storedPath)),
          within = relative(oldRoot, source);
        if (
          within === ".." ||
          within.startsWith(".." + sep) ||
          isAbsolute(within)
        )
          throw new SnapshotError("Attachment escapes its stored group", entry);
        const parts = within
          .split(sep)
          .map((part) => part.replace(/\s+/g, "_"));
        if (
          replacements.has(entry) &&
          node.type !== "job" &&
          basename(oldRoot) === node.type + "_" + component(node.id) &&
          node.metadata.job?.number &&
          parts[0] === "attachments"
        )
          parts.splice(1, 0, node.type + "_" + component(node.id));
        const target = join(newRoot, ...parts);
        await this.verifyFile(
          source,
          String(file.fileHash || "") || undefined,
          entry,
        );
        if (attachments.has(target) && moves.get(source) !== target)
          throw new SnapshotError(
            "Normalized attachment paths collide; migration cancelled",
            entry,
          );
        attachments.set(target, await readFile(await this.safePath(source)));
        moving(source, target);
        file.storedPath = relative(this.directory, target).split(sep).join("/");
      }
      nodes.set(entry, node);
    }
    for (const entry of Object.keys(catalog.entries)) {
      const graph = await this.load(entry);
      entries.set(entry, graph);
      oldFiles.add(this.entryPath(entry));
      if (graph.only) {
        const oldRoot = this.path(catalog.posts[entry].rootPath),
          scoped = this.onlyIndexPath(entry, oldRoot),
          source = catalog.indexes?.[relative(this.directory, scoped)]
            ? scoped
            : this.onlyIndexPath(entry),
          target = this.onlyIndexPath(
            entry,
            this.locations(nodes.get(entry)!)[1],
          );
        await this.verifyFile(
          source,
          catalog.indexes?.[relative(this.directory, source)],
          entry,
        );
        moving(source, target);
      }
    }
    const changed = [...moves].filter(([source, target]) => source !== target);
    if (!changed.length && !replacements.size)
      return { changed: false, posts: nodes.size, moved: 0 };
    for (const entry of nodes.keys()) oldFiles.add(this.nodePath(entry));
    oldFiles.add(join(this.internal, "catalog.json"));
    catalog.indexes = {};
    const writes = this.renderWrites(catalog, nodes, entries);
    for (const [path, data] of attachments) writes.set(path, data);
    for (const path of writes.keys()) {
      await this.safePath(path);
      if (oldFiles.has(path)) continue;
      try {
        await lstat(path);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      throw new SnapshotError(
        "Migration target already exists; migration cancelled",
      );
    }
    const removals = changed
      .map(([source]) => source)
      .filter((path) => !writes.has(path));
    await this.transaction(writes, removals);
    const directories = new Set<string>();
    for (const path of removals) {
      let cursor = dirname(path);
      while (cursor !== this.directory) {
        directories.add(cursor);
        cursor = dirname(cursor);
      }
    }
    for (const path of [...directories].sort((a, b) => b.length - a.length)) {
      try {
        await rmdir(path);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
        ))
          throw error;
      }
    }
    return { changed: true, posts: nodes.size, moved: changed.length };
  }
  async commit(graph: Graph, downloader?: Downloader) {
    validate(graph);
    let catalog = await this.catalog();
    if (
      Object.values(catalog.posts).some((post) =>
        /\s/.test(post.path + post.rootPath),
      )
    ) {
      await this.migratePaths();
      catalog = await this.catalog();
    }
    const all = new Map<string, PostNode>(),
      entries = new Map<string, Graph>();
    const previousCatalog = structuredClone(catalog);
    for (const k of Object.keys(catalog.posts))
      all.set(
        k,
        JSON.parse(
          await readFile(await this.safePath(this.nodePath(k)), "utf8"),
        ),
      );
    const previousEdges = new Map(
      [...all].map(([entry, node]) => [
        entry,
        node.metadata.workspaceEdges || [],
      ]),
    );
    const next = structuredClone(graph),
      refreshed = new Set(next.nodes.map((n) => n.key));
    for (const node of next.nodes) {
      const previous = all.get(node.key)?.metadata,
        knownJob = previous?.job;
      if (previous?.manualTestAccounts)
        node.metadata.manualTestAccounts = structuredClone(
          previous.manualTestAccounts,
        );
      // An intentionally skipped ownership widget gives no new evidence to
      // move a previously grouped post out of its known job folder.
      if (
        next.only &&
        node.metadata.jobWidgetStatus === "skipped" &&
        !node.metadata.job?.number &&
        knownJob?.number
      )
        node.metadata.job = structuredClone(knownJob);
      all.set(node.key, node);
    }
    for (const k of Object.keys(catalog.entries))
      entries.set(
        k,
        JSON.parse(
          await readFile(await this.safePath(this.entryPath(k)), "utf8"),
        ),
      );
    entries.set(next.entryKey, next);
    const roots = new Map<string, string>();
    for (const [k, n] of all) {
      const [, root] = this.locations(n);
      roots.set(k, root);
    }
    const writes = new Map<string, Buffer>();
    await this.safePath(this.internal);
    await mkdir(this.internal, { recursive: true });
    const temporary = await mkdtemp(join(this.internal, "download-"));
    try {
      for (const node of next.nodes) {
        const root = roots.get(node.key)!,
          own =
            node.type !== "job" &&
            basename(root) === node.type + "_" + component(node.id),
          base = own
            ? join(root, "attachments")
            : join(root, "attachments", node.type + "_" + component(node.id));
        for (const [i, f] of (node.metadata.files || []).entries()) {
          delete f.storedPath;
          delete f.fileHash;
          const id = isECDriveAttachment(f)
              ? "ecdrive_" + digest(attachmentIdentity(f)!).slice(0, 24)
              : f.id ||
                digest(
                  serialize({ name: f.name, owner: f.owner, index: i }),
                ).slice(0, 16),
            target = join(base, component(id), component(f.name || "첨부파일")),
            staging = join(
              temporary,
              i + "-" + component(node.key) + "-" + component(f.name || "file"),
            );
          try {
            if (!downloader) f.downloadStatus = "not_downloaded";
            else {
              await abortable(downloader(f, staging, this.signal), this.signal);
              this.signal?.throwIfAborted();
              const bytes = await readFile(staging);
              if (
                f.size != null &&
                /^\d+$/.test(String(f.size)) &&
                bytes.length !== Number(f.size)
              )
                throw new Error(
                  "Downloaded file size differs from attachment metadata",
                );
              writes.set(target, bytes);
              f.storedPath = relative(this.directory, target)
                .split(sep)
                .join("/");
              f.fileHash = digest(bytes);
              f.downloadStatus = "downloaded";
            }
          } catch (e) {
            this.signal?.throwIfAborted();
            f.downloadStatus = "download_failed";
          }
          if (f.url) f.url = cleanURL(f.url, node.metadata.sourceUrl || "");
        }
      }
      for (const k of refreshed) {
        const node = all.get(k)!,
          owner = node.metadata.job?.number
            ? key({ type: "job", id: node.metadata.job.number })
            : null,
          currentEdges = next.edges.filter((edge) => edge.from === k),
          retained = (previousEdges.get(k) || []).filter(
            (edge) =>
              edge.relation !== "belongs_to" || !owner || edge.to === owner,
          );
        all.get(k)!.metadata.workspaceEdges = next.only
          ? [
              ...new Map(
                [...retained, ...currentEdges].map((edge) => [
                  JSON.stringify([edge.from, edge.relation, edge.to]),
                  edge,
                ]),
              ).values(),
            ]
          : currentEdges;
      }
      for (const [path, data] of this.renderWrites(catalog, all, entries))
        writes.set(path, data);
      const removals = new Set<string>(),
        liveRoots = new Set(
          Object.values(catalog.posts).map((post) => post.rootPath),
        );
      for (const [entry, old] of Object.entries(previousCatalog.posts)) {
        if (old.path !== catalog.posts[entry].path) {
          const source = this.path(old.path);
          await this.verifyFile(source, old.hash, entry);
          removals.add(source);
        }
        if (!liveRoots.has(old.rootPath)) {
          const source = join(this.path(old.rootPath), "index.md"),
            indexKey = relative(this.directory, source);
          await this.verifyFile(
            source,
            previousCatalog.indexes?.[indexKey],
            entry,
          );
          removals.add(source);
          delete catalog.indexes?.[indexKey];
        }
      }
      for (const [entry, previous] of Object.entries(previousCatalog.entries)) {
        if (!previous.only) continue;
        const oldRoot = this.path(previousCatalog.posts[entry].rootPath),
          nested = this.onlyIndexPath(entry, oldRoot),
          source = previousCatalog.indexes?.[relative(this.directory, nested)]
            ? nested
            : this.onlyIndexPath(entry);
        if (writes.has(source)) continue;
        const indexKey = relative(this.directory, source);
        await this.verifyFile(
          source,
          previousCatalog.indexes?.[indexKey],
          entry,
        );
        removals.add(source);
        delete catalog.indexes?.[indexKey];
      }
      writes.set(join(this.internal, "catalog.json"), serialize(catalog));
      await this.transaction(
        writes,
        [...removals].filter((path) => !writes.has(path)),
      );
      await this.removeEmptyDirectories([...removals]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return this.describe(graph.entryKey);
  }
  private async removeEmptyDirectories(files: string[]) {
    const directories = new Set<string>();
    for (const file of files) {
      let cursor = dirname(this.path(file));
      while (cursor !== this.directory) {
        directories.add(cursor);
        cursor = dirname(cursor);
      }
    }
    for (const directory of [...directories].sort(
      (a, b) => b.length - a.length,
    )) {
      try {
        await rmdir(directory);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
        ))
          throw error;
      }
    }
  }
  async load(entry: string): Promise<Graph> {
    entry = key(entry);
    const c = await this.catalog();
    if (!c.entries[entry])
      throw new SnapshotError("Entry is not collected; reload required", entry);
    let graph: Graph;
    try {
      graph = validate(
        JSON.parse(
          await readFile(await this.safePath(this.entryPath(entry)), "utf8"),
        ),
      );
      for (let i = 0; i < graph.nodes.length; i++)
        graph.nodes[i] = JSON.parse(
          await readFile(
            await this.safePath(this.nodePath(graph.nodes[i].key)),
            "utf8",
          ),
        );
    } catch {
      throw new SnapshotError(
        "Entry graph or post metadata is invalid; reload required",
        entry,
      );
    }
    if (!graph.only)
      graph.edges = graph.nodes.flatMap((n) => n.metadata.workspaceEdges || []);
    return validate(scopeGraph(graph));
  }
  private async storedNode(entry: string, catalog: Catalog): Promise<PostNode> {
    try {
      const item = catalog.posts[entry];
      if (!item) throw new Error();
      const node: PostNode = JSON.parse(
        await readFile(await this.safePath(this.nodePath(entry)), "utf8"),
      );
      validate({ entryKey: entry, nodes: [node], edges: [] });
      if (
        item.type !== node.type ||
        item.number !== node.id ||
        item.title !== (node.metadata.title ?? entry) ||
        typeof item.title !== "string" ||
        (node.metadata.workspaceEdges !== undefined &&
          !Array.isArray(node.metadata.workspaceEdges)) ||
        (node.metadata.workspaceEdges || []).some(
          (edge) => !edge || edge.from !== entry,
        ) ||
        (node.metadata.job &&
          [
            node.metadata.job.number,
            node.metadata.job.title,
            node.metadata.job.projectCode,
          ].some((value) => value !== null && typeof value !== "string"))
      )
        throw new Error();
      return node;
    } catch {
      throw new SnapshotError(
        "Stored post metadata is invalid; reload required",
        entry,
      );
    }
  }
  private async verifyFile(
    path: string,
    hash: string | undefined,
    entry: string,
  ) {
    try {
      const data = await readFile(await this.safePath(path));
      if (hash && digest(data) !== hash) throw new Error();
    } catch {
      throw new SnapshotError(
        "Stored file is missing or changed; reload required",
        entry,
      );
    }
  }
  private async summary(
    node: PostNode,
    catalog: Catalog,
    nodes = new Map<string, PostNode>(),
    only = false,
  ): Promise<ContextSummary> {
    if (only)
      return {
        key: node.key,
        type: node.type,
        number: node.id,
        title: node.metadata.title ?? node.key,
        jobKey:
          node.type === "job"
            ? node.key
            : node.metadata.job?.number
              ? key({ type: "job", id: node.metadata.job.number })
              : null,
        projectCode: node.metadata.job?.projectCode || null,
        projectTitle:
          (node.type === "job"
            ? node.metadata.title
            : node.metadata.job?.title) || null,
      };
    const parent = (node.metadata.workspaceEdges || []).find(
        (edge) => edge.from === node.key && edge.relation === "belongs_to",
      )?.to,
      jobKey =
        node.type === "job"
          ? node.key
          : parent ||
            (node.metadata.job?.number
              ? key({ type: "job", id: node.metadata.job.number })
              : undefined),
      job =
        jobKey && catalog.posts[jobKey]
          ? nodes.get(jobKey) || (await this.storedNode(jobKey, catalog))
          : undefined;
    return {
      key: node.key,
      type: node.type,
      number: node.id,
      title: node.metadata.title ?? node.key,
      jobKey: jobKey || null,
      projectCode:
        job?.metadata.job?.projectCode ||
        node.metadata.job?.projectCode ||
        null,
      projectTitle: job?.metadata.title || node.metadata.job?.title || null,
    };
  }
  async listContexts(): Promise<ContextSummary[]> {
    const catalog = await this.catalog(),
      nodes = new Map<string, PostNode>();
    for (const entry of Object.keys(catalog.posts).sort()) {
      this.signal?.throwIfAborted();
      const node = await this.storedNode(entry, catalog),
        item = catalog.posts[entry];
      await this.verifyFile(this.path(item.path), item.hash, entry);
      nodes.set(entry, node);
    }
    if (nodes.size)
      validate({
        entryKey: nodes.keys().next().value!,
        nodes: [...nodes.values()],
        edges: [...nodes.values()].flatMap(
          (node) => node.metadata.workspaceEdges || [],
        ),
      });
    return Promise.all(
      [...nodes.values()].map((node) =>
        this.summary(node, catalog, nodes, !!catalog.entries[node.key]?.only),
      ),
    );
  }
  async apply(entry: string) {
    entry = key(entry);
    const catalog = await this.catalog(),
      nodes = new Map<string, PostNode>(),
      pending = [entry];
    if (catalog.entries[entry]) {
      const saved = await this.load(entry);
      if (saved.only) {
        const description = await this.describeGraph(entry, catalog, saved);
        catalog.entries[entry] = {
          nodes: saved.nodes.map((node) => node.key),
          only: true,
        };
        await this.transaction(
          new Map([
            [this.entryPath(entry), serialize(saved)],
            [join(this.internal, "catalog.json"), serialize(catalog)],
          ]),
        );
        return description;
      }
      pending.push(
        ...saved.nodes.map((node) => node.key).filter((key) => key !== entry),
      );
    }
    let jobKey: string | null | undefined;
    while (pending.length) {
      this.signal?.throwIfAborted();
      const next = pending.shift()!;
      if (nodes.has(next)) continue;
      if (jobKey !== undefined && ref(next).type === "job" && next !== jobKey)
        continue;
      const node = await this.storedNode(next, catalog);
      const owner = nodeJobKey(node);
      if (jobKey === undefined) jobKey = owner;
      else if (
        (owner && owner !== jobKey) ||
        (!owner && node.metadata.jobWidgetStatus === "failed")
      )
        continue;
      nodes.set(next, node);
      for (const edge of node.metadata.workspaceEdges || []) {
        if (edge.from !== next)
          throw new SnapshotError("Invalid stored outgoing relation", next);
        pending.push(key(edge.to));
      }
    }
    const graph = validate(
        scopeGraph(
          {
            entryKey: entry,
            nodes: [...nodes.values()],
            edges: [...nodes.values()].flatMap(
              (node) => node.metadata.workspaceEdges || [],
            ),
          },
          jobKey,
        ),
      ),
      description = await this.describeGraph(entry, catalog, graph);
    catalog.entries[entry] = { nodes: graph.nodes.map((node) => node.key) };
    await this.transaction(
      new Map([
        [this.entryPath(entry), serialize(graph)],
        [join(this.internal, "catalog.json"), serialize(catalog)],
      ]),
    );
    return description;
  }
  async describe(entry: string) {
    entry = key(entry);
    const c = await this.catalog(),
      graph = await this.load(entry);
    return this.describeGraph(entry, c, graph);
  }
  private async describeGraph(entry: string, c: Catalog, graph: Graph) {
    const summary = await this.summary(
        graph.nodes.find((node) => node.key === entry)!,
        c,
        new Map(graph.nodes.map((node) => [node.key, node])),
        !!graph.only,
      ),
      item = c.posts[entry],
      scopedIndex = this.onlyIndexPath(entry, this.path(item.rootPath)),
      root = graph.only
        ? dirname(
            c.indexes?.[relative(this.directory, scopedIndex)]
              ? scopedIndex
              : this.onlyIndexPath(entry),
          )
        : this.path(item.rootPath),
      files: Array<{ key: string; path: string }> = [],
      scoped = graph.nodes.filter(
        (node) => graph.only || c.posts[node.key]?.rootPath === item.rootPath,
      );
    const verify = async (path: string, hash?: string) => {
      await this.verifyFile(path, hash, entry);
    };
    await verify(
      join(root, "index.md"),
      c.indexes?.[relative(this.directory, join(root, "index.md"))],
    );
    for (const n of scoped) {
      const p = c.posts[n.key],
        path = this.path(p.path);
      await verify(path, p.hash);
      files.push({ key: n.key, path });
      for (const f of n.metadata.files || [])
        if (f.storedPath)
          await verify(
            this.path(String(f.storedPath)),
            String(f.fileHash || "") || undefined,
          );
    }
    const folderDescriptions: Record<string, string> = {
        기획: "plan_<번호>.md: 기획 게시글",
        개발_스프린트: "dev_<번호>.md: 개발 게시글",
        회의록: "meeting_<번호>.md: 회의록",
        방향결정: "decision_<번호>.md: 방향결정 게시글",
        오류_수정:
          "tp_<번호>.md: 테스트 오류 수정, dp_<번호>.md: 테스트/배포 게시글",
        개발본부_Hub: "hub_<번호>.md: 개발본부 Hub 게시글",
        attachments:
          "게시글별로 다운로드한 첨부 원본 파일 (문서, 이미지, ZIP 등)",
      },
      folders = (
        graph.only
          ? []
          : await readdir(await this.safePath(root), { withFileTypes: true })
      )
        .filter((item) => item.isDirectory() && !item.name.startsWith("."))
        .map((item) => ({
          name: item.name,
          description:
            folderDescriptions[item.name.replace(/\s+/g, "_")] || "맥락 자료",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      children = [
        ...new Set([
          "index.md",
          ...files
            .filter((file) => graph.only || dirname(file.path) === root)
            .map((file) =>
              graph.only
                ? file.key +
                  " → " +
                  relative(this.directory, file.path).split(sep).join("/")
                : basename(file.path),
            ),
        ]),
        ...folders.map((folder) => folder.name + "/"),
      ].sort(),
      lines: string[] = [];
    let prefix = "";
    for (const part of relative(this.directory, root).split(sep)) {
      lines.push(prefix + "└── " + part + "/");
      prefix += "    ";
    }
    children.forEach((name, index) =>
      lines.push(
        prefix + (index === children.length - 1 ? "└── " : "├── ") + name,
      ),
    );
    const statuses = scoped.flatMap((n) =>
        (n.metadata.files || []).map(
          (f) => f.downloadStatus || "not_downloaded",
        ),
      ),
      failedWidgets = graph.nodes.flatMap((node) =>
        (node.metadata.failedWidgets || []).map((widget) => ({
          post: node.key,
          ...widget,
        })),
      ),
      failedAttachments = graph.nodes.flatMap((node) =>
        (node.metadata.failedAttachments || []).map((attachment) => ({
          post: node.key,
          ...attachment,
        })),
      );
    return {
      entryKey: entry,
      ...(graph.only ? { only: true as const } : {}),
      type: item.type,
      number: item.number,
      title: item.title,
      jobKey: summary.jobKey,
      projectCode: summary.projectCode,
      projectTitle: summary.projectTitle,
      entryPath: this.path(item.path),
      rootPath: this.directory,
      groupPath: root,
      indexPath: join(root, "index.md"),
      context: join(root, "index.md"),
      path: root,
      files,
      folders,
      tree: lines.join("\n"),
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      attachments: {
        downloaded: statuses.filter((s) => s === "downloaded").length,
        failed: statuses.filter((s) => s === "download_failed").length,
        notDownloaded: statuses.filter((s) => s === "not_downloaded").length,
      },
      ...(failedWidgets.length ? { failedWidgets } : {}),
      ...(failedAttachments.length ? { failedAttachments } : {}),
    };
  }
  async testAccounts(entry: string) {
    const d = await this.describe(entry),
      markdown = await readFile(await this.safePath(d.entryPath), "utf8"),
      revision = digest(markdown),
      catalog = await this.catalog();
    if (catalog.posts[d.entryKey].hash !== revision)
      throw new SnapshotError(
        "Test account document changed; retry required",
        entry,
      );
    return {
      entryKey: d.entryKey,
      revision,
      candidates: parseAccounts(markdown).map(targetAccount),
    };
  }
  async saveTestAccount(entry: string, update: TestAccountUpdate) {
    const d = await this.describe(entry),
      path = await this.safePath(d.entryPath),
      markdown = await readFile(path, "utf8"),
      catalog = await this.catalog();
    if (
      digest(markdown) !== update.revision ||
      catalog.posts[d.entryKey].hash !== update.revision
    )
      throw new SnapshotError(
        "Test account document changed; retry required",
        entry,
      );
    const accounts = parseAccounts(markdown),
      target = storedAccount(update.target),
      index = update.candidateIndex;
    if (Object.values(target).some((v) => !v || !v.trim()))
      throw new ContextError("테스트 계정의 필수 값이 비어 있습니다.");
    testURL(target.server!);
    if (
      index !== undefined &&
      (!Number.isInteger(index) || index < 0 || index >= accounts.length)
    )
      throw new ContextError(
        "테스트 계정 선택이 변경되었습니다. 다시 실행하세요.",
      );
    const node = await this.storedNode(d.entryKey, catalog),
      manual = (node.metadata.manualTestAccounts ||= []),
      original = index === undefined ? undefined : accounts[index],
      previous =
        original && manual.find((m) => sameAccount(m.account, original));
    if (previous) previous.account = target;
    else
      manual.push({
        account: target,
        ...(original ? { replaces: original } : {}),
      });
    if (index === undefined) accounts.push(target);
    else accounts[index] = target;
    const updated = Buffer.from(replaceAccounts(markdown, accounts));
    catalog.posts[d.entryKey].hash = digest(updated);
    const writes = new Map([
      [path, updated],
      [this.nodePath(d.entryKey), serialize(node)],
      [join(this.internal, "catalog.json"), serialize(catalog)],
    ]);
    for (const [key, saved] of Object.entries(catalog.entries)) {
      if (!saved.nodes.includes(d.entryKey)) continue;
      const graph = validate(
        JSON.parse(
          await readFile(await this.safePath(this.entryPath(key)), "utf8"),
        ),
      );
      graph.nodes = graph.nodes.map((n) => (n.key === d.entryKey ? node : n));
      writes.set(this.entryPath(key), serialize(graph));
    }
    await this.transaction(writes);
    return { entryKey: d.entryKey, saved: true };
  }
}
export class WorkspaceSession {
  store: WorkspaceStore;
  service: GraphService;
  downloader?: Downloader;
  constructor(
    store: WorkspaceStore,
    service: GraphService,
    downloader?: Downloader,
  ) {
    this.store = store;
    this.service = service;
    this.downloader = downloader;
  }
  collect(entry: string, options: CollectionOptions = {}) {
    return this.store.locked(async () => ({
      ...(await this.store.commit(
        await this.service.collect(entry, undefined, options),
        this.downloader,
      )),
      changed: true,
    }));
  }
  update(entry: string, post?: string, add = false) {
    return this.store.locked(async () => {
      let graph = await this.store.load(entry);
      const jobKey = graphJobKey(graph);
      if (post) {
        if (!add && !graph.nodes.some((n) => n.key === key(post)))
          throw new ContextError("Node does not exist", key(post));
        const added = await this.service.collect(
            post,
            graph.only ? undefined : jobKey,
            { only: !!graph.only },
          ),
          merged = new Map(
            [...graph.nodes, ...added.nodes].map((n) => [n.key, n]),
          );
        if (merged.size > this.service.maxNodes)
          throw new ContextError(
            "Traversal node limit exceeded; no partial graph saved",
          );
        const changed = new Set(added.nodes.map((n) => n.key));
        graph = scopeGraph(
          {
            entryKey: graph.entryKey,
            ...(graph.only ? { only: true as const } : {}),
            nodes: [...merged.values()],
            edges: [
              ...graph.edges.filter((e) => !changed.has(e.from)),
              ...added.edges,
            ],
          },
          jobKey,
        );
      } else
        graph = await this.service.collect(entry, undefined, {
          only: !!graph.only,
        });
      return {
        ...(await this.store.commit(graph, this.downloader)),
        changed: true,
      };
    });
  }
}
