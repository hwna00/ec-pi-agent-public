import { createHash } from "node:crypto";
import { formatTimeLogRemarks } from "./notes.ts";

/**
 * Offline-only CreateBoardAction payload construction.
 *
 * Values below were observed in the supplied 2026-10-14 capture. They are not
 * discovery results from a live ERP session. Authentication belongs exclusively
 * to the eventual browser transport and is never part of this module.
 */
export const TIME_LOG_BIZZ_SID = "B_000000E074025";
export const TIME_LOG_MENU_SID = "M_000000E074025";
export const JOB_BIZZ_SID = "B_000000E074008";

export interface CodeRef {
  sid: string;
  code: string;
  name: string;
}

/** dataSid is a transaction's data identity, never its display number or recordSid. */
export interface ResolvedRef {
  bizzSid: string;
  dataSid: string;
  name: string;
  bizzName?: string;
}

export interface TimeLogCategory {
  code: string;
  name: string;
}

/** ERP user delivery range; employee/person codes are a separate identity. */
export type TimeLogDelivery = { type: "A" } | { type: "S"; codes: CodeRef[] };

export interface TimeLogProfile {
  tenantSid: string;
  templateSid: string;
  department: CodeRef;
  person: CodeRef;
  /** Omission uses the observed ERP default A (전체), never the employee ID. */
  deliver?: TimeLogDelivery;
}

export const defaultProfile: Readonly<TimeLogProfile> = Object.freeze({
  tenantSid: "80000",
  templateSid: "7VC6DMBMUFD7GKP",
  department: Object.freeze({ sid: "5.6TFT", code: "5.6TFT", name: "5.6TFT" }),
  person: Object.freeze({ sid: "2025-053", code: "2025-053", name: "하철환" }),
  // The supplied successful input and response both use 전달자 전체.
  deliver: Object.freeze({ type: "A" as const }),
});

export const observedCategories: readonly Readonly<TimeLogCategory>[] =
  Object.freeze([Object.freeze({ code: "13", name: "개발" })]);

export interface TimeLogRowInput {
  /** Explicit human-entered time only. Omission remains blank, never elapsed time or zero. */
  minutes?: number;
  description: string;
  /** Compatibility input: only fixed code 13 / 개발 is accepted. */
  category?: { code: string; name?: string };
  /** The 작업 column. Its connection is independent of 업무 and 거래. */
  job?: ResolvedRef;
  /** The 업무 + 거래 columns. Omission leaves these columns empty. */
  transaction?: ResolvedRef;
  /** Explicit 종료 예정일; the daily command supplies its requested date. */
  endDate?: string;
}

export interface TimeLogPayloadInput {
  /** Header 일자, represented by the master custom date field. */
  workDate: string;
  /** 전표 작성일, a separate field from workDate and row.endDate. */
  slipDate: string;
  rows: TimeLogRowInput[];
  profile?: TimeLogProfile;
}

export type TimeLogRecord = Record<string, unknown>;

