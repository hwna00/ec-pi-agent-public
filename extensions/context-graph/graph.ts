import { createHash } from "node:crypto";
import type {
  Attachment,
  TestAccount,
  FailedWidget,
  FailedAttachment,
  ManualTestAccount,
} from "./types.ts";
import { htmlToMarkdown, cleanURL } from "./html.ts";
export const postTypes = [
  "job",
  "plan",
  "dev",
  "hub",
  "tp",
  "dp",
  "decision",
  "meeting",
] as const;
export type PostType = (typeof postTypes)[number];
export interface PostRef {
  type: PostType;
  id: string;
}
export interface JobInfo {
  number: string | null;
  title: string | null;
  projectCode: string | null;
}
export interface Section {
  field?: string;
  label?: string;
  html: string;
}
export interface Reply {
  number: number;
  parentNumber?: number | null;
  writer?: string;
  html: string;
}
export interface Relations {
  parentJob?: PostRef;
  attachedPosts?: PostRef[];
  relatedPosts?: PostRef[];
}
export interface Metadata {
  title?: string;
  job?: JobInfo | null;
  jobWidgetStatus?: string;
  sourceUrl?: string;
  sections?: Section[];
  replies?: Reply[];
  files?: Attachment[];
  testServers?: TestAccount[];
  manualTestAccounts?: ManualTestAccount[];
  failedWidgets?: FailedWidget[];
  failedAttachments?: FailedAttachment[];
  workspaceEdges?: Edge[];
}
export interface RawPost extends Metadata {
  ref: PostRef;
  content: string;
  sourceUrl: string;
  relations: Relations;
}
export interface PostNode extends PostRef {
  key: string;
  data: string;
  metadata: Metadata;
}
export type Relation = "belongs_to" | "attach_to" | "related_to";
export interface Edge {
  from: string;
  to: string;
  relation: Relation;
}
export interface Graph {
  entryKey: string;
  nodes: PostNode[];
  edges: Edge[];
  only?: true;
}
export interface CollectionOptions {
  only?: boolean;
}
export interface PostReader {
  readById(type: PostType, id: string): Promise<RawPost>;
  listRelatedPosts?(id: string): Promise<PostRef[]>;
  listDevelopments?(id: string): Promise<PostRef[]>;
}
export class ContextError extends Error {
  code = "context_error";
  key?: string;
  constructor(message: string, key?: string, code?: string) {
    super(message);
    this.key = key;
    if (code) this.code = code;
  }
}
export class ParseError extends ContextError {
  code = "parse_error";
}
export class SnapshotError extends ContextError {
  code = "snapshot_error";
}
export function ref(value: string | PostRef): PostRef {
  const [type, id] =
    typeof value === "string"
      ? [
          value.slice(0, value.indexOf(":")),
          value.slice(value.indexOf(":") + 1),
        ]
      : [value?.type, value?.id];
  if (
    !postTypes.includes(type as PostType) ||
    typeof id !== "string" ||
    !id ||
    /[\r\n/\\]/.test(id)
  )
    throw new ContextError("Invalid post reference");
  return { type: type as PostType, id };
}
export const key = (value: string | PostRef) => {
  const r = ref(value);
  return r.type + ":" + r.id;
};
export const refs = (values: PostRef[]) =>
  [...new Set(values.map(key))].sort().map(ref);
