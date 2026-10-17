import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ContextError, ParseError, digest } from "./graph.ts";
import { plainText, tree, walk } from "./html.ts";
import type { FailedWidget, PostReadOptions } from "../types.ts";
// ERP field names and widget schemas are discovered at runtime.
export type Row = Record<string, any>;
export interface ReaderBrowser {
  origin?: string;
  fetch(
    path: string,
    payload: Row,
  ): Promise<{ status?: number; body?: string; error?: string }>;
  download?(
    file: Row,
    path: string,
    options: { signal?: AbortSignal },
  ): Promise<unknown>;
  evaluate?(fn: string): Promise<any>;
}
export const endpoints = {
  boards: "/ec5/api/app.common/action/GetBizzTypeSearchV5Action",
  menus: "/ec5/api/app.setup/action/bizz/menu_setting/SelectSubMenuListAction",
  templates: "/ec5/api/app.common/action/GetTemplateAllowListAction",
  search: "/ec5/api/app.board/action/SelectBoardSearchListAction",
  detail: "/ec5/api/app.board/action/GetBoardDataAction",
  setup: "/ec5/api/app.board/action/GetBoardSetupAction",
  widget: "/ec5/api.bulk/app.crm/action/SelectWidgetSearchAction:board:view",
  attachments: "/ec5/api/app.common/action/SelectV3SlipLinkInfoByHidAction",
} as const;
export const siteTypes = {
  job: { name: "작업", bizz: "B_000000E074008", view: "M_000000E200436" },
  plan: { name: "기획", bizz: "B_000000E074006", view: "M_000000E200432" },
  dev: { name: "개발", bizz: "B_000000E074010", view: "M_000000E200440" },
  tp: {
    name: "테스트오류수정",
    bizz: "B_000000E074013",
    view: "M_000000E200446",
  },
  hub: {
    name: "개발본부 Hub",
    bizz: "B_000000E074000",
    view: "M_000000E200420",
  },
  dp: { name: "테스트/배포", bizz: "B_000000E074020", view: "M_000000E200460" },
  meeting: { name: "회의", bizz: "B_000000E074015", view: "M_000000E200450" },
  decision: {
    name: "방향결정",
    bizz: "B_000000E074014",
    view: "M_000000E200448",
  },
} as const;
export const jobPrefix = "b_000000e074008_001$board_s$";
export const pick = (row: Row, name: string, fallback: any = null) => {
  for (const key of ["board_s$" + name, "board_b$" + name, name])
    if (key in row) return row[key];
  return fallback;
};
export function normalize(value: any): any {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === "__$KeyPack" &&
    value[1] &&
    typeof value[1] === "object"
  ) {
    const names = value[1],
      unpack = (v: any): any =>
        Array.isArray(v)
          ? v.map(unpack)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [names[k] ?? k, unpack(x)]),
              )
            : v;
    return normalize(unpack(value[2]));
  }
  return Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, x]) => [k, normalize(x)]),
        )
      : value;
}
export function rowsOf(data: any): Row[] {
  if (Array.isArray(data))
    return data.flatMap((x) =>
      x && typeof x === "object" && "data" in x
        ? x.data || []
        : x && typeof x === "object"
          ? [x]
          : [],
    );
  return data && Array.isArray(data.data) ? data.data : [];
}
export async function dump(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}
export function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) {
      operation.catch(() => {});
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
export class SiteClient {
  browser: ReaderBrowser;
  out: string;
  origin: string;
  signal?: AbortSignal;
  metrics: Row[] = [];
  constructor(browser: ReaderBrowser, out: string, signal?: AbortSignal) {
    if (!/^https:\/\/[a-z0-9-]+\.ecount\.com$/i.test(browser.origin || ""))
      throw new ContextError("Invalid ERP host", undefined, "auth_expired");
    this.browser = browser;
    this.out = out;
    this.origin = browser.origin!;
    this.signal = signal;
  }
  async post(
    kind: keyof typeof endpoints,
    payload: Row,
    label?: string,
  ): Promise<any> {
    this.signal?.throwIfAborted();
    const start = Date.now(),
      response = await abortable(
        this.browser.fetch(endpoints[kind], payload),
        this.signal,
      );
    this.signal?.throwIfAborted();
    if (response.error)
      throw new ContextError(
        "Browser session unavailable; run /ec-connect",
        undefined,
        "auth_expired",
      );
    const status = response.status ?? 0,
      body = response.body || "";
    if (
      [301, 302, 303, 307, 308, 401, 410].includes(status) ||
      /type="password"/i.test(body)
    )
      throw new ContextError("Login required", undefined, "auth_expired");
    if (status === 403)
      throw new ContextError("Access denied", undefined, "access_denied");
    if (status === 404)
      throw new ContextError("Resource not found", undefined, "not_found");
    let obj: any;
    try {
      obj = JSON.parse(body);
    } catch {
      throw new ParseError(kind + ": non-JSON response");
    }
    const artifact = `raw/${String(this.metrics.length + 1).padStart(2, "0")}-${kind}.json`;
    await dump(join(this.out, artifact), obj);
    this.metrics.push({
      api: kind,
      label,
      status,
      bytes: Buffer.byteLength(body),
      milliseconds: Date.now() - start,
      artifact,
    });
    await dump(join(this.out, "requests.json"), this.metrics);
    const normalized = normalize(obj);
    if (
      !normalized ||
      typeof normalized !== "object" ||
      Array.isArray(normalized)
    )
      throw new ParseError("Invalid API envelope");
    const erpStatus = Number.isInteger(normalized.Status)
        ? normalized.Status
        : "unknown",
      failure = (reason: string) =>
        new ContextError(
          `${kind}${label ? `[${label}]` : ""}: ${reason} ` +
            `(HTTP=${status} ERP=${erpStatus}; artifact=${resolve(this.out, artifact)})`,
          undefined,
          "read_failed",
        );
    if (
      [401, 410].includes(normalized.Status) ||
      body.includes("IInvalidSessionException")
    )
      throw new ContextError(
        "ERP session expired; refresh session and retry",
        undefined,
        "auth_expired",
      );
    if (normalized.Status === 403)
      throw new ContextError("Access denied", undefined, "access_denied");
    if (normalized.Status === 404)
      throw new ContextError("Resource not found", undefined, "not_found");
    if (
      status !== 200 ||
      (normalized.Status ?? 200) !== 200 ||
      normalized.Error
    )
      throw failure("server error");
    const data = normalized.Data ?? normalized;
    if (data?.error || data?.error_info) throw failure("error in Data");
    return data;
  }
}
export interface Widget {
  type: string;
  section: string;
  template_set_sid: string;
  object_id: string;
  info: Row;
  body_props: string[];
  body_labels: Row;
  visible_props: string[];
  job_form: boolean;
}
function displayedProps(model: Row): Row[] {
  const attrs = model.attributes || [],
    ordered = new Set<string>(
      attrs
        .filter((a) => a.attr_id === "display_order" && a.prop_id)
        .map((a) => a.prop_id),
    );
  const hidden = new Set(
    attrs
      .filter((a) => a.attr_id === "display_state" && a.data === false)
      .map((a) => a.prop_id),
  );
  return (model.props || []).filter(
    (p) => (!ordered.size || ordered.has(p.prop_id)) && !hidden.has(p.prop_id),
  );
}
export function widgets(setup: Row): Widget[] {
  const found: Widget[] = [];
  const visit = (v: any) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!v || typeof v !== "object") return;
    const type = (
      {
        EDITOR_VIEW: "editor",
        COMMENT: "comment",
        FORM: "form",
        LIST_GRID: "list",
      } as Row
    )[v.view_type];
    if (type)
      for (const a of v.attributes || []) {
        if (a.attr_id !== "multi_user_action") continue;
        const p = a.data?.load_complete?.payload || {},
          infos = p.data_model_infos || {},
          ids = Object.keys(infos);
        if (!ids.length) continue;
        const info = infos[p.data_model_id] || infos[ids[0]],
          visible = new Set<string>(),
          body: string[] = [],
          labels: Row = {};
        for (const id of ids) {
          const model = setup.data_model_definitions?.[id] || {};
          for (const prop of displayedProps(model)) visible.add(prop.prop_id);
          for (const prop of model.props || [])
            if (/^body_(?:html_)?ctt(?:_\d+)?$/.test(prop.refer_type || "")) {
              body.push(prop.prop_id);
              labels[prop.prop_id] = prop.prop_name;
            }
        }
        found.push({
          type,
          section: v.sect_sid,
          template_set_sid: p.template_set_sid,
          object_id: info.object_id,
          info,
          body_props: [...new Set(body)],
          body_labels: labels,
          visible_props: [...visible],
          job_form:
            type === "form" &&
            visible.has(jobPrefix + "data_no") &&
            !visible.has("board_s$data_no"),
        });
      }
    if (v.sections) visit(v.sections);
  };
  visit(setup.view_container || []);
  return found;
}
export function widgetPayload(
  w: Widget,
  bizz: string,
  menu: string,
  row: Row,
): Row {
  const info = w.info,
    template: Row = {
      // The template belongs to the current view; conn_bizz_info identifies linked boards.
      bizz_sid: bizz,
      menu_sid: menu,
      menu_type: "view",
      template_set_sid: w.template_set_sid,
      data_display_standard: info.data_display_standard,
      object_id: w.object_id,
      template_sub_type: "fixed",
      widget_type: w.type === "list" ? "grid" : w.type,
      is_za_template: false,
    };
  if ("conn_bizz_info" in info) template.conn_bizz_info = info.conn_bizz_info;
  return {
    bizz_sid: info.bizz_sid || bizz,
    menu_sid: menu,
    menu_type: "view",
    object_id: w.object_id,
    template_info: template,
    search_request: {
      target: {},
      condition: { board_s$status_type: { type: "contains", value: "U" } },
      ...(w.type === "list"
        ? { page: { current_index: 1, row_count: 100 } }
        : {}),
    },
    options: {
      self_conditions: [
        {
          board_s$data_sid: {
            type: "contains",
            value: [pick(row, "data_sid")],
          },
        },
      ],
    },
  };
}
export function searchPayload(
  bizz: string,
  menu: string,
  template: string,
  number: number,
): Row {
  return {
    bizz_sid: bizz,
    menu_sid: menu,
    menu_type: "list",
    template_sub_type: "fixed",
    current_template: template,
    is_za_template: false,
    additional: { view_all: true, expand_all: false, notice_count: 0 },
    target: Object.fromEntries(
      [
        "data_no",
        "data_sid",
        "record_sid",
        "title_ctt",
        "reply_cnt",
        "record_depth_no",
        "data_dt",
      ].map((k) => ["board_s$" + k, {}]),
    ),
    condition: { board_s$data_no: { type: "equal", value: number } },
    sort: { board_s$record_seq_no: { sort_type: "asc", priority: 1 } },
    page: { current_index: 1, row_count: 100 },
  };
}
export async function collectPages(
  client: Pick<SiteClient, "post">,
  kind: "search" | "widget",
  payload: Row,
  label: string,
): Promise<Row[]> {
  const result: Row[] = [],
    seen = new Set<string>();
  for (let page = 1; page <= 1000; page++) {
    const data = await client.post(kind, payload, label),
      batches = Array.isArray(data) ? data : [data];
    const counts = batches
      .filter((x) => x && "total_count" in x)
      .map((x) => x.total_count);
    if (counts.some((x) => !Number.isInteger(x) || x < 0))
      throw new ParseError(label + ": invalid total_count");
    const total = counts.length ? counts.reduce((a, b) => a + b, 0) : null,
      rows = rowsOf(data);
    let added = 0;
    for (const row of rows) {
      const id =
        pick(row, "record_sid") || JSON.stringify(row, Object.keys(row).sort());
      if (!seen.has(id)) {
        seen.add(id);
        result.push(row);
        added++;
      }
    }
    if (
      (total !== null && result.length >= total) ||
      (total === null && rows.length < 100)
    )
      return result;
    if (!added)
      throw new ContextError(
        label +
          ": pagination stopped before total_count; refusing incomplete result",
      );
    const target =
      kind === "widget" ? (payload.search_request ??= {}) : payload;
    target.page = { current_index: page + 1, row_count: 100 };
  }
  throw new ContextError(label + ": pagination limit exceeded");
}
export function content(source: string): Row {
  const links: Row[] = [],
    assets: Row[] = [];
  walk(tree(source), (n) => {
    if (n.name === "a")
      links.push({
        href: n.attribs.href,
        attributes: Object.entries(n.attribs),
      });
    if (
      ["img", "video", "audio", "source", "iframe", "object", "embed"].includes(
        n.name,
      )
    )
      assets.push({ tag: n.name, attributes: Object.entries(n.attribs) });
  });
  return {
    raw_html: source,
    sha256: digest(source),
    text: plainText(source),
    links,
    assets,
  };
}
export function extractContents(
  rows: Row[],
  role: string,
  widget?: string,
): Row[] {
  const result: Row[] = [];
  for (const row of rows)
    for (const [field, value] of Object.entries(row)) {
      if (
        typeof value !== "string" ||
        !/\$(?:body_html_ctt|body_ctt|reply_ctt|comment_ctt)(?:_\d+)?$/.test(
          field,
        )
      )
        continue;
      const linked = !/^(board_b|board_s)\$/.test(field),
        prefix = linked ? field.split("$board_")[0] + "$" : "";
      const source = linked
        ? Object.fromEntries(
            Object.entries(row)
              .filter(([k]) => k.startsWith(prefix))
              .map(([k, v]) => [k.slice(prefix.length), v]),
          )
        : row;
      result.push({
        role: linked ? "linked" : role,
        field,
        record_sid: pick(source, "record_sid"),
        data_sid: pick(source, "data_sid"),
        bizz_sid: pick(source, "bizz_sid"),
        parent_record_sid: pick(source, "parent_record_sid"),
        writer: pick(source, "writer_nm"),
        written_at: pick(source, "write_dtm"),
        widget,
        content: content(value),
      });
    }
  return result;
}
export async function readPost(
  client: SiteClient,
  type: keyof typeof siteTypes,
  number: number,
  options: PostReadOptions = {},
): Promise<Row> {
  const config = siteTypes[type],
    boards = rowsOf(
      await client.post("boards", {
        code_type_response: true,
        select_by_bizz_group: {
          target_bizz_group_sids: [
            "BG_00000C000038",
            "BG_00000C000040",
            "BG_00000C000042",
            "BG_00000C000043",
            "BG_00000C000044",
          ],
          search_param: "",
        },
      }),
    );
  const matches = boards.filter(
    (x) => x.name === config.name && String(x.sid || "").startsWith("B_"),
  );
  if (matches.length !== 1)
    throw new ContextError("Board exact match count=" + matches.length);
  const bizz = matches[0].sid,
    menus = rowsOf(await client.post("menus", { bizz_sid: bizz })).sort(
      (a, b) =>
        Number(a.menu_type_name !== "조회") -
        Number(b.menu_type_name !== "조회"),
    );
  let row: Row | undefined,
    listRows: Row[] = [],
    lastError: unknown;
  for (const menu of menus) {
    try {
      const template = await client.post("templates", {
        bizz_sid: bizz,
        menu_sid: menu.menu_sid,
        menu_type: "list",
        template_sub_type: "fixed",
        data_sid: "",
      });
      const found = await collectPages(
        client,
        "search",
        searchPayload(
          bizz,
          menu.menu_sid,
          template.current_template || "",
          number,
        ),
        "locate",
      );
      const parents = found.filter(
        (x) =>
          String(pick(x, "data_no")) === String(number) &&
          !pick(x, "parent_record_sid") &&
          !Number(pick(x, "record_depth_no", 0)),
      );
      if (parents.length > 1)
        throw new ContextError("Multiple parent posts match the number");
      if (parents.length) {
        row = parents[0];
        listRows = found;
        break;
      }
    } catch (e) {
      if (
        client.signal?.aborted ||
        (e instanceof ContextError &&
          ["auth_expired", "access_denied"].includes(e.code))
      )
        throw e;
      lastError = e;
    }
  }
  if (!row)
    throw (
      lastError ||
      new ContextError(
        "Post not found: " + type + ":" + number,
        undefined,
        "not_found",
      )
    );
  const context = {
    bizz_sid: bizz,
    menu_sid: config.view,
    menu_type: "view",
    data_sid: pick(row, "data_sid"),
    record_sid: pick(row, "record_sid"),
  };
  const detail = await client.post("detail", context);
  for (const model of Object.values(detail.data_model || {}))
    if (Array.isArray(model))
      for (const x of model)
        if (pick(x, "record_sid") === context.record_sid) Object.assign(row, x);
  const setup = await client.post("setup", context),
    ws = widgets(setup);
  if (!ws.length) throw new ContextError("No loadable widgets found");
  await dump(join(client.out, "widgets.json"), ws);
  const skipParentJob = type !== "job" && options.includeParentJob === false,
    readParentMetadata =
      skipParentJob && options.includeParentJobMetadata === true;
  let jobWidget: Row = {
    status: skipParentJob && !readParentMetadata ? "skipped" : "absent",
    fields: {},
  };
  const all: Row[] = [],
    replyRows = new Map<string, Row>(),
    related: Row[] = [],
    failedWidgets: FailedWidget[] = [];
  for (const w of ws) {
    if (
      skipParentJob &&
      (w.job_form || w.info.bizz_sid === siteTypes.job.bizz) &&
      !(readParentMetadata && w.job_form)
    )
      continue;
    if (
      !w.body_props.length &&
      !["comment", "form"].includes(w.type) &&
      !(type === "job" && w.type === "list")
    )
      continue;
    if (
      w.type === "list" &&
      !Object.values(siteTypes).some((c) => c.bizz === w.info.bizz_sid)
    )
      continue;
    const payload = widgetPayload(w, bizz, config.view, row),
      date = pick(row, "data_dt");
    if (date && w.type === "comment")
      payload.search_request.condition["board_s$data_dt"] = {
        type: "range",
        value: { from: date, to: date },
      };
    let records: Row[];
    try {
      records =
        w.type === "form"
          ? rowsOf(await client.post("widget", payload, w.section))
          : await collectPages(client, "widget", payload, w.section);
    } catch (error) {
      client.signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      const board = Object.values(siteTypes).find(
        (board) => board.bizz === w.info.bizz_sid,
      )?.name;
      failedWidgets.push({
        section: w.section,
        type: w.type,
        label:
          w.type === "list"
            ? `${board || "관련 게시글"} 목록`
            : w.type === "comment"
              ? "답글"
              : w.type === "form"
                ? w.job_form
                  ? "연결 작업"
                  : "기본 정보"
                : "본문",
        code: error instanceof ContextError ? error.code : "request_failed",
      });
      if (w.job_form && jobWidget.status === "absent")
        jobWidget = { status: "failed", fields: {} };
      continue;
    }
    const rows =
      w.type === "comment"
        ? records.filter((x) => pick(x, "status_type") !== "D")
        : records;
    if (w.job_form) {
      if (rows.length > 1)
        throw new ParseError("Connected job widget returned multiple records");
      const fields = Object.fromEntries(
        rows.flatMap((x) =>
          Object.entries(x).filter(([k]) => w.visible_props.includes(k)),
        ),
      );
      if (rows.length && !(jobPrefix + "data_no" in fields))
        throw new ParseError(
          "Connected job widget response is missing its number field",
        );
      if (
        !["absent", "failed"].includes(jobWidget.status) &&
        JSON.stringify(jobWidget.fields) !== JSON.stringify(fields)
      )
        throw new ParseError("Conflicting connected job widgets");
      jobWidget = {
        status: [
          jobPrefix + "data_no",
          jobPrefix + "title_ctt",
          jobPrefix + "pjt_cd",
          "pjt$pjt$pjt_cd",
        ].some(
          (k) =>
            fields[k] != null &&
            fields[k] !== "" &&
            !(Array.isArray(fields[k]) && !fields[k].length),
        )
          ? "present"
          : "empty",
        fields,
      };
    } else if (w.type === "form")
      for (const x of rows)
        if (
          pick(x, "record_sid") === context.record_sid ||
          pick(x, "data_sid") === context.data_sid ||
          String(pick(x, "data_no")) === String(number)
        )
          Object.assign(row, x);
    if (w.type === "list") {
      related.push({ bizz_sid: w.info.bizz_sid, rows });
      continue;
    }
    if (w.type === "comment")
      for (const x of rows) {
        const id = pick(x, "record_sid");
        if (id && id !== context.record_sid) replyRows.set(id, x);
      }
    if (w.type === "form") continue;
    for (const item of extractContents(
      rows,
      w.type === "comment" ? "reply" : "body",
      w.section,
    )) {
      item.label = w.body_labels[item.field];
      all.push(item);
    }
  }
  const unique = new Map<string, Row>();
  for (const item of all) {
    const id = JSON.stringify([item.role, item.record_sid, item.field]);
    if (
      unique.has(id) &&
      unique.get(id)!.content.raw_html !== item.content.raw_html
    )
      throw new ParseError("Conflicting content for the same post field");
    if (!unique.has(id)) unique.set(id, item);
  }
  const values = [...unique.values()],
    body = values.filter((x) => x.role === "body"),
    replies = values.filter((x) => x.role === "reply"),
    expected = Number(pick(row, "reply_cnt", 0) || 0);
  if (!body.length && !failedWidgets.some((w) => w.type === "editor"))
    throw new ContextError(
      "Body field missing; refusing empty body as success",
    );
  const expectedIDs = listRows
    .filter((x) => pick(x, "status_type") !== "D")
    .map((x) => pick(x, "record_sid"))
    .filter((x) => x !== context.record_sid);
  if (
    !failedWidgets.some((w) => w.type === "comment") &&
    (replyRows.size !== expected ||
      expectedIDs.some((id) => !replyRows.has(id)))
  )
    throw new ContextError("Reply completeness mismatch");
  if (
    [...replyRows.keys()].some(
      (id) => !replies.some((x) => x.record_sid === id),
    )
  )
    throw new ContextError("Reply records are missing content fields");
  const post = {
    board: config.name,
    number,
    title: pick(row, "title_ctt"),
    identifiers: context,
    metadata: row,
    job_widget: jobWidget,
    related_records: related,
    body,
    replies,
    linked: values.filter((x) => x.role === "linked"),
    reply_records: [...replyRows.values()],
    ...(failedWidgets.length ? { failed_widgets: failedWidgets } : {}),
  };
  await dump(join(client.out, "post.json"), post);
  return post;
}