export interface TimeLogPayload {
  bizz_sid: typeof TIME_LOG_BIZZ_SID;
  bizz_id: "board";
  action_mode: "NEW" | "UPDATE";
  menu_sid: typeof TIME_LOG_MENU_SID;
  menu_type: "input";
  data: {
    bizz_sid: typeof TIME_LOG_BIZZ_SID;
    additional_info: {
      confirm_type: "Y";
      change_bizz_info: Record<string, never>;
    };
    slip_info: {
      bizz_sid: typeof TIME_LOG_BIZZ_SID;
      menu_sid: typeof TIME_LOG_MENU_SID;
      menu_type: "input";
      action_mode: "NEW" | "UPDATE";
      data_dt: string;
      data_sid: string;
      data_no?: number;
    };
    current_template: string;
    is_za_from_only: false;
    model_data: {
      boardXmaster: TimeLogRecord[];
      boardXdetail: TimeLogRecord[];
      boardXeditor: TimeLogRecord[];
      notification: TimeLogRecord[];
      hold: never[];
    };
  };
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

/** Accept an explicit calendar date without consulting the machine's timezone. */
export function normalizeTimeLogDate(value: unknown, label = "date"): string {
  const text = textValue(value, label);
  const match = /^(\d{4})(?:-?(\d{2}))-?(\d{2})$/.exec(text);
  if (!match || !/^(?:\d{8}|\d{4}-\d{2}-\d{2})$/.test(text)) {
    throw new Error(`${label} must be YYYY-MM-DD or YYYYMMDD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

function codeRef(value: CodeRef, label: string): CodeRef {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} must contain sid, code and name`);
  }
  return {
    sid: textValue(value.sid, `${label}.sid`),
    code: textValue(value.code, `${label}.code`),
    name: textValue(value.name, `${label}.name`),
  };
}

function deliveryValue(profile: TimeLogProfile): TimeLogDelivery {
  const value: TimeLogDelivery =
    profile.deliver === undefined ? { type: "A" } : profile.deliver;
  if (typeof value !== "object" || value === null) {
    throw new Error("profile.deliver must specify A (전체) or S (선택)");
  }
  if (value.type === "A") {
    if ("codes" in value) {
      throw new Error(
        "profile.deliver A (전체) must not contain selected codes",
      );
    }
    return { type: "A" };
  }
  if (value.type !== "S") {
    throw new Error("profile.deliver.type must be A (전체) or S (선택)");
  }
  if (!Array.isArray(value.codes) || value.codes.length === 0) {
    throw new Error(
      "profile.deliver S (선택) requires explicit ERP user codes",
    );
  }
  return {
    type: "S",
    codes: value.codes.map((recipient, index) =>
      codeRef(recipient, `profile.deliver.codes[${index}]`),
    ),
  };
}

/** Preview and payload resolve the identical validated recipient configuration. */
export function timeLogDeliveryLabel(profile: TimeLogProfile): string {
  const delivery = deliveryValue(profile);
  return delivery.type === "A"
    ? "전체"
    : `선택 (${delivery.codes.map((recipient) => recipient.name).join(", ")})`;
}

function resolvedRef(value: ResolvedRef, label: string): ResolvedRef {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} must contain bizzSid, dataSid and name`);
  }
  const reference: ResolvedRef = {
    bizzSid: textValue(value.bizzSid, `${label}.bizzSid`),
    dataSid: textValue(value.dataSid, `${label}.dataSid`),
    name: textValue(value.name, `${label}.name`),
  };
  if (value.bizzName !== undefined)
    reference.bizzName = textValue(value.bizzName, `${label}.bizzName`);
  return reference;
}

function categoryValue(
  value: TimeLogRowInput["category"],
  label: string,
): TimeLogCategory {
  const requested = value ?? observedCategories[0]!;
  const code = textValue(requested.code, `${label}.code`);
  const known = observedCategories.find((category) => category.code === code);
  if (!known) {
    throw new Error(`${label}.code must be the fixed category 13 (개발)`);
  }
  if (requested.name !== undefined && requested.name !== known.name) {
    throw new Error(
      `${label}.name does not match observed code ${code} (${known.name})`,
    );
  }
  return { code: known.code, name: known.name };
}

function numericValue(minutes: number): string {
  return `∬N:${minutes}.0000000000∬`;
}

/**
 * Client row keys, not persisted ERP identities. NEW replaces these on the
 * server. Keep them stable when rebuilding the reviewed payload, distinct per
 * row, and within the observed 15-character SID representation. Never reuse a
 * captured document's SID or call a numbering API.
 */
function temporarySid(seed: string, model: string, index = 0): string {
  return createHash("sha256")
    .update(JSON.stringify([seed, model, index]))
    .digest("hex")
    .slice(0, 15)
    .toUpperCase();
}

function buildDetail(
  input: TimeLogRowInput,
  index: number,
  slipDate: string,
  tenantSid: string,
): TimeLogRecord {
  const label = `rows[${index}]`;
  if (typeof input !== "object" || input === null) {
    throw new Error(`${label} must be an object`);
  }
  if (
    input.minutes !== undefined &&
    (!Number.isSafeInteger(input.minutes) ||
      input.minutes <= 0 ||
      input.minutes > 1440)
  ) {
    throw new Error(
      `${label}.minutes must be a positive integer no greater than 1440`,
    );
  }
  const description = formatTimeLogRemarks(
    textValue(input.description, `${label}.description`),
  );
  const category = categoryValue(input.category, `${label}.category`);
  const row: TimeLogRecord = {
    board_m$tenant_sid: tenantSid,
    board_m$bizz_sid: TIME_LOG_BIZZ_SID,
    board_m$data_sid: "",
    board_m$data_dt: slipDate,
    board_m$data_no: null,
    // 5.0 initializes SID/enum text to empty; the server resolves item_set_sid.
    board_m$status_type: "",
    board_m$item_set_sid: "",
    board_m$txt_001: "기타",
    board_m$cd_001: {
      sid: category.code,
      code: category.code,
      name: category.name,
    },
    board_m$cd_sid_001: category.code,
    board_m$cd_cd_001: category.code,
    board_m$cd_nm_001: category.name,
    board_m$cd_001_simple_bizz_sid: "7MK8O9MTD787FUD",
    board_m$cd_001_category_sid: "",
    board_m$num_001:
      input.minutes === undefined ? null : numericValue(input.minutes),
    board_m$atxt_001: description,
    board_m$default_value_init: false,
    board_m$detail_row_index: index,
  };
  if (input.endDate !== undefined) {
    row["board_m$dt_001"] = normalizeTimeLogDate(
      input.endDate,
      `${label}.endDate`,
    );
  }
  if (input.job !== undefined) {
    const job = resolvedRef(input.job, `${label}.job`);
    if (job.bizzSid !== JOB_BIZZ_SID) {
      throw new Error(
        `${label}.job must reference the 작업 business ${JOB_BIZZ_SID}`,
      );
    }
    row["board_m$conn_data_002"] = {
      bizz_sid: job.bizzSid,
      sid: job.dataSid,
      code: job.dataSid,
      name: job.name,
    };
    row["board_m$conn_data_bizz_sid_002"] = job.bizzSid;
    row["board_m$conn_data_sid_002"] = job.dataSid;
    row["board_m$conn_data_cd_002"] = job.dataSid;
    row["board_m$conn_data_nm_002"] = job.name;
  }
  if (input.transaction !== undefined) {
    const transaction = resolvedRef(input.transaction, `${label}.transaction`);
    const business: TimeLogRecord = {
      sid: transaction.bizzSid,
      code: transaction.bizzSid,
    };
    if (transaction.bizzName !== undefined)
      business.name = transaction.bizzName;
    row["board_m$dynamic_bizz"] = business;
    row["board_m$dynamic_bizz_sid"] = transaction.bizzSid;
    row["board_m$dynamic_bizz_cd"] = transaction.bizzSid;
    if (transaction.bizzName !== undefined)
      row["board_m$dynamic_bizz_nm"] = transaction.bizzName;
    row["board_m$dynamic_trx"] = {
      sid: transaction.dataSid,
      code: transaction.dataSid,
      name: transaction.name,
    };
    row["board_m$dynamic_trx_sid"] = transaction.dataSid;
    row["board_m$dynamic_trx_cd"] = transaction.dataSid;
    row["board_m$dynamic_trx_nm"] = transaction.name;
  }
  return row;
}

function disabledNotification(): TimeLogRecord {
  const notiChannel: TimeLogRecord = {};
  for (const channel of [
    "email",
    "sms",
    "attach_link",
    "kakao",
    "messenger",
    "memo",
    "app_push",
  ]) {
    notiChannel[channel] = { visible: true, use: false };
  }
  return {
    noti_target: {
      writer: { use: false, codes: [] },
      deliver: { use: false, codes: [] },
    },
    custom_target_id: [],
    custom_target_dept: [],
    noti_channel: notiChannel,
    noti_message: {
      email_title: "",
      mobile_content: "",
      internal_notification_content: "",
    },
  };
}

/**
 * Build a fresh, allowlisted NEW request. Captured editor IDs, notification
 * recipients, hold IDs, derived caches and inherited records cannot enter it.
 * Input metadata uses fresh client keys and source-backed NEW defaults. The
 * server owns the final SID, numbering and authenticated writer/updater.
 * This function has no transport and performs no API requests.
 */
export function buildTimeLogPayload(
  input: TimeLogPayloadInput,
): TimeLogPayload {
  if (typeof input !== "object" || input === null)
    throw new Error("input must be an object");
  const workDate = normalizeTimeLogDate(input.workDate, "workDate");
  const slipDate = normalizeTimeLogDate(input.slipDate, "slipDate");
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("rows must contain at least one time entry");
  }
  const profile = input.profile ?? defaultProfile;
  const tenantSid = textValue(profile.tenantSid, "profile.tenantSid");
  const templateSid = textValue(profile.templateSid, "profile.templateSid");
  const department = codeRef(profile.department, "profile.department");
  const person = codeRef(profile.person, "profile.person");
  const delivery = deliveryValue(profile);
  const rows = input.rows.map((row, index) =>
    buildDetail(row, index, slipDate, tenantSid),
  );
  const keySeed = JSON.stringify({
    workDate,
    slipDate,
    tenantSid,
    templateSid,
    department,
    person,
    delivery,
    rows,
  });
  rows.forEach((row, index) => {
    row["board_m$record_sid"] = temporarySid(keySeed, "boardXdetail", index);
  });
  const totalMinutes = input.rows.reduce(
    (sum, row) => sum + (row.minutes ?? 0),
    0,
  );
  if (totalMinutes > 1440)
    throw new Error("total minutes for one work date cannot exceed 1440");
  // A partial sum would incorrectly look like the day's completed total. Leave
  // the master total blank until every row has an explicitly supplied duration.
  const allMinutesSpecified = input.rows.every(
    (row) => row.minutes !== undefined,
  );
  const titleDate = `${workDate.slice(0, 4)}/${workDate.slice(
    4,
    6,
  )}/${workDate.slice(6, 8)}`;
  const master: TimeLogRecord = {
    board_s$tenant_sid: tenantSid,
    board_s$bizz_sid: TIME_LOG_BIZZ_SID,
    board_s$data_sid: "",
    board_s$data_dt: slipDate,
    board_s$data_dt_no: { data_dt: slipDate },
    board_s$data_no: null,
    // 5.0 NEW input defaults; do not substitute the previous saved document.
    board_s$record_sid: "",
    board_s$record_depth_no: 0,
    board_s$record_seq_no: 0,
    board_s$status_type: "U",
    board_s$ver_no: 0,
    board_s$repo_sid: TIME_LOG_BIZZ_SID.replace("B_", "R_"),
    board_s$data_model_id: "board_master",
    board_s$reply_cnt: 0,
    board_s$hid: null,
    board_s$bizz_class_sid: TIME_LOG_BIZZ_SID.replace("B_0", "BC_"),
    board_s$slip_link: { slip_attach: {}, file_attach: {} },
    board_s$action_mode: "",
    board_s$cust_sid: "",
    board_s$pjt_sid: "",
    board_s$prod_sid: "",
    board_s$dynamic_bizz_sid: "",
    board_s$parent_record_sid: "",
    board_s$anounc_tf: false,
    board_s$deliver: delivery,
    board_s$delivr_range_type: delivery.type,
    board_s$progress_status: { sid: "1000", code: "1000", name: "내시간관리" },
    board_s$progress_status_sid: "1000",
    board_s$progress_status_cd: "1000",
    board_s$progress_status_nm: "내시간관리",
    board_s$progress_status_simple_bizz_sid: "B_000000E201187",
    board_s$progress_status_category_sid: "CG_PS_E074025_001",
    board_s$data_input_type: "I",
    board_s$title_ctt: `[ ${titleDate} ] ${department.name} ${person.name}`,
    board_s$dept: department,
    board_s$dept_sid: department.sid,
    board_s$dept_cd: department.code,
    board_s$dept_nm: department.name,
    board_s$pic: person,
    board_s$pic_sid: person.sid,
    board_s$pic_cd: person.code,
    board_s$pic_nm: person.name,
    board_s$dt_001: workDate,
    board_s$num_001: allMinutesSpecified ? numericValue(totalMinutes) : null,
    board_s$menu_sid: TIME_LOG_MENU_SID,
    board_s$confirm_type: "Y",
  };
  if (delivery.type === "S") {
    master["board_s$deliver_codes"] = delivery.codes.map((recipient) => ({
      sid: recipient.sid,
      code: recipient.code,
      name: recipient.name,
    }));
  }
  return {
    bizz_sid: TIME_LOG_BIZZ_SID,
    bizz_id: "board",
    action_mode: "NEW",
    menu_sid: TIME_LOG_MENU_SID,
    menu_type: "input",
    data: {
      bizz_sid: TIME_LOG_BIZZ_SID,
      additional_info: { confirm_type: "Y", change_bizz_info: {} },
      slip_info: {
        bizz_sid: TIME_LOG_BIZZ_SID,
        menu_sid: TIME_LOG_MENU_SID,
        menu_type: "input",
        action_mode: "NEW",
        data_dt: slipDate,
        data_sid: "",
      },
      current_template: templateSid,
      is_za_from_only: false,
      model_data: {
        boardXmaster: [master],
        boardXdetail: rows,
        boardXeditor: [
          {
            board_b$tenant_sid: tenantSid,
            board_b$bizz_sid: TIME_LOG_BIZZ_SID,
            board_b$data_sid: "",
            board_b$data_dt: slipDate,
            board_b$data_no: null,
            board_b$editor_sid: temporarySid(keySeed, "boardXeditor"),
            board_b$record_sid: "",
            board_b$status_type: "U",
            board_b$item_set_sid: "",
            board_b$item_sid: "",
            board_b$item_meaning_id: "content_html",
            board_b$body_ctt: "",
            board_b$attach: "",
          },
        ],
        notification: [disabledNotification()],
        hold: [],
      },
    },
  };
}
