import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BrowserPool, type BrowserSpec } from "./browser.ts";
import {
  readContextGraphConnection,
  registryRoot,
  pathKey,
  type ContextGraphConnection,
} from "./connection.ts";
import type { TimeLogPayload } from "./payload.ts";
import {
  buildTimeLogTemplateRequest,
  parseTimeLogTemplateResponse,
  buildTimeLogMenusRequest,
  parseTimeLogMenusResponse,
  buildTimeLogSearchRequest,
  parseTimeLogSearchResponse,
  buildTimeLogLoadRequest,
  parseTimeLogLoadResponse,
  buildTimeLogSavePlan,
  TIME_LOG_SEARCH_PATH,
  TIME_LOG_LOAD_PATH,
  TIME_LOG_MODIFY_PATH,
  TIME_LOG_TEMPLATE_PATH,
  TIME_LOG_MENUS_PATH,
  type TimeLogSavePlan,
} from "./upsert.ts";
export type { TimeLogSavePlan } from "./upsert.ts";
export { TIME_LOG_TEMPLATE_PATH } from "./upsert.ts";

export const TIME_LOG_CREATE_PATH =
  "/ec56/api/board/action/CreateBoardAction::board:input";

export class TimeLogSubmissionError extends Error {
  code: string;
  /** True means a create may have reached the server. Never automatically retry. */
  submitted: boolean;
  diagnostics?: TimeLogResponseDiagnostics;
  constructor(
    code: string,
    message: string,
    submitted = false,
    diagnostics?: TimeLogResponseDiagnostics,
  ) {
    super(message);
    this.name = "TimeLogSubmissionError";
    this.code = code;
    this.submitted = submitted;
    this.diagnostics = diagnostics;
  }
}

export type TimeLogDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | TimeLogDiagnosticValue[]
  | { [key: string]: TimeLogDiagnosticValue };

/** Safe to persist locally; never contains a raw response body, URL, or stack. */
export interface TimeLogResponseDiagnostics {
  version: 1;
  failureCode: string;
  httpStatus: number | null;
  erpStatus: number | string | null;
  requestStarted: boolean | null;
  bodyFormat: "json" | "non_json" | "missing";
  bodyLength: number | null;
  failedChecks: string[];
  serverReasons: string[];
  responseShape: { [key: string]: string | number };
  serverErrors: { [key: string]: TimeLogDiagnosticValue };
}

export interface TimeLogCreatedResult {
  dataSid: string;
  boardNumber: number;
  title: string;
}

interface TimeLogBrowser {
  id: string;
  describeCurrent?(): Promise<{
    pages: { pageId: number; targetId: string }[];
  }>;
  select(id: number): Promise<unknown>;
  evaluate(script: string): Promise<any>;
}

export interface TimeLogBrowserPool {
  discover(): Promise<
    { browser: TimeLogBrowser; page: { id: number; url: string } }[]
  >;
  close(): Promise<unknown>;
}

export interface TimeLogTransportDependencies {
  createPool(
    specs: BrowserSpec[],
  ): TimeLogBrowserPool | Promise<TimeLogBrowserPool>;
  readConfig?: () => any;
  readConnection?: (
    sessionId: string,
    config: any,
  ) => Promise<ContextGraphConnection>;
  resolvePinnedPage?: (
    browser: TimeLogBrowser,
    connection: ContextGraphConnection,
  ) => Promise<number>;
}

export interface TimeLogSubmitRequest {
  sessionId: string;
  payload: unknown;
  /** Retained for old callers; tab selection always follows ContextGraph. */
  host?: string;
  assertCurrent?: () => void | Promise<void>;
  /** The server state and operation shown in the manual save confirmation. */
  plan?: TimeLogSavePlan;
}

interface BrowserCreateRequest {
  origin: string;
  sid: string;
  tenantSid: string;
  loginUserSid?: string;
  body: string;
  action?: "NEW" | "UPDATE";
}

// The ERP shell getter is a synchronous property return in
// ecount.core.browser/src/ecount.browser.app/src/applications/ECountApp.tsx.
// Use the same reader in preflight and immediately before the POST.
const IDENTITY_READER = `const readIdentity = () => {
  const modern = globalThis.$Application?.global_context?.session;
  let shell;
  try {
    const app = globalThis.$ECountApp;
    if (typeof app?.getContext === 'function') shell = app.getContext()?.session;
  } catch { return {error: 'tenant_unavailable'}; }
  const value = v => v == null || !String(v).trim() ? null : String(v);
  if (modern?.isValid === false || shell?.isValid === false) return {error: 'session_invalid'};
  const modernTenant = value(modern?.tenant_sid), shellTenant = value(shell?.tenant_sid);
  const modernUser = value(modern?.user_sid), shellUser = value(shell?.user_sid);
  if ((modernTenant && shellTenant && modernTenant !== shellTenant) ||
      (modernUser && shellUser && modernUser !== shellUser)) return {error: 'identity_conflict'};
  const session = modernTenant ? modern : shell;
  return {tenantSid: value(session?.tenant_sid), loginUserSid: value(session?.user_sid)};
};`;