export function canonical(graph: Graph): Graph {
  return {
    entryKey: graph.entryKey,
    ...(graph.only ? { only: true as const } : {}),
    nodes: [...graph.nodes].sort((a, b) => a.key.localeCompare(b.key)),
    edges: [...graph.edges].sort((a, b) =>
      (a.from + "\0" + a.relation + "\0" + a.to).localeCompare(
        b.from + "\0" + b.relation + "\0" + b.to,
      ),
    ),
  };
}
export function serialize(value: unknown): Buffer {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return Buffer.from(JSON.stringify(sort(value)));
}
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function validate(graph: Graph): Graph {
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
    throw new SnapshotError("Invalid graph fields");
  const nodes = new Map<string, PostNode>();
  for (const n of graph.nodes) {
    if (
      key(n) !== n.key ||
      typeof n.data !== "string" ||
      nodes.has(n.key) ||
      !n.metadata ||
      typeof n.metadata !== "object" ||
      Array.isArray(n.metadata)
    )
      throw new SnapshotError("Invalid node");
    nodes.set(n.key, n);
  }
  if (!nodes.has(graph.entryKey)) throw new SnapshotError("Missing entry node");
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const signature = JSON.stringify([e.from, e.relation, e.to]);
    if (
      Object.keys(e).sort().join() !== "from,relation,to" ||
      !nodes.has(e.from) ||
      !nodes.has(e.to) ||
      !["belongs_to", "attach_to", "related_to"].includes(e.relation) ||
      seen.has(signature)
    )
      throw new SnapshotError("Invalid edge");
    if (
      e.relation === "belongs_to" &&
      (nodes.get(e.from)!.type === "job" || nodes.get(e.to)!.type !== "job")
    )
      throw new SnapshotError("Invalid parent edge");
    seen.add(signature);
  }
  return graph;
}
export function parsePost(post: RawPost): PostNode {
  const r = ref(post.ref),
    k = key(r),
    md = htmlToMarkdown(post.content, post.sourceUrl),
    parent = post.relations.parentJob;
  if (!md) throw new ParseError("Empty parsed post", k);
  if (parent && (r.type === "job" || ref(parent).type !== "job"))
    throw new ParseError("Invalid parent relation", k);
  const attached = refs(post.relations.attachedPosts || []),
    metadata: Metadata = {
      sourceUrl: cleanURL(post.sourceUrl, post.sourceUrl),
    };
  for (const name of [
    "title",
    "job",
    "jobWidgetStatus",
    "sections",
    "replies",
    "files",
    "testServers",
    "failedWidgets",
    "failedAttachments",
  ] as const) {
    if (name in post)
      Object.assign(metadata, { [name]: structuredClone(post[name]) });
  }
  return {
    ...r,
    key: k,
    metadata,
    data: md + relationMarkdown(parent, attached),
  };
}
function relationMarkdown(parent: PostRef | undefined, attached: PostRef[]) {
  return (
    "\n\n## 게시글 관계\n\n상위 작업: " +
    (parent ? key(parent) : "없음") +
    "\n\n첨부 게시글:\n" +
    (attached.length
      ? attached.map((post) => "- " + key(post)).join("\n")
      : "- 없음") +
    "\n"
  );
}
export function postJobKey(
  post: Pick<RawPost, "ref" | "job" | "relations">,
): string | null {
  const current = ref(post.ref);
  if (current.type === "job") return key(current);
  const parent = post.relations.parentJob;
  if (parent && ref(parent).type !== "job")
    throw new ParseError("Invalid parent relation", key(current));
  const parentKey = parent ? key(parent) : null,
    metadataKey = post.job?.number
      ? key({ type: "job", id: post.job.number })
      : null;
  if (parentKey && metadataKey && parentKey !== metadataKey)
    throw new ParseError("Conflicting job ownership", key(current));
  return parentKey || metadataKey;
}
export function nodeJobKey(
  node: PostNode,
  edges = node.metadata.workspaceEdges || [],
): string | null {
  const parents = [
    ...new Set(
      edges
        .filter(
          (edge) => edge.from === node.key && edge.relation === "belongs_to",
        )
        .map((edge) => edge.to),
    ),
  ];
  if (parents.length > 1)
    throw new SnapshotError("Conflicting parent jobs", node.key);
  return postJobKey({
    ref: node,
    job: node.metadata.job,
    relations: { parentJob: parents[0] ? ref(parents[0]) : undefined },
  });
}
export function graphJobKey(graph: Graph): string | null {
  const entry = graph.nodes.find((node) => node.key === graph.entryKey);
  if (!entry) throw new SnapshotError("Missing entry node");
  return nodeJobKey(entry, graph.edges);
}
export function scopeGraph(graph: Graph, jobKey = graphJobKey(graph)): Graph {
  const eligible = new Set(
    graph.nodes
      .filter((node) => {
        if (graph.only) return true;
        const owner = nodeJobKey(node, graph.edges);
        return (
          (!owner || owner === jobKey) &&
          (node.key === graph.entryKey ||
            owner ||
            node.metadata.jobWidgetStatus !== "failed")
        );
      })
      .map((node) => node.key),
  );
  if (!eligible.has(graph.entryKey))
    throw new ContextError(
      "Post belongs to another job",
      graph.entryKey,
      "job_scope_mismatch",
    );
  const edges = graph.edges.filter(
      (edge) =>
        eligible.has(edge.from) &&
        eligible.has(edge.to) &&
        (!graph.only || edge.relation !== "belongs_to"),
    ),
    reachable = new Set<string>(),
    pending = [
      graph.entryKey,
      ...graph.nodes
        .filter(
          (node) =>
            !graph.only &&
            eligible.has(node.key) &&
            jobKey !== null &&
            nodeJobKey(node, graph.edges) === jobKey,
        )
        .map((node) => node.key),
    ];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    pending.push(
      ...edges.filter((edge) => edge.from === current).map((edge) => edge.to),
    );
  }
  const retainedEdges = edges.filter(
    (edge) => reachable.has(edge.from) && reachable.has(edge.to),
  );
  return canonical({
    entryKey: graph.entryKey,
    ...(graph.only ? { only: true as const } : {}),
    nodes: graph.nodes
      .filter((node) => reachable.has(node.key))
      .map((node) => {
        const owned = retainedEdges.filter((edge) => edge.from === node.key),
          parent = owned.find((edge) => edge.relation === "belongs_to"),
          attached = owned
            .filter((edge) => edge.relation === "attach_to")
            .map((edge) => ref(edge.to)),
          relationStart = node.data.lastIndexOf("\n\n## 게시글 관계\n\n");
        return {
          ...node,
          metadata: { ...node.metadata, workspaceEdges: owned },
          data:
            relationStart >= 0
              ? node.data.slice(0, relationStart) +
                relationMarkdown(parent ? ref(parent.to) : undefined, attached)
              : node.data,
        };
      }),
    edges: retainedEdges,
  });
}
export class GraphService {
  reader: PostReader;
  maxNodes: number;
  signal?: AbortSignal;
  constructor(reader: PostReader, maxNodes = Infinity, signal?: AbortSignal) {
    this.reader = reader;
    this.maxNodes = maxNodes;
    this.signal = signal;
  }
  async collect(
    entry: string | PostRef,
    expectedJob?: string | null,
    options: CollectionOptions = {},
  ): Promise<Graph> {
    const entryRef = ref(entry),
      entryKey = key(entryRef);
    if (
      expectedJob !== undefined &&
      !options.only &&
      entryRef.type === "job" &&
      entryKey !== expectedJob
    )
      throw new ContextError(
        "Post belongs to another job",
        entryKey,
        "job_scope_mismatch",
      );
    this.signal?.throwIfAborted();
    const first = await this.reader.readById(entryRef.type, entryRef.id);
    this.signal?.throwIfAborted();
    if (key(first.ref) !== entryKey)
      throw new ParseError("Reader returned a different post", entryKey);
    const firstJob = postJobKey(first),
      jobKey = expectedJob === undefined ? firstJob : expectedJob;
    if (!options.only && firstJob && firstJob !== jobKey)
      throw new ContextError(
        "Post belongs to another job",
        entryKey,
        "job_scope_mismatch",
      );
    const raw = new Map<string, RawPost>(),
      visited = new Set<string>(),
      excluded = new Set<string>();
    raw.set(entryKey, first);
    const read = async (r: PostRef) => {
      this.signal?.throwIfAborted();
      const k = key(r);
      if (raw.has(k)) return raw.get(k)!;
      if (excluded.has(k)) return;
      if (!options.only && r.type === "job" && k !== jobKey) {
        excluded.add(k);
        return;
      }
      const p = await this.reader.readById(r.type, r.id);
      this.signal?.throwIfAborted();
      if (key(p.ref) !== k)
        throw new ParseError("Reader returned a different post", k);
      const owner = postJobKey(p);
      if (
        !options.only &&
        ((owner && owner !== jobKey) ||
          (!owner && p.jobWidgetStatus === "failed"))
      ) {
        excluded.add(k);
        if (!owner && p.jobWidgetStatus === "failed") {
          (first.failedWidgets ||= []).push({
            section: k,
            type: "relation",
            label: `소속 작업 확인 (${k})`,
            code: "job_scope_unavailable",
          });
        }
        return;
      }
      if (raw.size >= this.maxNodes)
        throw new ContextError(
          "Traversal node limit exceeded; no partial graph saved",
          k,
        );
      raw.set(k, p);
      return p;
    };
    while ([...raw.keys()].some((k) => !visited.has(k))) {
      for (const k of [...raw.keys()].filter((k) => !visited.has(k)).sort()) {
        visited.add(k);
        const p = raw.get(k)!,
          r = ref(k),
          rel = p.relations;
        if (r.type === "job") {
          const listing =
            this.reader.listRelatedPosts || this.reader.listDevelopments;
          if (listing)
            rel.relatedPosts = refs([
              ...(rel.relatedPosts || []),
              ...(await listing.call(this.reader, r.id)),
            ]);
        }
        const targets = refs([
          ...(rel.attachedPosts || []),
          ...(rel.relatedPosts || []),
          ...(!options.only && rel.parentJob ? [rel.parentJob] : []),
        ]);
        for (const target of targets) await read(target);
      }
    }
    const edges: Edge[] = [];
    for (const [k, p] of raw) {
      if (
        !options.only &&
        p.relations.parentJob &&
        raw.has(key(p.relations.parentJob))
      )
        edges.push({
          from: k,
          to: key(p.relations.parentJob),
          relation: "belongs_to",
        });
      for (const [name, relation] of [
        ["attachedPosts", "attach_to"],
        ["relatedPosts", "related_to"],
      ] as const) {
        for (const r of refs(p.relations[name] || []))
          if (raw.has(key(r))) edges.push({ from: k, to: key(r), relation });
      }
      if (options.only && p.relations.parentJob && !p.job?.number)
        p.job = {
          number: p.relations.parentJob.id,
          title: p.job?.title ?? null,
          projectCode: p.job?.projectCode ?? null,
        };
      p.relations = {
        ...(!options.only &&
        p.relations.parentJob &&
        raw.has(key(p.relations.parentJob))
          ? { parentJob: p.relations.parentJob }
          : {}),
        attachedPosts: refs(p.relations.attachedPosts || []).filter((target) =>
          raw.has(key(target)),
        ),
        relatedPosts: refs(p.relations.relatedPosts || []).filter((target) =>
          raw.has(key(target)),
        ),
      };
    }
    return validate(
      canonical({
        entryKey,
        ...(options.only ? { only: true as const } : {}),
        nodes: [...raw.values()].map(parsePost),
        edges,
      }),
    );
  }
}
