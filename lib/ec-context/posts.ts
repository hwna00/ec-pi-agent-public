import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ContextError,
  ParseError,
  ref,
  key,
  refs,
  type PostRef,
  type PostType,
  type RawPost,
  type JobInfo,
  type PostReader,
} from "./graph.ts";
import {
  tree,
  walk,
  textContent,
  isElement,
  escapeHTML,
  cleanURL,
} from "./html.ts";
import {
  SiteClient,
  siteTypes,
  jobPrefix,
  pick,
  readPost,
  dump,
  type Row,
  type ReaderBrowser,
} from "./site-api.ts";
import type {
  Attachment,
  TestAccount,
  FailedAttachment,
  PostReadOptions,
} from "./types.ts";
import {
  attachmentIdentity,
  isECDriveAttachment,
  ecDriveOID,
} from "./download.ts";
const referenceTypes = new Map<string, PostType>(
  Object.entries(siteTypes).map(([t, c]) => [c.bizz, t as PostType]),
);
const nullable = (value: unknown): string | null => {
  if (value == null) return null;
  if (!["string", "number"].includes(typeof value))
    throw new ParseError("Job information must contain scalar values");
  return String(value).trim() || null;
};
export function jobInformation(
  post: Row,
  type: PostType,
): { job: JobInfo | null; status: string } {
  if (type === "job")
    return {
      job: {
        number: String(post.number),
        title: nullable(post.title),
        projectCode: nullable(pick(post.metadata, "pjt_cd")),
      },
      status: "self",
    };
  const widget = post.job_widget,
    row = widget?.fields || post.metadata,
    status =
      widget?.status || (jobPrefix + "data_no" in row ? "present" : "absent");
  if (["absent", "failed", "skipped"].includes(status))
    return { job: null, status };
  const job = {
    number: nullable(row[jobPrefix + "data_no"]),
    title: nullable(row[jobPrefix + "title_ctt"]),
    projectCode: nullable(row["pjt$pjt$pjt_cd"] ?? row[jobPrefix + "pjt_cd"]),
  };
  if (job.number && !/^\d+$/.test(job.number))
    throw new ParseError("Connected job number must be numeric");
  return Object.values(job).some(Boolean)
    ? { job, status: "present" }
    : { job: null, status: "empty" };
}
export function popupInformation(source: string, type: PostType): Row {
  const forms = new Map<string, Row>(),
    headings: Array<[string, string]> = [];
  const value = (n: any): string => {
    if (!isElement(n))
      return n.type === "text"
        ? n.data
        : "children" in n
          ? n.children.map(value).join("")
          : "";
    if (
      n.name === "span" &&
      (n.attribs.class || "").split(/\s+/).includes("text-bold") &&
      /^\[\d+\]$/.test(textContent(n).trim())
    )
      return "";
    return n.children.map(value).join("");
  };
  walk(tree(source), (n) => {
    const item = n.attribs["data-item-key"] || "";
    if (item.startsWith("widget_title_")) {
      const m = textContent(n).match(/^\s*(\d+)\s*\|\s*(.*?)\s*\|/);
      if (m) headings.push([m[1], m[2].trim()]);
    }
    const match = item.match(/^(.+)_boardX(.+)_field_form$/);
    if (match) {
      if (!forms.has(match[2])) forms.set(match[2], {});
      forms.get(match[2])![match[1]] = value(n).trim();
    }
  });
  const own = [...forms.values()].find((x) => "board_s$data_no" in x) || {},
    number = own["board_s$data_no"] || headings[0]?.[0],
    title = own["board_s$title_ctt"] || headings[0]?.[1];
  if (!number) throw new ParseError("Popup current post number missing");
  const connected = [...forms.values()].filter(
    (x) => jobPrefix + "data_no" in x,
  );
  if (connected.length > 1)
    throw new ParseError("Multiple connected job forms in popup");
  const info = jobInformation(
    {
      number,
      title,
      metadata: own,
      job_widget: {
        status: connected.length ? "present" : "absent",
        fields: connected[0] || {},
      },
    },
    type,
  );
  return { number, title, job: info.job, jobWidgetStatus: info.status };
}
export function attachmentItems(value: any): Row[] {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new ParseError("Invalid inline attachment JSON");
    }
  }
  if (value && !Array.isArray(value) && typeof value === "object") {
    if ("attached_list" in value) value = value.attached_list;
    else if ("data" in value) value = value.data;
  }
  if (
    !Array.isArray(value) ||
    value.some((x) => !x || typeof x !== "object" || Array.isArray(x))
  )
    throw new ParseError("Unrecognized inline attachment structure");
  return value;
}
export function attachmentRef(item: Row): PostRef | null {
  if (isECDriveAttachment(item)) return null;
  const sid = item.bizz_sid,
    number = item.BOARD_NUM ?? item.data_no;
  if (
    number == null &&
    (Array.isArray(item.file_info_list) ||
      (item.link_type === "01" && (item.file_id ?? item.id) != null))
  )
    return null;
  if (!sid && number == null) return null;
  const type = referenceTypes.get(sid);
  if (!type)
    throw new ContextError(
      "Attached board is not supported: " + sid,
      undefined,
      "unsupported",
    );
  if (number == null)
    throw new ParseError("Attached post has no display number");
  return ref({ type, id: String(number) });
}
function attachmentFiles(item: Row): Row[] {
  const files =
    item.file_info_list ??
    (isECDriveAttachment(item) || (item.file_id ?? item.id) != null
      ? [item]
      : []);
  if (
    !Array.isArray(files) ||
    files.some(
      (file) => !file || typeof file !== "object" || Array.isArray(file),
    )
  )
    throw new ParseError("Invalid file attachment metadata");
  if (files.some((file) => attachmentIdentity(file) === undefined))
    throw new ParseError("File attachment ID missing");
  return files;
}
export function mergeAttachmentItems(
  existing: Row[],
  additional: Row[],
): Row[] {
  const merged = new Map<string, Row>();
  for (const item of [...existing, ...additional]) {
    const post = attachmentRef(item);
    if (post) {
      const identity = JSON.stringify(["post", key(post)]);
      merged.set(identity, { ...merged.get(identity), ...item });
      continue;
    }
    for (const file of attachmentFiles(item)) {
      const identity = JSON.stringify(["file", attachmentIdentity(file)]),
        previous = merged.get(identity);
      merged.set(identity, {
        ...previous,
        ...item,
        file_info_list: [{ ...previous?.file_info_list[0], ...file }],
      });
    }
  }
  return [...merged.values()];
}
export function attachmentCount(items: Row[]): number {
  return mergeAttachmentItems([], items).length;
}
function htmlPostRefs(source: string): PostRef[] {
  const found: PostRef[] = [];
  walk(tree(source), (n) => {
    const a = n.attribs;
    if (a["data-context-type"] && a["data-post-id"])
      found.push(ref(a["data-context-type"] + ":" + a["data-post-id"]));
    if (n.name === "a" && a.href) {
      let url: URL;
      try {
        url = new URL(a.href, "https://reference.local");
      } catch {
        return;
      }
      const params = new URLSearchParams(url.search);
      for (const [k, v] of new URLSearchParams(url.hash.slice(1)))
        params.set(k, v);
      if (params.has("context_type") && params.has("data_no"))
        found.push(
          ref(params.get("context_type") + ":" + params.get("data_no")),
        );
      else if (params.has("bizz_sid") && params.has("data_no")) {
        const r = attachmentRef({
          bizz_sid: params.get("bizz_sid"),
          BOARD_NUM: params.get("data_no"),
        });
        if (r) found.push(r);
      }
    }
  });
  return refs(found);
}
const serverPattern =
  /(?<![\w.-])((?:test|zeus|stage)[a-z0-9-]*)(?:\.ecount\.com)?(?![\w.-])/i;
