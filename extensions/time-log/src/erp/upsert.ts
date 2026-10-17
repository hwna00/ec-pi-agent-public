import { createHash } from "node:crypto";
import {
  TIME_LOG_BIZZ_SID,
  TIME_LOG_MENU_SID,
  type TimeLogPayload,
  type TimeLogRecord,
} from "./payload.ts";

export const TIME_LOG_SEARCH_PATH =
  "/ec5/api/app.board/action/SelectBoardSearchListAction::board:list";
export const TIME_LOG_LOAD_PATH =
  "/ec56/api/board/action/GetBoardInputModelAction::board:input";
export const TIME_LOG_MODIFY_PATH =
  "/ec56/api/board/action/ModifyBoardAction::board:input";
export const TIME_LOG_TEMPLATE_PATH =
  "/ec5/api/app.setup/action/template/GetTemplateInfoAction::board:list";
export const TIME_LOG_MENUS_PATH =
  "/ec5/api/app.setup/action/bizz/menu_setting/SelectSubMenuListAction::board:list";

export interface TimeLogPostIdentity {
  dataSid: string;
  recordSid: string;
  boardNumber: number;
  dataDate: string;
  title: string;
}
export interface TimeLogIdentityContext {
  tenantSid: string;
  loginUserSid: string;
  origin?: string;
}
export interface TimeLogLoadedModels {
  boardXmaster: TimeLogRecord[];
  boardXdetail: TimeLogRecord[];
  boardXeditor: TimeLogRecord[];
}
export interface TimeLogExistingPost {
  identity: TimeLogPostIdentity;
  modelData: TimeLogLoadedModels;
}
export interface TimeLogSavePlan {
  action: "NEW" | "UPDATE";
  payload: TimeLogPayload;
  baselineHash: string;
  scopeKey: string;
  target?: TimeLogPostIdentity;
}