const INSPECT_SCRIPT = `() => {
  ${IDENTITY_READER}
  const identity = readIdentity();
  return {
    url: location.href,
    ...identity
  };
}`;

/**
 * Body serialization happens in Pi, outside ECOUNT's Array.prototype.toJSON realm.
 * The emitted script issues exactly one POST, or returns before fetch on a guard.
 * This builder is exported so tests can run it in a VM with an injected fetch spy.
 */
export function buildTimeLogSubmitScript(
  request: BrowserCreateRequest,
): string {
  return buildTimeLogRequestScript(
    request,
    request.action === "UPDATE" ? TIME_LOG_MODIFY_PATH : TIME_LOG_CREATE_PATH,
  );
}

/** Only read APIs can be emitted by this builder. JSON is serialized in Pi. */
export function buildTimeLogReadScript(
  request: BrowserCreateRequest,
  path: string,
): string {
  if (
    ![
      TIME_LOG_SEARCH_PATH,
      TIME_LOG_LOAD_PATH,
      TIME_LOG_TEMPLATE_PATH,
      TIME_LOG_MENUS_PATH,
    ].includes(path)
  )
    throw new TimeLogSubmissionError(
      "read_path_invalid",
      "시간로그 조회 API가 올바르지 않습니다.",
    );
  return buildTimeLogRequestScript(request, path);
}

function buildTimeLogRequestScript(
  request: BrowserCreateRequest,
  path: string,
): string {
  return `async () => {
    const r = ${JSON.stringify(request)};
    ${IDENTITY_READER}
    const current = () => {
      const u = new URL(location.href);
      if (u.origin !== r.origin || !['/ec5/view/erp', '/ec56/view/erp'].includes(u.pathname) ||
          u.searchParams.get('ec_req_sid') !== r.sid) return 'session_changed';
      const identity = readIdentity();
      if (identity.error) return identity.error;
      if (!identity.tenantSid)
        return 'tenant_unavailable';
      if (identity.tenantSid !== r.tenantSid)
        return 'tenant_changed';
      if (r.loginUserSid && identity.loginUserSid !== r.loginUserSid) return 'user_changed';
      return null;
    };
    let guard = current();
    if (guard) return { error: guard, requestStarted: false };
    const endpoint = new URL(${JSON.stringify(path)}, r.origin);
    endpoint.searchParams.set('ec_req_sid', r.sid);
    endpoint.searchParams.set('__disableMin', 'Y');
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Language': 'ko' };
    try {
      // Same header provider as v56app/src/http/policy/system_upgrade.ts.
      const ec = globalThis.$ECount;
      if (typeof ec?.getEccsverHeader === 'function') {
        const version = ec.getEccsverHeader({ url: endpoint.href });
        if (typeof version === 'string' && version) headers['X-ECCSVER'] = version;
      }
    } catch {
      return { error: 'version_header_failed', requestStarted: false };
    }
    guard = current();
    if (guard) return { error: guard, requestStarted: false };
    try {
      const options = { method: 'POST', credentials: 'include', redirect: 'error', headers, body: r.body };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
        options.signal = AbortSignal.timeout(60000);
      const response = await fetch(endpoint.href, options);
      return { status: response.status, body: await response.text(), requestStarted: true };
    } catch {
      return { error: 'browser_request_failed', requestStarted: true };
    }
  }`;
}

function readConfig() {
  const path =
    process.env.ECOUNT_CONTEXT_CONFIG ||
    fileURLToPath(new URL("../../../../ec-context.json", import.meta.url));
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    throw new TimeLogSubmissionError(
      "browser_config_invalid",
      "브라우저 설정 파일을 읽을 수 없습니다.",
    );
  }
}

function targetURL(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      /^[a-z0-9-]+\.ecount\.com$/i.test(url.hostname) &&
      /^\/ec(?:5|56)\/view\/erp$/.test(url.pathname) &&
      url.searchParams.get("ec_req_sid")
    )
      return url;
  } catch {}
  return undefined;
}

