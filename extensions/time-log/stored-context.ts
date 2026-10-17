import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// Persisted ContextGraph board identifiers; no graph collection or rendering API.
export const siteTypes = {
  job: { name: "작업", bizz: "B_000000E074008" },
  plan: { name: "기획", bizz: "B_000000E074006" },
  dev: { name: "개발", bizz: "B_000000E074010" },
  tp: { name: "테스트오류수정", bizz: "B_000000E074013" },
  hub: { name: "개발본부 Hub", bizz: "B_000000E074000" },
  dp: { name: "테스트/배포", bizz: "B_000000E074020" },
  meeting: { name: "회의", bizz: "B_000000E074015" },
  decision: { name: "방향결정", bizz: "B_000000E074014" },
} as const;
export type PostType = keyof typeof siteTypes;
type Edge = { from: string; to: string; relation: string };
export interface PostNode {
  key: string;
  type: PostType;
  id: string;
  data: string;
  metadata: {
    title?: string;
    job?: {
      number: string | null;
      title: string | null;
      projectCode: string | null;
    } | null;
    workspaceEdges?: Edge[];
    jobWidgetStatus?: string;
    files?: { storedPath?: string; fileHash?: string }[];
  };
}
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
export function parseReference(value: string): string {
  const match =
    typeof value === "string" &&
    value.match(/^(job|plan|dev|tp|hub|dp|meeting|decision):(\d+)$/);
  if (!match || Number(match[2]) < 1)
    throw new Error("저장된 게시글 식별자가 올바르지 않습니다.");
  return value;
}
export function contextSessionEntry(manager: any) {
  const entries = manager.getBranch?.() || manager.getEntries?.() || [];
  for (let i = entries.length - 1; i >= 0; i--)
    if (
      entries[i].type === "custom" &&
      entries[i].customType === "ec-context-session"
    )
      return entries[i];
}
export function owner(node: PostNode): string | null {
  const owners = new Set(
    (node.metadata.workspaceEdges || [])
      .filter(
        (edge) => edge.from === node.key && edge.relation === "belongs_to",
      )
      .map((edge) => parseReference(edge.to)),
  );
  if (node.type === "job") owners.add(node.key);
  if (node.metadata.job?.number)
    owners.add(parseReference(`job:${node.metadata.job.number}`));
  if (owners.size > 1 || [...owners].some((key) => !key.startsWith("job:")))
    throw new Error(`${node.key}: 저장된 연결 작업이 서로 다릅니다.`);
  return [...owners][0] || null;
}
function validateNode(node: any): asserts node is PostNode {
  if (
    !node ||
    typeof node.id !== "string" ||
    parseReference(node.key) !== `${node.type}:${node.id}` ||
    typeof node.data !== "string" ||
    !record(node.metadata) ||
    (node.metadata.workspaceEdges !== undefined &&
      !Array.isArray(node.metadata.workspaceEdges))
  )
    throw new Error("Stored post metadata is invalid; reload required");
}
function validateGraph(graph: any) {
  const fields = graph && Object.keys(graph).sort().join();
  if (
    !graph ||
    !(
      fields === "edges,entryKey,nodes" ||
      (fields === "edges,entryKey,nodes,only" && graph.only === true)
    ) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  )
    throw new Error("Entry graph is invalid; reload required");
  const nodes = new Map<string, PostNode>();
  for (const node of graph.nodes) {
    validateNode(node);
    if (nodes.has(node.key)) throw new Error("Duplicate stored post");
    nodes.set(node.key, node);
  }
  if (!nodes.has(graph.entryKey)) throw new Error("Missing entry node");
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const signature = JSON.stringify([edge?.from, edge?.relation, edge?.to]);
    if (
      !record(edge) ||
      Object.keys(edge).sort().join() !== "from,relation,to" ||
      !nodes.has(edge.from) ||
      !nodes.has(edge.to) ||
      !["belongs_to", "attach_to", "related_to"].includes(edge.relation) ||
      seen.has(signature) ||
      (edge.relation === "belongs_to" &&
        (nodes.get(edge.from)!.type === "job" ||
          nodes.get(edge.to)!.type !== "job"))
    )
      throw new Error("Invalid stored relation");
    seen.add(signature);
  }
}

