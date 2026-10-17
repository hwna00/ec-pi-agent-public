import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { SnapshotError, validate, type PostNode } from "../collect/graph.ts";
import { jobInformation } from "../collect/posts.ts";
import { siteTypes, type Row } from "../collect/site-api.ts";
import type { WorkspaceStore } from "./workspace.ts";

const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

function number(value: unknown): string | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  )
    return null;
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

/** Recover grouping metadata only; the caller validates and persists changes. */
export async function recoverJobGrouping(
  store: WorkspaceStore,
): Promise<Map<string, PostNode>> {
  const catalog = await store.catalog(),
    nodes = new Map<string, PostNode>();
  for (const [key, item] of Object.entries(catalog.posts)) {
    store.signal?.throwIfAborted();
    let node: PostNode;
    try {
      node = JSON.parse(
        await readFile(await store.safePath(store.nodePath(key)), "utf8"),
      );
      validate({ entryKey: key, nodes: [node], edges: [] });
      if (
        node.key !== key ||
        node.type !== item.type ||
        node.id !== item.number ||
        (node.metadata.title ?? key) !== item.title
      )
        throw new Error();
    } catch {
      throw new SnapshotError(
        "Stored post metadata is invalid; reload required",
        key,
      );
    }
    nodes.set(key, node);
  }
  const candidates = new Map(
      [...nodes].filter(
        ([, node]) =>
          node.type !== "job" &&
          !node.metadata.job?.number &&
          ["absent", "skipped"].includes(node.metadata.jobWidgetStatus || ""),
      ),
    ),
    recovered = new Map<string, PostNode>();
  if (!candidates.size) return recovered;

  const captures = await store.safePath(join(store.internal, "captures"));
  let directories: Dirent[];
  try {
    directories = await readdir(captures, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return recovered;
    throw error;
  }
  const latest = new Map<string, { modified: number; posts: Row[] }>();
  for (const directory of directories) {
    store.signal?.throwIfAborted();
    if (!directory.isDirectory()) continue;
    const path = await store.safePath(
      join(captures, directory.name, "post.json"),
    );
    let post: Row, modified: number;
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      post = JSON.parse(await readFile(path, "utf8"));
      modified = info.mtimeMs;
    } catch (error) {
      if (missing(error)) continue;
      throw new SnapshotError("Saved post capture is invalid; reload required");
    }
    if (!post || typeof post !== "object" || Array.isArray(post)) continue;
    const id = number(post.number);
    if (id === null) continue;
    const node = [...candidates.values()].find(
      (candidate) =>
        candidate.id === id && post.board === siteTypes[candidate.type].name,
    );
    if (!node) continue;
    const previous = latest.get(node.key);
    if (!previous || modified > previous.modified)
      latest.set(node.key, { modified, posts: [post] });
    else if (modified === previous.modified) previous.posts.push(post);
  }

  for (const [key, capture] of latest) {
    store.signal?.throwIfAborted();
    const node = candidates.get(key)!,
      information = capture.posts.map((post) =>
        jobInformation(post, node.type),
      ),
      info = information[0];
    if (
      information.some(
        (value) => JSON.stringify(value) !== JSON.stringify(info),
      )
    )
      throw new SnapshotError(
        "Saved post captures disagree on parent job",
        key,
      );
    if (!info.job?.number) continue;
    const parent = nodes.get("job:" + info.job.number),
      known =
        parent?.type === "job" &&
        parent.id === info.job.number &&
        parent.metadata.job?.number === info.job.number
          ? parent.metadata.job
          : null;
    recovered.set(key, {
      ...node,
      metadata: {
        ...node.metadata,
        job: {
          ...info.job,
          title: info.job.title ?? known?.title ?? null,
          projectCode: info.job.projectCode ?? known?.projectCode ?? null,
        },
        jobWidgetStatus: info.status,
      },
    });
  }
  return recovered;
}