const serverLabel = /서버\s*\/?\s*계정|테스트\s*서버|서버정보|test\s*server/i;
export function parseTarget(value: string, source: string): TestAccount[] {
  const text = rowsText(value),
    match = text.match(serverPattern);
  if (!match) return [];
  const parts = text
      .slice(match.index! + match[0].length)
      .replace(/^[ /:]+/, "")
      .split("/")
      .map((x) => x.trim()),
    target: TestAccount = { server: match[1].toLowerCase(), source };
  if (parts.length >= 3 && /^\d{3,12}$/.test(parts[0]))
    Object.assign(target, {
      company: parts[0],
      user: parts[1],
      password: parts
        .slice(2)
        .join("/")
        .split(/\s*\[?내선|\s*\[?Ext\./i)[0]
        .trim(),
    });
  for (const [field, pattern] of Object.entries({
    company: /(?:회사코드|company)\s*[:=]\s*(\d+)/i,
    user: /(?:아이디|사용자\s*ID|user(?:name)?|\bID)\s*[:=]\s*([^\s/]+)/i,
    password: /(?:비밀번호|password|\bPW)\s*[:=]\s*([^\s/]+)/i,
  })) {
    const m = text.match(pattern);
    if (m) target[field] = m[1];
  }
  return [target];
}
function rowsText(value: string) {
  return textContent(tree(value));
}
export function extractTestServers(post: Row, setup: Row = {}): TestAccount[] {
  const props = new Set<string>(
    post.board === siteTypes.tp.name ? ["board_s$txt_003"] : [],
  );
  const scan = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (v.prop_id && serverLabel.test(String(v.prop_name || "")))
      props.add(v.prop_id);
    for (const x of Object.values(v)) scan(x);
  };
  scan(setup);
  const targets: TestAccount[] = [];
  for (const prop of [...props].sort())
    if (typeof post.metadata[prop] === "string")
      targets.push(...parseTarget(post.metadata[prop], "metadata:" + prop));
  for (const item of post.body) {
    const visit = (n: any) => {
      if (!isElement(n)) {
        if ("children" in n) n.children.forEach(visit);
        return;
      }
      const text = textContent(n);
      if (
        ["li", "tr", "p"].includes(n.name) &&
        text.length < 2000 &&
        serverLabel.test(text)
      ) {
        targets.push(...parseTarget(text, "html:" + item.field));
        return;
      }
      n.children.forEach(visit);
    };
    visit(tree(item.content.raw_html));
    for (const link of item.content.links || [])
      if (
        /^https?:\/\/(?:test|zeus|stage)[a-z0-9-]*\.ecount\.com(?:[/:?]|$)/i.test(
          link.href || "",
        )
      )
        targets.push(...parseTarget(link.href, "link:" + item.field));
  }
  return [
    ...new Map(
      targets.map((t) => [
        JSON.stringify([t.server, t.company, t.user, t.password]),
        t,
      ]),
    ).values(),
  ];
}
export function capturedToRaw(
  post: Row,
  attachments: Record<string, Row[]> = {},
  origin = "https://logine.ecount.com",
): RawPost {
  const type = Object.entries(siteTypes).find(
    ([, c]) => c.name === post.board,
  )?.[0] as PostType;
  if (!type)
    throw new ContextError("Unsupported board", undefined, "unsupported");
  const info = jobInformation(post, type),
    sections = post.body
      .toSorted((a, b) =>
        (a.field + "\0" + (a.widget || "")).localeCompare(
          b.field + "\0" + (b.widget || ""),
        ),
      )
      .map((x) => ({
        field: x.field,
        label:
          x.label ||
          (/ctt_(\d+)$/.test(x.field)
            ? "내용 " + Number(x.field.match(/ctt_(\d+)$/)[1])
            : "본문"),
        html: x.content.raw_html,
      }));
  const records = new Map<string, Row>(
      post.reply_records.map((x) => [pick(x, "record_sid"), x]),
    ),
    groups = new Map<string, Row[]>();
  for (const item of post.replies.toSorted(
    (a, b) =>
      Number(pick(records.get(a.record_sid) || {}, "record_seq_no", 0)) -
        Number(pick(records.get(b.record_sid) || {}, "record_seq_no", 0)) ||
      (String(a.record_sid) + a.field).localeCompare(
        String(b.record_sid) + b.field,
      ),
  )) {
    if (!groups.has(item.record_sid)) groups.set(item.record_sid, []);
    groups.get(item.record_sid)!.push(item);
  }
  const replyNumbers = new Map([...groups.keys()].map((k, i) => [k, i + 1])),
    replies = [...groups].map(([rid, items]) => ({
      number: replyNumbers.get(rid)!,
      parentNumber:
        replyNumbers.get(pick(records.get(rid) || {}, "parent_record_sid")) ??
        null,
      writer: String(
        pick(records.get(rid) || {}, "writer_nm", items[0].writer || ""),
      ),
      html: items.map((x) => x.content.raw_html).join("\n"),
    }));
  const attached = sections
      .flatMap((s) => htmlPostRefs(s.html))
      .concat(replies.flatMap((s) => htmlPostRefs(s.html))),
    files: Attachment[] = [],
    url = origin + "/ec56/view/erp";
  for (const [owner, items] of Object.entries(attachments).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    for (const item of items) {
      const ar = attachmentRef(item);
      if (ar) {
        attached.push(ar);
        continue;
      }
      const values = attachmentFiles(item);
      for (const file of values) {
        const ecdrive = isECDriveAttachment(file),
          id = ecdrive ? ecDriveOID(file) : (file.file_id ?? file.id);
        if (id == null) throw new ParseError("File attachment ID missing");
        const row = owner === "본문" ? post.metadata : records.get(owner) || {},
          metadata: Attachment = Object.fromEntries(
            [
              "file_id",
              "account",
              "owner_key",
              "provider_seq",
              "edit_dt",
              "isExists",
              "link_type",
            ]
              .filter((k) => k in file)
              .map((k) => [k, file[k]]),
          );
        if (ecdrive)
          Object.assign(metadata, {
            storage: "ecdrive",
            oid: String(id),
            owner_key: String(id),
            sourceBizzSid: siteTypes[type].bizz,
            sourceMenuSid: siteTypes[type].view,
            ...Object.fromEntries(
              [
                "attach_id",
                "conn_sid",
                "bizz_sid",
                "to_bizz_sid",
                "isexists",
                "status",
              ]
                .filter((name) => name in file)
                .map((name) => [name, file[name]]),
            ),
            ecdriveHid: file.hid ?? file.HID,
            ...(file.version !== undefined || file.VERSION !== undefined
              ? { version: String(file.version ?? file.VERSION) }
              : {}),
          });
        Object.assign(metadata, {
          id: String(id),
          name: String(
            file.name || file.attach_name || file.file_name || "첨부파일",
          ),
          size: file.size,
          owner,
          postKey: type + ":" + post.number,
          type,
          number: String(post.number),
          recordSid: pick(row, "record_sid"),
          hid: pick(row, "hid"),
          dataSid: pick(row, "data_sid"),
          sourceUrl: url,
        });
        const source = file.download_url || file.downloadUrl || file.url;
        if (source) metadata.url = cleanURL(String(source), url);
        files.push(metadata);
      }
    }
  const related: PostRef[] = [];
  for (const batch of post.related_records || []) {
    const target = referenceTypes.get(batch.bizz_sid);
    if (!target || target === "job") continue;
    for (const row of batch.rows) {
      if (Number(pick(row, "record_depth_no", 0))) continue;
      const id = pick(row, "data_no");
      if (id == null) throw new ParseError("Related post number missing");
      related.push({ type: target, id: String(id) });
    }
  }
  const blocks = [
    "<h1>" +
      escapeHTML(
        post.title ||
          (post.failed_widgets?.length ? type + ":" + post.number : ""),
      ) +
      "</h1>",
    ...sections.map((s) => "<h2>" + escapeHTML(s.label) + "</h2>" + s.html),
    ...replies.map(
      (s) =>
        "<h2>답글 " +
        s.number +
        " · " +
        escapeHTML(s.writer) +
        "</h2>" +
        s.html,
    ),
  ];
  return {
    ref: { type, id: String(post.number) },
    title: post.title || "",
    job: info.job,
    jobWidgetStatus: info.status,
    sourceUrl: url,
    sections,
    replies,
    files,
    ...(post.failed_widgets?.length
      ? { failedWidgets: post.failed_widgets }
      : {}),
    content: blocks.join("\n"),
    relations: {
      attachedPosts: refs(attached),
      relatedPosts: refs(related),
      ...(type !== "job" && info.job?.number
        ? { parentJob: { type: "job", id: info.job.number } }
        : {}),
    },
  };
}
export class LivePostReader implements PostReader {
  browser: ReaderBrowser;
  artifacts: string;
  signal?: AbortSignal;
  options: PostReadOptions;
  related = new Map<string, PostRef[]>();
  constructor(
    browser: ReaderBrowser,
    artifacts: string,
    signal?: AbortSignal,
    options: PostReadOptions = {},
  ) {
    this.browser = browser;
    this.artifacts = artifacts;
    this.signal = signal;
    this.options = options;
  }
  async readById(type: PostType, id: string): Promise<RawPost> {
    const r = ref({ type, id }),
      k = key(r);
    if (!/^\d+$/.test(id))
      throw new ParseError("ECOUNT post number must be numeric", k);
    const client = new SiteClient(
      this.browser,
      join(this.artifacts, type + "-" + id + "-" + randomUUID()),
      this.signal,
    );
    try {
      const post = await readPost(client, type, Number(id), this.options),
        attachments: Record<string, Row[]> = {},
        failedAttachments: FailedAttachment[] = [];
      for (const [label, row] of [
        ["본문", post.metadata],
        ...post.reply_records.map((x) => [String(pick(x, "record_sid")), x]),
      ] as Array<[string, Row]>) {
        const count = Number(pick(row, "slip_link_cnt", 0) || 0);
        let items: Row[] = [],
          code: string | undefined;
        try {
          items = mergeAttachmentItems(
            [],
            attachmentItems(pick(row, "slip_link")),
          );
          if (attachmentCount(items) < count) {
            const hid = pick(row, "hid");
            if (!hid)
              throw new ParseError(
                "Attachment count present but hid missing",
                k,
              );
            const config = siteTypes[type],
              data = await client.post(
                "attachments",
                {
                  prg_id: config.bizz.split("_").at(-1)!.replace(/^0+/, ""),
                  form_type: "",
                  attach_types: ["01", "05", "98"],
                  attach_exception_group: "",
                  hid,
                  seq_no: 0,
                  bizz_sid: config.bizz,
                  data_sid: pick(row, "data_sid", post.identifiers.data_sid),
                  record_sid: pick(row, "record_sid"),
                },
                label,
              );
            items = mergeAttachmentItems(items, attachmentItems(data));
            if (attachmentCount(items) < count) code = "attachment_incomplete";
          }
        } catch (error) {
          this.signal?.throwIfAborted();
          if (error instanceof Error && error.name === "AbortError")
            throw error;
          code =
            error instanceof ContextError
              ? error.code
              : "attachment_read_failed";
        }
        if (items.length) attachments[label] = items;
        if (code)
          failedAttachments.push({
            owner: label,
            expected: count,
            collected: attachmentCount(items),
            code,
          });
      }
      const raw = capturedToRaw(post, attachments, client.origin),
        setupMetric = client.metrics.find((x) => x.api === "setup");
      const setup = normalizeCapture(
        await readFile(join(client.out, setupMetric!.artifact), "utf8"),
      );
      raw.testServers = extractTestServers(post, setup);
      if (failedAttachments.length) raw.failedAttachments = failedAttachments;
      raw.ref = r;
      if (type === "job") raw.job!.number = id;
      for (const file of raw.files || [])
        Object.assign(file, { postKey: k, number: id });
      if (type === "job")
        this.related.set(id, raw.relations.relatedPosts || []);
      await dump(join(client.out, "raw-post.json"), raw);
      return raw;
    } catch (e) {
      if (e instanceof ContextError) e.key ??= k;
      throw e;
    }
  }
  async listRelatedPosts(id: string) {
    if (!this.related.has(id)) await this.readById("job", id);
    return this.related.get(id) || [];
  }
}
import { normalize } from "./site-api.ts";
function normalizeCapture(source: string) {
  return normalize(JSON.parse(source));
}
export class FixtureReader implements PostReader {
  directory: string;
  calls: string[] = [];
  constructor(directory: string) {
    this.directory = directory;
  }
  async readById(type: PostType, id: string): Promise<RawPost> {
    const k = key({ type, id });
    this.calls.push(k);
    return JSON.parse(
      await readFile(join(this.directory, type + "-" + id + ".json"), "utf8"),
    );
  }
  async listRelatedPosts() {
    return [];
  }
}
