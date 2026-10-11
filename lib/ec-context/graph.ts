import { createHash } from "node:crypto";
import type { Attachment, TestAccount } from "./types.ts";
import { htmlToMarkdown, cleanURL } from "./html.ts";
export const postTypes = [
  "job",
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
  if (
    !graph ||
    Object.keys(graph).sort().join() !== "edges,entryKey,nodes" ||
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
  ] as const) {
    if (name in post)
      Object.assign(metadata, { [name]: structuredClone(post[name]) });
  }
  return {
    ...r,
    key: k,
    metadata,
    data:
      md +
      "\n\n## 게시글 관계\n\n상위 작업: " +
      (parent ? key(parent) : "없음") +
      "\n\n첨부 게시글:\n" +
      (attached.length
        ? attached.map((x) => "- " + key(x)).join("\n")
        : "- 없음") +
      "\n",
  };
}
export class GraphService {
  reader: PostReader;
  maxNodes: number;
  signal?: AbortSignal;
  constructor(reader: PostReader, maxNodes = 100, signal?: AbortSignal) {
    this.reader = reader;
    this.maxNodes = maxNodes;
    this.signal = signal;
  }
  async collect(entry: string | PostRef): Promise<Graph> {
    const raw = new Map<string, RawPost>(),
      nodes = new Map<string, PostNode>(),
      visited = new Set<string>();
    const read = async (r: PostRef) => {
      this.signal?.throwIfAborted();
      const k = key(r);
      if (raw.has(k)) return raw.get(k)!;
      if (raw.size >= this.maxNodes)
        throw new ContextError(
          "Traversal node limit exceeded; no partial graph saved",
          k,
        );
      const p = await this.reader.readById(r.type, r.id);
      this.signal?.throwIfAborted();
      if (key(p.ref) !== k)
        throw new ParseError("Reader returned a different post", k);
      raw.set(k, p);
      nodes.set(k, parsePost(p));
      return p;
    };
    await read(ref(entry));
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
          ...(rel.parentJob ? [rel.parentJob] : []),
        ]);
        for (const target of targets) await read(target);
      }
    }
    const edges: Edge[] = [];
    for (const [k, p] of raw) {
      if (p.relations.parentJob)
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
          edges.push({ from: k, to: key(r), relation });
      }
    }
    return validate(
      canonical({ entryKey: key(entry), nodes: [...nodes.values()], edges }),
    );
  }
}