/** Read the saved JSON and verify its referenced files, without graph writes. */
export async function readStoredContext(directory: string, entryKey: string) {
  directory = resolve(directory);
  const internal = join(directory, ".context");
  const safePath = async (value: string) => {
    const target = resolve(directory, value),
      local = relative(directory, target);
    if (local === ".." || local.startsWith(".." + sep) || isAbsolute(local))
      throw new Error("Path escapes workspace");
    let cursor = directory;
    for (const part of ["", ...local.split(sep).filter(Boolean)]) {
      cursor = join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new Error("Workspace path contains a symbolic link");
      } catch (error) {
        if (missing(error)) break;
        throw error;
      }
    }
    return target;
  };
  const json = async (path: string) =>
    JSON.parse(await readFile(await safePath(path), "utf8"));
  const postPath = (key: string) =>
    join(internal, "posts", parseReference(key).replace(":", "-") + ".json");
  const catalog = await json(join(internal, "catalog.json"));
  if (
    catalog?.version !== 1 ||
    !record(catalog.posts) ||
    !record(catalog.entries)
  )
    throw new Error("Workspace catalog is invalid; reload required");
  if (!catalog.entries[entryKey])
    throw new Error("Entry is not collected; reload required");
  const verifyFile = async (path: string, hash?: string) => {
    try {
      const data = await readFile(await safePath(path));
      if (hash && digest(data) !== hash) throw new Error();
    } catch {
      throw new Error("Stored file is missing or changed; reload required");
    }
  };
  const readPost = async (key: string) => {
    const node = await json(postPath(key));
    validateNode(node);
    if (node.key !== key) throw new Error("Stored post identity is invalid");
    return node;
  };
  const graph = await json(
    join(
      internal,
      "entries",
      parseReference(entryKey).replace(":", "-") + ".json",
    ),
  );
  validateGraph(graph);
  if (graph.entryKey !== entryKey)
    throw new Error("Stored entry identity is invalid");
  let nodes: PostNode[] = await Promise.all(
    graph.nodes.map((node: PostNode) => readPost(node.key)),
  );
  const entry = nodes.find((node) => node.key === entryKey)!;
  const jobKey = owner(entry);
  let edges: Edge[] = graph.only
    ? graph.edges
    : nodes.flatMap((node) => node.metadata.workspaceEdges || []);
  // Keep the saved --only boundary, or the selected job's reachable context.
  const eligible = new Set(
    nodes
      .filter(
        (node) =>
          graph.only ||
          ((!owner(node) || owner(node) === jobKey) &&
            (node.key === entryKey ||
              owner(node) ||
              node.metadata.jobWidgetStatus !== "failed")),
      )
      .map((node) => node.key),
  );
  edges = edges.filter(
    (edge) =>
      eligible.has(edge.from) &&
      eligible.has(edge.to) &&
      (!graph.only || edge.relation !== "belongs_to"),
  );
  const reachable = new Set<string>(),
    pending = [
      entryKey,
      ...nodes
        .filter(
          (node) =>
            !graph.only &&
            eligible.has(node.key) &&
            jobKey !== null &&
            owner(node) === jobKey,
        )
        .map((node) => node.key),
    ];
  while (pending.length) {
    const key = pending.pop()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    pending.push(
      ...edges.filter((edge) => edge.from === key).map((edge) => edge.to),
    );
  }
  nodes = nodes
    .filter((node) => reachable.has(node.key))
    .map((node) => ({
      ...node,
      metadata: {
        ...node.metadata,
        workspaceEdges: edges.filter(
          (edge) => edge.from === node.key && reachable.has(edge.to),
        ),
      },
    }));
  validateGraph({
    entryKey,
    nodes,
    edges: edges.filter(
      (edge) => reachable.has(edge.from) && reachable.has(edge.to),
    ),
  });
  const item = catalog.posts[entryKey];
  if (!item) throw new Error("Stored entry catalog is missing");
  const onlyIndex = (root: string) =>
    join(root, ".context", "only", entryKey.replace(":", "-"), "index.md");
  const scopedIndex = onlyIndex(resolve(directory, item.rootPath));
  const index = graph.only
    ? catalog.indexes?.[relative(directory, scopedIndex)]
      ? scopedIndex
      : onlyIndex(directory)
    : join(directory, item.rootPath, "index.md");
  await verifyFile(index, catalog.indexes?.[relative(directory, index)]);
  for (const node of nodes.filter(
    (node) => graph.only || catalog.posts[node.key]?.rootPath === item.rootPath,
  )) {
    const post = catalog.posts[node.key];
    if (!post) throw new Error("Stored post catalog is missing");
    await verifyFile(post.path, post.hash);
    for (const file of node.metadata.files || [])
      if (file.storedPath) await verifyFile(file.storedPath, file.fileHash);
  }
  const selected = nodes.find((node) => node.key === entryKey)!;
  const selectedOwner = owner(selected);
  let job: PostNode | undefined;
  if (!graph.only && selectedOwner && catalog.posts[selectedOwner]) {
    job = nodes.find((node) => node.key === selectedOwner);
    if (!job) {
      job = await readPost(selectedOwner);
      const item = catalog.posts[selectedOwner];
      if (
        item.type !== job.type ||
        item.number !== job.id ||
        item.title !== (job.metadata.title ?? selectedOwner) ||
        typeof item.title !== "string" ||
        (job.metadata.workspaceEdges || []).some(
          (edge) => !edge || edge.from !== selectedOwner,
        ) ||
        (job.metadata.job &&
          [
            job.metadata.job.number,
            job.metadata.job.title,
            job.metadata.job.projectCode,
          ].some((value) => value !== null && typeof value !== "string"))
      )
        throw new Error("Stored post metadata is invalid; reload required");
    }
  }
  return {
    internal,
    safePath,
    catalog,
    nodes,
    only: graph.only === true,
    readPost,
    verifyFile,
    projectCode:
      job?.metadata.job?.projectCode ||
      selected.metadata.job?.projectCode ||
      null,
    projectTitle:
      job?.metadata.title ||
      (selected.type === "job"
        ? selected.metadata.title
        : selected.metadata.job?.title) ||
      null,
  };
}
export type StoredContext = Awaited<ReturnType<typeof readStoredContext>>;