async function resolvePinnedPage(
  browser: TimeLogBrowser,
  connection: ContextGraphConnection,
) {
  if (!browser.describeCurrent)
    throw new TimeLogSubmissionError(
      "context_browser_missing",
      "ContextGraph Chrome 연결을 확인할 수 없습니다.",
    );
  // describeCurrent refreshes CDP target identity without navigating or using
  // an ERP API. Local page numbers can change when the CDP page list is refreshed.
  const current = await browser.describeCurrent();
  const matches = current.pages.filter(
    (page: any) => page.targetId === connection.targetId,
  );
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].pageId))
    throw new TimeLogSubmissionError(
      "context_target_missing",
      "ContextGraph에 연결한 탭이 닫혔거나 변경되었습니다. /ec-connect로 다시 연결하세요.",
    );
  return matches[0].pageId;
}

function expectedTenant(payload: any): string {
  const master = payload?.data?.model_data?.boardXmaster;
  if (
    payload?.bizz_sid !== "B_000000E074025" ||
    payload?.bizz_id !== "board" ||
    payload?.action_mode !== "NEW" ||
    payload?.menu_sid !== "M_000000E074025" ||
    payload?.menu_type !== "input" ||
    !Array.isArray(master) ||
    master.length !== 1 ||
    typeof master[0]?.["board_s$tenant_sid"] !== "string" ||
    !master[0]["board_s$tenant_sid"]
  )
    throw new TimeLogSubmissionError(
      "payload_invalid",
      "시간 로그 신규 입력 payload가 올바르지 않습니다.",
    );
  return master[0]["board_s$tenant_sid"];
}

const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";
const exceptionFields = new Set([
  "name",
  "status",
  "message",
  "title",
  "code",
  "key",
  "lineno",
  "bizzname",
  "displaytype",
  "menusid",
  "errorinfo",
  "error",
  "errors",
  "cause",
  "reason",
  "description",
  "detail",
  "details",
  "datamodelid",
  "propid",
  "attributeid",
  "attrid",
  "refertype",
  "errormessage",
  "displayname",
  "attrids",
  "datamodelindex",
  "datatype",
  "bizzsetname",
  "menuname",
  "errorindex",
  "validatorid",
  "iserror",
  "type",
  "cansavetf",
  "itemname",
  "itemsetgroupnm",
]);
const normalizedKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");
const secretKey = (key: string) =>
  /session|cookie|token|password|passwd|pwd|auth|credential|secret|apikey|csrf|ecreqsid/.test(
    normalizedKey(key),
  );