function fail(message: string): never {
  throw new Error(`시간 로그 기존 글 확인: ${message}`);
}
function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 누락`);
  return value as string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function normalize(value: any): any {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === "__$KeyPack" &&
    object(value[1])
  ) {
    const names = value[1];
    const unpack = (item: any): any =>
      Array.isArray(item)
        ? item.map(unpack)
        : object(item)
        ? Object.fromEntries(
            Object.entries(item).map(([key, child]) => [
              names[key] ?? key,
              unpack(child),
            ]),
          )
        : item;
    return normalize(unpack(value[2]));
  }
  return Array.isArray(value)
    ? value.map(normalize)
    : object(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, normalize(child)]),
      )
    : value;
}
/** Accept the browser transport response or an already decoded ERP envelope. */
function dataOf(response: unknown): any {
  let body: any = response;
  if (!object(body)) fail("응답 형식 오류");
  if ("body" in body) {
    if (body.error !== undefined && body.error !== null)
      fail("조회 브라우저 오류");
    if (body.status !== 200 || typeof body.body !== "string")
      fail("조회 HTTP 응답 오류");
    try {
      body = JSON.parse(body.body);
    } catch {
      fail("조회 JSON 응답 오류");
    }
  }
  body = normalize(body);
  const emptyError = (value: unknown) =>
    value === undefined ||
    value === null ||
    (object(value) && Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0);
  if (
    !object(body) ||
    body.Status !== 200 ||
    !emptyError(body.Error) ||
    !emptyError(body.Errors)
  )
    fail("조회 ERP 응답 오류");
  const data = body.Data;
  if (!object(data) && !Array.isArray(data)) fail("조회 서버 오류");
  if (
    !Array.isArray(data) &&
    (!emptyError(data.error) || !emptyError(data.error_info))
  )
    fail("조회 서버 오류");
  return data;
}

function scope(payload: TimeLogPayload, loginUserSid: string) {
  const master = payload.data.model_data.boardXmaster;
  if (payload.bizz_sid !== TIME_LOG_BIZZ_SID || master.length !== 1)
    fail("초안 업무 정보 오류");
  const row = master[0]!;
  return {
    tenantSid: requiredText(row["board_s$tenant_sid"], "회사"),
    loginUserSid: requiredText(loginUserSid, "로그인 사용자"),
    personSid: requiredText(row["board_s$pic_sid"], "담당자"),
    workDate: requiredText(row["board_s$dt_001"], "작업일자"),
  };
}

export function buildTimeLogMenusRequest() {
  return { bizz_sid: TIME_LOG_BIZZ_SID };
}
export function parseTimeLogMenusResponse(response: unknown): string {
  const data = dataOf(response);
  if (!Array.isArray(data) || !data.every(object))
    fail("게시판 메뉴 응답 형식 오류");
  const candidates = data.filter(
    (menu) =>
      menu.menu_type_name === "조회" ||
      menu.menu_type === "list" ||
      menu.menu?.menu_type === "list",
  );
  const sids = new Set<string>(
    candidates.map((menu) => requiredText(menu.menu_sid, "조회 메뉴")),
  );
  if (sids.size !== 1) fail("게시판 조회 메뉴를 하나로 결정할 수 없습니다.");
  return [...sids][0]!;
}
export function buildTimeLogTemplateRequest(menuSid: string) {
  // The list template client calls GetTemplateInfoAction directly with its menu.
  return {
    bizz_sid: TIME_LOG_BIZZ_SID,
    menu_sid: requiredText(menuSid, "조회 메뉴"),
    menu_type: "list",
    template_sub_type: "fixed",
  };
}
export function parseTimeLogTemplateResponse(response: unknown): string {
  const data = dataOf(response);
  return requiredText(data?.current_template, "조회 양식");
}
export function buildTimeLogSearchRequest(
  payload: TimeLogPayload,
  currentTemplate: string,
  loginUserSid: string,
  page = 1,
  menuSid: string,
) {
  const expected = scope(payload, loginUserSid);
  return {
    bizz_sid: TIME_LOG_BIZZ_SID,
    menu_sid: requiredText(menuSid, "조회 메뉴"),
    menu_type: "list",
    template_sub_type: "fixed",
    current_template: currentTemplate,
    is_za_template: false,
    additional: { view_all: true, expand_all: false, notice_count: 0 },
    target: Object.fromEntries(
      [
        "tenant_sid",
        "bizz_sid",
        "data_sid",
        "record_sid",
        "data_dt",
        "data_no",
        "title_ctt",
        "write_sid",
        "pic_sid",
        "dt_001",
        "parent_record_sid",
        "record_depth_no",
        "status_type",
      ].map((field) => [`board_s$${field}`, {}]),
    ),
    condition: Object.fromEntries(
      Object.entries({
        tenant_sid: expected.tenantSid,
        write_sid: expected.loginUserSid,
        pic_sid: expected.personSid,
        dt_001: expected.workDate,
        record_depth_no: 0,
        status_type: "U",
      }).map(([field, value]) => [`board_s$${field}`, { type: "=", value }]),
    ),
    sort: { board_s$data_no: { sort_type: "desc", priority: 1 } },
    page: { current_index: page, row_count: 100 },
  };
}

function validateMaster(
  row: TimeLogRecord,
  payload: TimeLogPayload,
  loginUserSid: string,
  expected?: TimeLogPostIdentity,
  allowMissingPerson = false,
): TimeLogPostIdentity {
  const check = scope(payload, loginUserSid);
  for (const [field, value] of Object.entries({
    tenant_sid: check.tenantSid,
    bizz_sid: TIME_LOG_BIZZ_SID,
    write_sid: check.loginUserSid,
    pic_sid: check.personSid,
    dt_001: check.workDate,
    status_type: "U",
  }))
    if (
      !(
        field === "pic_sid" &&
        allowMissingPerson &&
        row["board_s$pic_sid"] === undefined
      ) &&
      row[`board_s$${field}`] !== value
    )
      fail(`${field} 일치 검증 실패`);
  if (
    row["board_s$parent_record_sid"] ||
    Number(row["board_s$record_depth_no"]) !== 0
  )
    fail("본문이 아닌 글");
  const boardNumber = row["board_s$data_no"];
  if (!Number.isSafeInteger(boardNumber) || Number(boardNumber) < 1)
    fail("글 번호 오류");
  const identity = {
    dataSid: requiredText(row["board_s$data_sid"], "data_sid"),
    recordSid: requiredText(row["board_s$record_sid"], "record_sid"),
    boardNumber: boardNumber as number,
    dataDate: requiredText(row["board_s$data_dt"], "전표일자"),
    title: requiredText(row["board_s$title_ctt"], "제목"),
  };
  if (
    expected &&
    ["dataSid", "recordSid", "boardNumber", "dataDate"].some(
      (key) =>
        identity[key as keyof TimeLogPostIdentity] !==
        expected[key as keyof TimeLogPostIdentity],
    )
  )
    fail("단건 조회 글 식별자 불일치");
  return identity;
}

export function parseTimeLogSearchResponse(
  response: unknown,
  payload: TimeLogPayload,
  loginUserSid: string,
): TimeLogPostIdentity | undefined {
  const data = dataOf(response);
  const batches = Array.isArray(data) ? data : [data];
  if (!batches.every((batch) => object(batch) && Array.isArray(batch.data)))
    fail("목록 응답 형식 오류");
  const rows: TimeLogRecord[] = batches.flatMap((batch) => batch.data);
  if (!rows.every(object)) fail("목록 행 형식 오류");
  let total = 0;
  let hasCount = false;
  for (const batch of batches) {
    if ("total_count" in batch) {
      if (!Number.isSafeInteger(batch.total_count) || batch.total_count < 0)
        fail("전체 건수 오류");
      total += batch.total_count;
      hasCount = true;
    }
  }
  // The configured list projection may omit pic_sid even when the server-side
  // person filter is present. The mandatory single input load validates it fully.
  const found = rows.map((row) =>
    validateMaster(row, payload, loginUserSid, undefined, true),
  );
  const unique = new Map<string, TimeLogPostIdentity>();
  for (const item of found) {
    const key = canonical([item.dataSid, item.recordSid]);
    if (unique.has(key) && canonical(unique.get(key)) !== canonical(item))
      fail("동일 글의 목록 식별자가 서로 다릅니다.");
    unique.set(key, item);
  }
  const identities = [...unique.values()];
  // A list joined to detail rows can count either documents or returned rows.
  // In either form the whole count must be represented in this response.
  if (
    (hasCount && total !== rows.length && total !== identities.length) ||
    rows.length >= 100
  )
    fail("조회 결과가 일부만 반환됨");
  if (identities.length > 1)
    fail(
      "동일 작업일자와 작성자 글이 여러 개입니다. 사이트에서 정리한 뒤 다시 실행하세요.",
    );
  return identities[0];
}

export function buildTimeLogLoadRequest(
  identity: TimeLogPostIdentity,
  payload: TimeLogPayload,
) {
  return {
    bizz_sid: TIME_LOG_BIZZ_SID,
    bizz_id: "board",
    menu_sid: TIME_LOG_MENU_SID,
    menu_type: "input",
    bizz_type: "board",
    record_type: "main",
    parent_record_sid: "",
    additional_info: {},
    action_mode: "GET_MODIFY",
    data_sid: identity.dataSid,
    record_sid: identity.recordSid,
    data_dt: identity.dataDate,
    data_no: identity.boardNumber,
    template_set_sid: payload.data.current_template,
  };
}

// Joined lookup rows such as $writer may contain unrelated directory data. Only
// the board's own persisted fields are retained; nested lookup caches are dropped.
function cleanValue(value: any): any {
  if (Array.isArray(value)) return value.map(cleanValue);
  if (object(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !key.startsWith("$") &&
            !["__proto__", "constructor", "prototype"].includes(key),
        )
        .map(([key, child]) => [key, cleanValue(child)]),
    );
  return value;
}
function cleanRow(row: TimeLogRecord, prefix: string): TimeLogRecord {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key.startsWith(prefix) && key !== "board_s$pw")
      .map(([key, value]) => [key, cleanValue(value)]),
  );
}

export function parseTimeLogLoadResponse(
  response: unknown,
  payload: TimeLogPayload,
  identity: TimeLogPostIdentity,
  loginUserSid: string,
): TimeLogLoadedModels {
  const data = dataOf(response);
  if (
    !object(data) ||
    !Array.isArray(data.boardXmaster) ||
    data.boardXmaster.length !== 1 ||
    !Array.isArray(data.boardXdetail) ||
    !Array.isArray(data.boardXeditor) ||
    !data.boardXeditor.length
  )
    fail("단건 입력 모델 형식 오류");
  if (
    ![...data.boardXmaster, ...data.boardXdetail, ...data.boardXeditor].every(
      object,
    )
  )
    fail("단건 입력 행 형식 오류");
  validateMaster(data.boardXmaster[0], payload, loginUserSid, identity);
  const version = data.boardXmaster[0]["board_s$ver_no"];
  if (!Number.isSafeInteger(version) || version < 0) fail("글 버전 누락");
  const tenant = scope(payload, loginUserSid).tenantSid;
  // GetDefaultRowInitFeature fills the input grid with unsaved template rows.
  // They receive new temporary record SIDs on every load and are not records to
  // preserve or fingerprint. Persisted/manual rows keep their complete identity.
  const details = data.boardXdetail.filter(
    (row: TimeLogRecord) =>
      !(
        row["board_m$default_value_init"] === true &&
        row["board_m$tenant_sid"] === tenant &&
        !row["board_m$bizz_sid"] &&
        !row["board_m$data_sid"]
      ),
  );
  for (const [name, prefix] of [
    ["boardXdetail", "board_m$"],
    ["boardXeditor", "board_b$"],
  ] as const) {
    for (const row of name === "boardXdetail" ? details : data[name]) {
      if (
        row[`${prefix}tenant_sid`] !== tenant ||
        row[`${prefix}bizz_sid`] !== TIME_LOG_BIZZ_SID
      )
        fail(`${name} 회사 또는 업무 불일치`);
      if (
        row[`${prefix}data_sid`] &&
        row[`${prefix}data_sid`] !== identity.dataSid
      )
        fail(`${name} 글 식별자 불일치`);
      if (
        name === "boardXdetail" &&
        (!row[`${prefix}record_sid`] ||
          row[`${prefix}data_sid`] !== identity.dataSid)
      )
        fail("기존 상세 행 식별자 누락");
    }
  }
  return {
    boardXmaster: data.boardXmaster.map((row: TimeLogRecord) =>
      cleanRow(row, "board_s$"),
    ),
    boardXdetail: details.map((row: TimeLogRecord) =>
      cleanRow(row, "board_m$"),
    ),
    boardXeditor: data.boardXeditor.map((row: TimeLogRecord) =>
      cleanRow(row, "board_b$"),
    ),
  };
}

function referenceSid(
  row: TimeLogRecord,
  flat: string,
  compound: string,
): string {
  const direct = row[flat];
  const nested = object(row[compound]) ? row[compound].sid : undefined;
  if (
    (direct != null && typeof direct !== "string") ||
    (nested != null && typeof nested !== "string")
  )
    fail("상세 연결 식별자 형식 오류");
  if (direct && nested && direct !== nested)
    fail("상세 연결 식별자가 서로 다릅니다.");
  return (direct || nested || "") as string;
}
function rowKey(row: TimeLogRecord): string | undefined {
  const job = referenceSid(
    row,
    "board_m$conn_data_sid_002",
    "board_m$conn_data_002",
  );
  const business = referenceSid(
    row,
    "board_m$dynamic_bizz_sid",
    "board_m$dynamic_bizz",
  );
  const trx = referenceSid(
    row,
    "board_m$dynamic_trx_sid",
    "board_m$dynamic_trx",
  );
  if (!job && !business && !trx) return undefined;
  return canonical([job, business, trx]);
}
function keyedRows(rows: TimeLogRecord[]): Map<string, TimeLogRecord> {
  const map = new Map<string, TimeLogRecord>();
  for (const row of rows) {
    const key = rowKey(row);
    if (!key) continue;
    if (map.has(key))
      fail(
        "동일 작업·업무·거래 상세 행이 여러 개여서 자동 병합할 수 없습니다.",
      );
    map.set(key, row);
  }
  return map;
}

export function buildTimeLogSavePlan(
  payload: TimeLogPayload,
  context: TimeLogIdentityContext,
  existing?: TimeLogExistingPost,
): TimeLogSavePlan {
  const expected = scope(payload, context.loginUserSid);
  if (expected.tenantSid !== context.tenantSid) fail("로그인 회사 불일치");
  const scopeKey = hash({ bizzSid: TIME_LOG_BIZZ_SID, ...expected });
  const next = structuredClone(payload);
  if (!existing)
    return {
      action: "NEW",
      payload: next,
      baselineHash: hash({
        absent: true,
        scopeKey,
        origin: context.origin ?? "",
      }),
      scopeKey,
    };
  const { identity, modelData } = existing;
  const loadedIdentity = validateMaster(
    modelData.boardXmaster[0]!,
    payload,
    context.loginUserSid,
    identity,
  );
  const old = {
    boardXmaster: modelData.boardXmaster.map((row) =>
      cleanRow(row, "board_s$"),
    ),
    boardXdetail: modelData.boardXdetail.map((row) =>
      cleanRow(row, "board_m$"),
    ),
    boardXeditor: modelData.boardXeditor.map((row) =>
      cleanRow(row, "board_b$"),
    ),
  };
  const baselineHash = hash({
    scopeKey,
    origin: context.origin ?? "",
    models: old,
  });
  const rows = structuredClone(old.boardXdetail);
  const existingByKey = keyedRows(rows);
  keyedRows(next.data.model_data.boardXdetail);
  let seq = Math.max(
    0,
    ...rows.map((row) => Number(row["board_m$record_seq_no"]) || 0),
  );
  for (const generated of next.data.model_data.boardXdetail) {
    const key = rowKey(generated);
    if (!key)
      fail(
        "작업·업무·거래 연결이 없는 생성 행은 기존 글에 자동 병합할 수 없습니다.",
      );
    const match = existingByKey.get(key);
    if (match) match["board_m$atxt_001"] = generated["board_m$atxt_001"];
    else {
      const row = structuredClone(generated);
      row["board_m$data_sid"] = identity.dataSid;
      row["board_m$data_dt"] = identity.dataDate;
      row["board_m$data_no"] = identity.boardNumber;
      if (old.boardXmaster[0]!["board_s$data_no_02"] !== undefined)
        row["board_m$data_no_02"] = old.boardXmaster[0]!["board_s$data_no_02"];
      row["board_m$record_seq_no"] = ++seq;
      row["board_m$detail_row_index"] = rows.length;
      rows.push(row);
    }
  }
  next.action_mode = "UPDATE";
  next.data.slip_info.action_mode = "UPDATE";
  next.data.slip_info.data_sid = identity.dataSid;
  next.data.slip_info.data_dt = identity.dataDate;
  next.data.slip_info.data_no = identity.boardNumber;
  next.data.model_data.boardXmaster = structuredClone(old.boardXmaster);
  next.data.model_data.boardXdetail = rows;
  next.data.model_data.boardXeditor = structuredClone(old.boardXeditor);
  // Notifications are always the fresh disabled notification from the draft.
  return {
    action: "UPDATE",
    payload: next,
    baselineHash,
    scopeKey,
    target: loadedIdentity,
  };
}