// Diagnostics inspect only own data properties, so getters and toJSON methods
// from an unexpected MCP value cannot run while recording an error.
function ownValue(value: unknown, key: string): any {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticText(value: string, limit = 512): string {
  // Do not retain serialized request/session snapshots inside error messages.
  let safe = value.replace(/(?:\{\s*["']|\[\s*\{)[\s\S]*/, OMITTED);
  safe = safe
    .replace(/https?(?::\/\/|%3a%2f%2f)[^\s"'<>]+/gi, "[URL OMITTED]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, REDACTED)
    .replace(/\bE-[a-z0-9_-]{6,}\b/gi, REDACTED)
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, REDACTED)
    // A credential label may precede a multiline snapshot or cookie list.
    // Omit its entire suffix rather than preserving an unrecognized value.
    .replace(
      /\b(ec_req_sid|sid|session(?:[_-]?(?:id|sid|key))?s?|set-cookie|cookies?|(?:access|refresh|auth|csrf)[_-]?tokens?|tokens?|password|passwd|pwd|authorization|authentication|auth(?:[_-]?(?:code|key|header))?|credentials?|(?:client[_-]?)?secrets?|api[_-]?key|csrf)\b["']?\s*(?:(?:[:=]|%3[ad])\s*|\s+)[\s\S]*/gi,
      (_text, label: string) => `${label}=${REDACTED}`,
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length > limit
    ? `${safe.slice(0, Math.max(0, limit - 1))}…`
    : safe;
}

function valueShape(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string" && !value) return "empty_string";
  return typeof value;
}

function emptyErrorObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/**
 * Captures only bounded exception fields, never Data.data_model or the raw body.
 * Source contracts: IException/ICommonException and HTTP ExceptionResolver's
 * Data.name/Name, message/Message, Title. Status does not prove a rollback.
 */
export function buildTimeLogResponseDiagnostics(
  response: unknown,
  failureCode: string,
  parsedBody?: unknown,
): TimeLogResponseDiagnostics {
  const rawBody = ownValue(response, "body");
  let body = parsedBody;
  let bodyFormat: TimeLogResponseDiagnostics["bodyFormat"] = "missing";
  if (typeof rawBody === "string") {
    try {
      body = parsedBody === undefined ? JSON.parse(rawBody) : parsedBody;
      bodyFormat = "json";
    } catch {
      bodyFormat = "non_json";
    }
  } else if (parsedBody !== undefined) {
    bodyFormat = "json";
  }
  const data = ownValue(body, "Data");
  const error = ownValue(data, "error");
  const errorInfo = ownValue(error, "error_info");
  const result = ownValue(
    ownValue(ownValue(data, "slip_created_result"), "boardXmaster"),
    "data",
  );
  const httpStatus = ownValue(response, "status");
  const erpStatus = ownValue(body, "Status");
  const started = ownValue(response, "requestStarted");
  const diagnostics: TimeLogResponseDiagnostics = {
    version: 1,
    failureCode: diagnosticText(failureCode, 80),
    httpStatus:
      typeof httpStatus === "number" && Number.isFinite(httpStatus)
        ? httpStatus
        : null,
    erpStatus:
      typeof erpStatus === "number" && Number.isFinite(erpStatus)
        ? erpStatus
        : typeof erpStatus === "string"
        ? diagnosticText(erpStatus, 80)
        : null,
    requestStarted: typeof started === "boolean" ? started : null,
    bodyFormat,
    bodyLength: typeof rawBody === "string" ? rawBody.length : null,
    failedChecks: [],
    serverReasons: [],
    responseShape: {
      envelope: valueShape(body),
      data: valueShape(data),
      dataError: valueShape(error),
      errorInfo: valueShape(errorInfo),
      envelopeError: valueShape(ownValue(body, "Error")),
      createdMaster: valueShape(result),
      dataSid: valueShape(ownValue(result, "data_sid")),
      boardNumber: valueShape(ownValue(result, "board_num")),
      title: valueShape(ownValue(result, "title_ctt")),
      ...(Array.isArray(errorInfo) ? { errorInfoCount: errorInfo.length } : {}),
    },
    serverErrors: {},
  };
  if (httpStatus !== 200) diagnostics.failedChecks.push("http_status_not_200");
  if (typeof rawBody !== "string")
    diagnostics.failedChecks.push("response_body_not_string");
  if (bodyFormat === "non_json")
    diagnostics.failedChecks.push("response_not_json");
  if (bodyFormat === "json") {
    if (erpStatus !== 200) diagnostics.failedChecks.push("erp_status_not_200");
    if (!emptyErrorObject(error))
      diagnostics.failedChecks.push("data_error_not_empty");
    const sid = ownValue(result, "data_sid");
    const boardNumber = ownValue(result, "board_num");
    if (typeof sid !== "string" || !sid)
      diagnostics.failedChecks.push("created_data_sid_invalid");
    if (!Number.isSafeInteger(boardNumber) || boardNumber < 1)
      diagnostics.failedChecks.push("created_board_number_invalid");
    if (typeof ownValue(result, "title_ctt") !== "string")
      diagnostics.failedChecks.push("created_title_missing");
  }
  const seen = new WeakSet<object>();
  let nodes = 0;
  let textBudget = 8192;
  const sanitize = (value: unknown, depth = 0): TimeLogDiagnosticValue => {
    if (++nodes > 180 || depth > 6 || textBudget <= 0) return "[TRUNCATED]";
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number")
      return Number.isFinite(value) ? value : String(value);
    if (typeof value === "string") {
      const safe = diagnosticText(value, Math.min(512, textBudget));
      textBudget -= safe.length;
      return safe;
    }
    if (typeof value !== "object") return OMITTED;
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result: TimeLogDiagnosticValue[] = [];
      for (let i = 0; i < Math.min(value.length, 12); i++)
        result.push(sanitize(ownValue(value, String(i)), depth + 1));
      if (value.length > 12) result.push("[TRUNCATED]");
      return result;
    }
    const result: { [key: string]: TimeLogDiagnosticValue } = {};
    let fields = 0;
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return OMITTED;
    }
    for (const key of keys.slice(0, 64)) {
      // Ignore opaque request/response/body/stack properties even when nested.
      if (!secretKey(key) && !exceptionFields.has(normalizedKey(key))) continue;
      if (++fields > 24) {
        result.truncated = true;
        break;
      }
      if (secretKey(key)) result.redactedCredentials = REDACTED;
      else if (/^[a-z_][a-z0-9_]*$/i.test(key))
        result[key] = sanitize(ownValue(value, key), depth + 1);
    }
    if (keys.length > 64) result.truncated = true;
    return result;
  };
  const addError = (key: string, value: unknown) => {
    if (value !== undefined) diagnostics.serverErrors[key] = sanitize(value);
  };
  addError("dataError", error);
  addError("envelopeError", ownValue(body, "Error"));
  addError("envelopeErrors", ownValue(body, "Errors"));
  addError("transportError", ownValue(response, "error"));
  // Preserve exception-shaped Data/top-level fields without copying the Data
  // object, which also carries returned models and unrelated business values.
  const addException = (key: string, value: unknown) => {
    const fields: { [key: string]: unknown } = {};
    for (const field of [
      "name",
      "Name",
      "message",
      "Message",
      "Title",
      "title",
      "status",
      "error_info",
    ])
      if (ownValue(value, field) !== undefined)
        fields[field] = ownValue(value, field);
    if (Object.keys(fields).length) addError(key, fields);
  };
  addException("dataException", data);
  addException("envelopeException", body);
  const reasons: string[] = [];
  const names: string[] = [];
  const labels: string[] = [];
  const collectReasons = (value: TimeLogDiagnosticValue) => {
    if (typeof value === "string") {
      if (value && !/^\[(?:REDACTED|OMITTED|CIRCULAR|TRUNCATED)\]$/.test(value))
        reasons.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collectReasons);
    } else if (value && typeof value === "object") {
      // Detailed validation errors are more useful than the common wrapper.
      for (const [key, child] of Object.entries(value))
        if (
          [
            "errorinfo",
            "error",
            "errors",
            "cause",
            "details",
            "detail",
          ].includes(normalizedKey(key))
        )
          collectReasons(child);
      for (const [key, child] of Object.entries(value)) {
        if (
          [
            "message",
            "errormessage",
            "title",
            "reason",
            "description",
          ].includes(normalizedKey(key))
        )
          collectReasons(child);
        else if (normalizedKey(key) === "name" && typeof child === "string")
          names.push(child);
        else if (normalizedKey(key) === "displayname") {
          const attributes = value.attr_ids;
          const required =
            Array.isArray(attributes) &&
            attributes.some(
              (attribute) =>
                attribute === "condition_not_null" || attribute === "not_null",
            );
          const prefix = required ? "필수값 누락" : "항목";
          if (typeof child === "string" && child)
            labels.push(`${prefix}: ${child}`);
          else if (
            child &&
            typeof child === "object" &&
            !Array.isArray(child)
          ) {
            const parts = Object.entries(child)
              .filter(
                ([key, value]) =>
                  ["itemname", "bizzname", "itemsetgroupnm"].includes(
                    normalizedKey(key),
                  ) &&
                  typeof value === "string" &&
                  value,
              )
              .map(([, value]) => value);
            if (parts.length) labels.push(`${prefix}: ${parts.join(" / ")}`);
          }
        }
      }
    }
  };
  Object.values(diagnostics.serverErrors).forEach(collectReasons);
  diagnostics.serverReasons = [
    ...new Set(reasons.length ? reasons : labels.length ? labels : names),
  ]
    .slice(0, 3)
    .map((reason) => diagnosticText(reason, 240));
  return diagnostics;
}

function responseFailure(
  response: unknown,
  code: string,
  message: string,
  submitted: boolean,
  body?: unknown,
): TimeLogSubmissionError {
  const diagnostics = buildTimeLogResponseDiagnostics(response, code, body);
  const statuses = `HTTP ${diagnostics.httpStatus ?? "확인 불가"}, ERP ${
    diagnostics.erpStatus ?? "확인 불가"
  }`;
  const reason = diagnostics.serverReasons.length
    ? `서버: ${diagnostics.serverReasons.slice(0, 2).join(" / ")}`
    : `응답 확인: ${
        diagnostics.failedChecks.join(", ") || diagnostics.failureCode
      }`;
  return new TimeLogSubmissionError(
    code,
    `${message} (${statuses}; ${reason})`,
    submitted,
    diagnostics,
  );
}

/** Validate both transport and application success before recording a receipt. */
export function parseTimeLogCreateResponse(
  response: any,
): TimeLogCreatedResult {
  if (response?.error) {
    const submitted = response.requestStarted !== false;
    throw responseFailure(
      response,
      typeof response.error === "string"
        ? diagnosticText(response.error, 80)
        : "browser_response_error",
      submitted
        ? "시간 로그 전송 결과를 확인할 수 없습니다. ERP에서 확인 후 다시 입력하세요."
        : "ERP 탭의 로그인 세션 또는 회사가 변경되어 전송하지 않았습니다.",
      submitted,
    );
  }
  if (response?.status !== 200 || typeof response.body !== "string")
    throw responseFailure(
      response,
      "http_response_invalid",
      "시간 로그 응답이 정상 HTTP 200이 아닙니다. 저장 여부를 ERP에서 확인하세요.",
      true,
    );
  let body: any;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw responseFailure(
      response,
      "json_response_required",
      "JSON 응답을 해석할 수 없습니다. Keypack 또는 로그인 응답인지 확인하고 ERP에서 저장 여부를 확인하세요.",
      true,
    );
  }
  const error = body?.Data?.error;
  const emptyError = emptyErrorObject(error);
  const result = body?.Data?.slip_created_result?.boardXmaster?.data;
  if (
    body?.Status !== 200 ||
    !emptyError ||
    typeof result?.data_sid !== "string" ||
    !result.data_sid ||
    !Number.isSafeInteger(result.board_num) ||
    result.board_num < 1 ||
    typeof result.title_ctt !== "string"
  )
    throw responseFailure(
      response,
      "create_response_invalid",
      "시간 로그 생성 성공을 확인할 수 없습니다. 저장 여부를 ERP에서 확인하세요.",
      true,
      body,
    );
  return {
    dataSid: result.data_sid,
    boardNumber: result.board_num,
    title: result.title_ctt,
  };
}

/**
 * Called only by the explicit manual submit command. Discovery attaches to an
 * existing Chrome; it never opens a tab, logs in, navigates, or retries a POST.
 */
interface TimeLogConnectedBrowser {
  identity: { tenantSid: string; loginUserSid: string; origin: string };
  read(path: string, payload: unknown): Promise<any>;
  write(payload: TimeLogPayload): Promise<any>;
}

async function withTimeLogBrowser<T>(
  request: TimeLogSubmitRequest,
  dependencies: TimeLogTransportDependencies | undefined,
  operation: (connected: TimeLogConnectedBrowser) => Promise<T>,
): Promise<T> {
  const tenantSid = expectedTenant(request.payload);
  try {
    await request.assertCurrent?.();
  } catch (error) {
    if (error instanceof TimeLogSubmissionError) throw error;
    throw new TimeLogSubmissionError(
      "browser_prepare_failed",
      "원본 세션 확인 중 중단되어 시간 로그를 전송하지 않았습니다.",
      false,
    );
  }
  const getConfig = dependencies?.readConfig || readConfig;
  const config = getConfig();
  const getConnection =
    dependencies?.readConnection || readContextGraphConnection;
  const getPinnedPage = dependencies?.resolvePinnedPage || resolvePinnedPage;
  let connection: ContextGraphConnection;
  try {
    connection = await getConnection(request.sessionId, config);
  } catch (error: any) {
    throw new TimeLogSubmissionError(
      error?.code || "context_connection_invalid",
      error instanceof Error
        ? error.message
        : "ContextGraph 연결 상태를 확인할 수 없습니다.",
    );
  }
  const browsers = config?.browsers || [{ provider: "chrome" }];
  if (!Array.isArray(browsers) || !browsers.length)
    throw new TimeLogSubmissionError(
      "browser_config_invalid",
      "기존 Chrome 브라우저 설정이 필요합니다.",
    );
  // Only the Chrome process saved by ContextGraph may be attached.
  const configured = browsers.find(
    (browser: any) =>
      browser?.provider === "chrome" &&
      (browser.id || "default") === connection.browserId &&
      pathKey(registryRoot(browser.registry)) === pathKey(connection.registry),
  );
  if (!configured)
    throw new TimeLogSubmissionError(
      "chrome_required",
      "저장된 ContextGraph 탭과 같은 Chrome 연결 설정이 필요합니다.",
    );
  const specs: BrowserSpec[] = [
    {
      id: connection.browserId,
      registry: connection.registry,
      sessionId: request.sessionId,
      endpoint: connection.endpoint,
      reuseExisting: true,
      managedProfile: false,
      attachOnly: true,
    },
  ];
  const pool = await (
    dependencies?.createPool ||
    ((specs: BrowserSpec[]) => new BrowserPool(specs))
  )(specs);
  let sending = false;
  const assertBinding = async () => {
    const current = await getConnection(request.sessionId, getConfig());
    if (current.bindingId !== connection.bindingId)
      throw new TimeLogSubmissionError(
        "context_pin_changed",
        "확인 중 ContextGraph 연결 탭이 변경되어 시간 로그를 전송하지 않았습니다.",
      );
  };
  try {
    const candidates = await pool.discover();
    await request.assertCurrent?.();
    const connectedBrowser = candidates.find(
      (entry) => entry.browser.id === connection.browserId,
    )?.browser;
    if (!connectedBrowser)
      throw new TimeLogSubmissionError(
        "context_target_missing",
        "ContextGraph 연결 브라우저에 로그인된 ERP 탭이 없습니다. /ec-connect로 다시 연결하세요.",
      );
    const pageId = await getPinnedPage(connectedBrowser, connection);
    const candidate = candidates.find(
      (entry) => entry.browser === connectedBrowser && entry.page.id === pageId,
    );
    if (!candidate)
      throw new TimeLogSubmissionError(
        "context_target_missing",
        "ContextGraph 연결 탭이 닫혔거나 로그인된 ERP 화면이 아닙니다. /ec-connect로 다시 연결하세요.",
      );
    const { browser, page } = candidate;
    const listedURL = targetURL(page.url);
    if (!listedURL)
      throw new TimeLogSubmissionError(
        "context_target_invalid",
        "ContextGraph 연결 탭이 이카운트 ERP 화면이 아닙니다.",
      );
    await browser.select(page.id);
    await request.assertCurrent?.();
    const inspected = await browser.evaluate(INSPECT_SCRIPT);
    const currentURL = targetURL(inspected?.url);
    if (
      !currentURL ||
      currentURL.origin !== listedURL.origin ||
      currentURL.searchParams.get("ec_req_sid") !==
        listedURL.searchParams.get("ec_req_sid")
    )
      throw new TimeLogSubmissionError(
        "session_changed",
        "탭 탐색 후 ERP 로그인 세션이 변경되어 전송하지 않았습니다.",
      );
    if (typeof inspected.error === "string")
      throw new TimeLogSubmissionError(
        inspected.error,
        "ERP 연결의 로그인 또는 회사 정보를 확인할 수 없어 전송하지 않았습니다.",
      );
    if (typeof inspected.tenantSid !== "string" || !inspected.tenantSid.trim())
      throw new TimeLogSubmissionError(
        "tenant_unavailable",
        "ERP 탭의 회사 정보를 확인할 수 없어 전송하지 않았습니다. ContextGraph에 연결한 ERP 화면을 확인하세요.",
      );
    if (inspected.tenantSid !== tenantSid)
      throw new TimeLogSubmissionError(
        "tenant_changed",
        "ERP 탭의 회사와 시간 로그 회사가 달라 전송하지 않았습니다.",
      );
    const run = async (path: string, payload: unknown, write = false) => {
      // Re-select because another Pi operation can select a different tab.
      await assertBinding();
      await browser.select(await getPinnedPage(browser, connection));
      await request.assertCurrent?.();
      await assertBinding();
      const input = {
        origin: currentURL.origin,
        sid: currentURL.searchParams.get("ec_req_sid")!,
        tenantSid,
        ...(inspected.loginUserSid
          ? { loginUserSid: inspected.loginUserSid }
          : {}),
        body: JSON.stringify(payload),
        action: (payload as TimeLogPayload)?.action_mode,
      };
      const script = write
        ? buildTimeLogSubmitScript(input)
        : buildTimeLogReadScript(input, path);
      if (write) sending = true;
      return browser.evaluate(script);
    };
    return await operation({
      identity: {
        tenantSid,
        loginUserSid: inspected.loginUserSid || "",
        origin: currentURL.origin,
      },
      read: (path, payload) => run(path, payload),
      write: (payload) => run("", payload, true),
    });
  } catch (error) {
    if (error instanceof TimeLogSubmissionError) throw error;
    if (!sending && error instanceof Error && "code" in error)
      throw new TimeLogSubmissionError(
        String(error.code),
        error.message,
        false,
      );
    throw new TimeLogSubmissionError(
      sending ? "submission_result_unknown" : "browser_prepare_failed",
      sending
        ? "시간 로그 전송 결과가 불명확합니다. ERP에서 저장 여부를 확인하세요."
        : `시간로그 조회 또는 ERP 탭 준비 중 중단되어 전송하지 않았습니다.${
            error instanceof Error
              ? " " + diagnosticText(error.message, 360)
              : ""
          }`,
      sending,
    );
  } finally {
    // Disconnecting CDP must not replace a confirmed receipt or send error.
    await pool.close().catch(() => {});
  }
}

async function inspectConnectedTimeLog(
  connected: TimeLogConnectedBrowser,
  payload: TimeLogPayload,
): Promise<TimeLogSavePlan> {
  if (!connected.identity.loginUserSid)
    throw new TimeLogSubmissionError(
      "user_unavailable",
      "기존 시간로그를 찾을 로그인 사용자 정보를 확인할 수 없습니다.",
    );
  const menuSid = parseTimeLogMenusResponse(
    await connected.read(TIME_LOG_MENUS_PATH, buildTimeLogMenusRequest()),
  );
  const template = parseTimeLogTemplateResponse(
    await connected.read(
      TIME_LOG_TEMPLATE_PATH,
      buildTimeLogTemplateRequest(menuSid),
    ),
  );
  const identity = parseTimeLogSearchResponse(
    await connected.read(
      TIME_LOG_SEARCH_PATH,
      buildTimeLogSearchRequest(
        payload,
        template,
        connected.identity.loginUserSid,
        1,
        menuSid,
      ),
    ),
    payload,
    connected.identity.loginUserSid,
  );
  if (!identity) return buildTimeLogSavePlan(payload, connected.identity);
  const modelData = parseTimeLogLoadResponse(
    await connected.read(
      TIME_LOG_LOAD_PATH,
      buildTimeLogLoadRequest(identity, payload),
    ),
    payload,
    identity,
    connected.identity.loginUserSid,
  );
  return buildTimeLogSavePlan(payload, connected.identity, {
    identity,
    modelData,
  });
}

/** Read fresh server state before the manual save confirmation; never writes. */
export async function inspectTimeLogDraft(
  request: TimeLogSubmitRequest,
  dependencies?: TimeLogTransportDependencies,
): Promise<TimeLogSavePlan> {
  return withTimeLogBrowser(request, dependencies, (connected) =>
    inspectConnectedTimeLog(connected, request.payload as TimeLogPayload),
  );
}

/** UPDATE returns result identities rather than CreateBoardAction's receipt. */
export function parseTimeLogModifyResponse(
  response: any,
  plan: TimeLogSavePlan,
): TimeLogCreatedResult {
  // Keep all HTTP/ERP/error handling and bounded redaction shared with NEW.
  if (
    response?.error ||
    response?.status !== 200 ||
    typeof response?.body !== "string"
  )
    return parseTimeLogCreateResponse(response);
  let packet: any;
  try {
    packet = JSON.parse(response.body);
  } catch {
    return parseTimeLogCreateResponse(response);
  }
  const master = plan.payload.data.model_data.boardXmaster[0]!;
  const result = packet?.Data?.result;
  if (
    plan.action !== "UPDATE" ||
    !plan.target ||
    packet.Status !== 200 ||
    !emptyErrorObject(packet?.Data?.error) ||
    packet.Error ||
    packet.Errors ||
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.bizz_sid !== plan.payload.bizz_sid ||
    result[0]?.menu_sid !== plan.payload.menu_sid ||
    result[0]?.data_sid !== plan.target.dataSid ||
    result[0]?.record_sid !== master["board_s$record_sid"]
  )
    throw responseFailure(
      response,
      "modify_response_invalid",
      "시간로그 수정 성공을 확인할 수 없습니다. ERP에서 저장 여부를 확인하세요.",
      true,
      packet,
    );
  return {
    dataSid: plan.target.dataSid,
    boardNumber: plan.target.boardNumber,
    title: plan.target.title,
  };
}

/** Re-read the approved operation and send exactly one create or modify POST. */
export async function sendTimeLogDraft(
  request: TimeLogSubmitRequest,
  dependencies?: TimeLogTransportDependencies,
): Promise<TimeLogCreatedResult> {
  return withTimeLogBrowser(request, dependencies, async (connected) => {
    if (!request.plan) {
      // Compatibility for direct low-level callers. The command always supplies
      // a reviewed plan and therefore always performs the fresh lookup below.
      return parseTimeLogCreateResponse(
        await connected.write(request.payload as TimeLogPayload),
      );
    }
    const current = await inspectConnectedTimeLog(
      connected,
      request.payload as TimeLogPayload,
    );
    if (
      current.action !== request.plan.action ||
      current.baselineHash !== request.plan.baselineHash ||
      current.scopeKey !== request.plan.scopeKey ||
      JSON.stringify(current.payload) !== JSON.stringify(request.plan.payload)
    )
      throw new TimeLogSubmissionError(
        "save_plan_changed",
        "확인한 시간로그가 변경되거나 삭제되었습니다. /time-log 날짜 명령으로 다시 확인하세요.",
      );
    const response = await connected.write(current.payload);
    return current.action === "UPDATE"
      ? parseTimeLogModifyResponse(response, current)
      : parseTimeLogCreateResponse(response);
  });
}
