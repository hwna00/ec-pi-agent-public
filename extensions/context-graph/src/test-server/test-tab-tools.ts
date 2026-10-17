import { isUtf8 } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { resultText } from "../browser/mcp.ts";
import {
  TestTab,
  type TestTabContext,
  type TestTabOptions,
} from "./test-tab.ts";

const supported = new Set([
  "list_network_requests",
  "get_network_request",
  "emulate",
]);
const secretKeys =
  "(?:ec_req_sid|sid|password|passwd|pwd|pass|(?:access|refresh|auth|id)[_-]?token|token|authorization|proxy-authorization|cookie|set-cookie|(?:x[-_])?api[-_]?key|client[-_]?secret)";
const secretKey = new RegExp(`^${secretKeys}$`, "i");

/** Apply before returning network evidence to Pi or writing text body exports. */
export function redactNetworkText(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object")
      return JSON.stringify(redactData(parsed));
  } catch {}
  return redactPlainText(
    value.replace(
      /(### (?:Request|Response) Body\r?\n)([\s\S]*?)(?=\r?\n### |$)/g,
      (_match, prefix, body) => `${prefix}${redactNetworkText(body)}`,
    ),
  );
}
function redactPlainText(value: string): string {
  return value
    .replace(
      /^\s*(?:-\s*)?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|auth[-_]?token)\s*:.*$/gim,
      (line) => `${line.slice(0, line.indexOf(":"))}:[REDACTED]`,
    )
    .replace(
      new RegExp(`("${secretKeys}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*(?:"|$)`, "gi"),
      '$1"[REDACTED]"',
    )
    .replace(
      new RegExp(`('${secretKeys}'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*(?:'|$)`, "gi"),
      "$1'[REDACTED]'",
    )
    .replace(
      new RegExp(`((?:^|[?&;\\s])${secretKeys}=)[^&;\\s"'<>#\\]]*`, "gim"),
      "$1[REDACTED]",
    );
}
function redactData(value: any): any {
  if (typeof value === "string") return redactNetworkText(value);
  if (Array.isArray(value)) return value.map(redactData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : redactData(item),
      ]),
    );
  return value;
}
export type TestTabRequest = {
  action: "list" | "describe" | "call";
  tool?: string;
  args?: Record<string, unknown>;
};
type RequestRow = {
  requestId: string;
  method: string;
  url: string;
  status: string;
};
export type TestTabResult = {
  text: string;
  captureId?: string;
  tools?: { name: string; description: string }[];
  tool?: { name: string; description: string; inputSchema: any };
  requests?: RequestRow[];
  data?: any;
  files?: Record<string, string>;
};
type ExecuteOptions = { cwd?: string; signal?: AbortSignal };
const validator = new AjvJsonSchemaValidator();
const validators = new Map<string, ReturnType<typeof validator.getValidator>>();

function proxyTool(tool: any) {
  const inputSchema = structuredClone(tool.inputSchema);
  delete inputSchema.$schema;
  delete inputSchema.properties.pageId;
  inputSchema.required = (inputSchema.required || []).filter(
    (name) => name !== "pageId",
  );
  inputSchema.additionalProperties = false;
  if (tool.name === "get_network_request") {
    inputSchema.properties.reqid = {
      type: "string",
      pattern: "^[a-f0-9]{16}:[0-9]+$",
      description:
        "현재 목록의 requestId. 재연결 전 ID나 숫자 reqid는 사용할 수 없습니다.",
    };
    if (!inputSchema.required.includes("reqid"))
      inputSchema.required.push("reqid");
  }
  return {
    name: tool.name,
    description: tool.description || tool.name,
    inputSchema,
  };
}
function issuedRequests(tab: TestTabContext): Set<number> {
  if (!tab.state.has("networkRequests"))
    tab.state.set("networkRequests", new Set<number>());
  return tab.state.get("networkRequests") as Set<number>;
}
function requestHandle(tab: TestTabContext, value: unknown): string {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("MCP 요청 ID 형식을 확인할 수 없습니다.");
  issuedRequests(tab).add(id);
  return `${tab.captureId}:${id}`;
}
function requestNumber(tab: TestTabContext, value: unknown): number {
  const match =
    typeof value === "string" && /^([a-f0-9]{16}):(\d+)$/.exec(value);
  const id = match ? Number(match[2]) : NaN;
  if (!match || match[1] !== tab.captureId || !issuedRequests(tab).has(id))
    throw new Error(
      "이전 연결 또는 다른 탭의 요청 ID입니다. /list-network의 현재 목록에서 다시 선택하세요.",
    );
  return id;
}
function parseRows(result: any): any[] {
  return (
    result.structuredContent?.networkRequests ||
    resultText(result)
      .split("\n")
      .flatMap((line) => {
        const match = /^reqid=(\d+)\s+(\S+)\s+(.+?)\s+\[([^\]]+)\]/.exec(line);
        return match
          ? [
              {
                requestId: Number(match[1]),
                method: match[2],
                url: match[3],
                status: match[4],
              },
            ]
          : [];
      })
  );
}
function validateArgs(
  tool: ReturnType<typeof proxyTool>,
  args: Record<string, unknown>,
) {
  const key = JSON.stringify(tool.inputSchema);
  let validate = validators.get(key);
  if (!validate) {
    validate = validator.getValidator(tool.inputSchema);
    validators.set(key, validate);
  }
  const result = validate(args);
  if (!result.valid)
    throw new Error(
      `${tool.name} 인수가 올바르지 않습니다: ${result.errorMessage}`,
    );
  if (
    tool.name === "emulate" &&
    typeof args.extraHttpHeaders === "string" &&
    args.extraHttpHeaders !== ""
  ) {
    let headers;
    try {
      headers = JSON.parse(args.extraHttpHeaders);
    } catch {
      throw new Error(
        "extraHttpHeaders에는 HTTP 헤더의 JSON 객체 문자열을 입력하세요.",
      );
    }
    if (
      !headers ||
      typeof headers !== "object" ||
      Array.isArray(headers) ||
      Object.values(headers).some((value) => typeof value !== "string")
    )
      throw new Error(
        "extraHttpHeaders에는 문자열 값을 가진 HTTP 헤더 JSON 객체를 입력하세요.",
      );
  }
}

/** One dispatcher shared by the agent tool, generic command and shortcuts. */
export class TestTabTools {
  private tabs: TestTab;
  constructor(options: TestTabOptions = {}) {
    this.tabs = new TestTab(options);
  }
  begin(sessionId: string) {
    return this.tabs.begin(sessionId);
  }
  bind(sessionId: string, browser: any, bindingId: string) {
    return this.tabs.bind(sessionId, browser, bindingId);
  }
  close() {
    return this.tabs.close();
  }
  read(
    sessionId: string,
    config: any,
    requestId?: string,
  ): Promise<TestTabResult> {
    return this.execute(sessionId, config, {
      action: "call",
      tool: requestId ? "get_network_request" : "list_network_requests",
      args: requestId
        ? { reqid: requestId }
        : { includePreservedRequests: true },
    });
  }
  async execute(
    sessionId: string,
    config: any,
    request: TestTabRequest,
    options: ExecuteOptions = {},
  ): Promise<TestTabResult> {
    options.signal?.throwIfAborted();
    if (!request || !["list", "describe", "call"].includes(request.action))
      throw new Error("action은 list, describe, call 중 하나여야 합니다.");
    if (
      request.action !== "list" &&
      (!request.tool || !supported.has(request.tool))
    )
      throw new Error(
        "지원 도구: list_network_requests, get_network_request, emulate",
      );
    if (
      (request.action === "list" &&
        (request.tool !== undefined || request.args !== undefined)) ||
      (request.action === "describe" && request.args !== undefined)
    )
      throw new Error(
        "list에는 tool/args를, describe에는 args를 전달하지 마세요.",
      );
    try {
      return await this.tabs.run(sessionId, config, async (tab) => {
        options.signal?.throwIfAborted();
        const available = tab.tools.filter(
          (tool) =>
            supported.has(tool.name) && tool.inputSchema?.properties?.pageId,
        );
        if (request.action === "list") {
          const tools = available.map((tool) => ({
            name: tool.name,
            description: tool.description || tool.name,
          }));
          return {
            tools,
            text: `현재 테스트 탭에서 지원하는 MCP 도구 ${tools.length}개\n\n${tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n")}\n\n인수 확인: /test-tab describe <도구명>`,
          };
        }
        const actual = available.find((tool) => tool.name === request.tool);
        if (!actual)
          throw new Error(
            "현재 MCP 연결에서 해당 도구 또는 탭 지정 기능을 지원하지 않습니다.",
          );
        const tool = proxyTool(actual);
        if (request.action === "describe")
          return { tool, text: JSON.stringify(tool, null, 2) };
        const args = request.args === undefined ? {} : request.args;
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error("args는 JSON 객체여야 합니다.");
        validateArgs(tool, args);
        const params = structuredClone(args);
        if (tool.name === "get_network_request")
          params.reqid = requestNumber(tab, args.reqid);
        options.signal?.throwIfAborted();
        if (tool.name === "get_network_request")
          return this.detail(tab, params, String(args.reqid), options);
        const result = await tab.call(tool.name, params);
        options.signal?.throwIfAborted();
        if (result.isError)
          throw new Error(`MCP 조회 실패: ${resultText(result)}`);
        if (tool.name === "emulate")
          return {
            captureId: tab.captureId,
            text:
              redactNetworkText(resultText(result)) ||
              "테스트 탭의 에뮬레이션 설정을 적용했습니다.",
            data: redactData(result.structuredContent || {}),
          };
        const rows = parseRows(result);
        const displayed = args.pageSize === undefined ? rows.slice(-100) : rows;
        const requests = displayed.map((row) => ({
          requestId: requestHandle(tab, row.requestId),
          method: row.method,
          url: redactNetworkText(row.url),
          status: row.status,
        }));
        return {
          captureId: tab.captureId,
          requests,
          data: { pagination: result.structuredContent?.pagination },
          text: [
            `현재 Pi 세션의 /test-server 탭 · 응답 요청 ${rows.length}개 중 ${requests.length}개`,
            "MCP 연결이 유지되는 동안 수집한 기록입니다. 재연결 전 기록은 복원되지 않을 수 있습니다.",
            "",
            ...requests.map(
              (row) =>
                `${row.requestId} ${row.method} ${row.url} [${row.status}]`,
            ),
            requests.length
              ? "\n상세 조회: /list-network <위 요청ID>"
              : "수집된 요청이 없습니다. 테스트 탭에서 동작한 뒤 다시 조회하세요.",
          ].join("\n"),
        };
      });
    } catch (error) {
      throw new Error(
        redactNetworkText(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  private async detail(
    tab: TestTabContext,
    params: Record<string, unknown>,
    handle: string,
    options: ExecuteOptions,
  ): Promise<TestTabResult> {
    const files: Record<string, string> = {};
    const requested = ["requestFilePath", "responseFilePath"].filter(
      (key) => typeof params[key] === "string",
    );
    let temporary: string | undefined;
    try {
      if (requested.length) {
        temporary = await mkdtemp(join(tmpdir(), "pi-test-tab-body-"));
        for (const key of requested) {
          files[key] = resolve(
            options.cwd || process.cwd(),
            String(params[key]),
          );
          params[key] = join(
            temporary,
            key === "requestFilePath"
              ? "body.network-request"
              : "body.network-response",
          );
        }
        if (
          files.requestFilePath &&
          (process.platform === "win32"
            ? files.requestFilePath.toLowerCase() ===
              files.responseFilePath?.toLowerCase()
            : files.requestFilePath === files.responseFilePath)
        )
          throw new Error("요청과 응답 본문의 저장 경로를 다르게 지정하세요.");
      }
      const result = await tab.call("get_network_request", params);
      options.signal?.throwIfAborted();
      if (result.isError)
        throw new Error(`네트워크 상세 조회 실패: ${resultText(result)}`);
      const bodies = await Promise.all(
        requested.map(async (key) => {
          try {
            return { key, bytes: await readFile(String(params[key])) };
          } catch {
            throw new Error(
              "요청한 본문을 MCP에서 내보내지 못했습니다. 본문 보존 여부를 확인하세요.",
            );
          }
        }),
      );
      for (const { key, bytes } of bodies) {
        options.signal?.throwIfAborted();
        await mkdir(dirname(files[key]), { recursive: true });
        await writeFile(
          files[key],
          isUtf8(bytes) ? redactNetworkText(bytes.toString("utf8")) : bytes,
          { mode: 0o600 },
        );
      }
      let text = resultText(result);
      const data = structuredClone(result.structuredContent || {});
      for (const key of requested) {
        text = text.replaceAll(String(params[key]), files[key]);
        const bodyKey = key.replace("FilePath", "BodyFilePath");
        if (data.networkRequest?.[bodyKey])
          data.networkRequest[bodyKey] = files[key];
      }
      const replaceIds = (value: any): any => {
        if (Array.isArray(value)) return value.map(replaceIds);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              key === "requestId" && item !== undefined
                ? requestHandle(tab, item)
                : replaceIds(item),
            ]),
          );
        return value;
      };
      text = text.replace(
        /reqid=(\d+)/g,
        (_match, id) => `reqid=${requestHandle(tab, id)}`,
      );
      return {
        captureId: tab.captureId,
        files,
        text: `테스트 탭 요청 ${handle}\n\n${redactNetworkText(text)}`,
        data: redactData(replaceIds(data)),
      };
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}

export function parseTestTabCommand(value: string): TestTabRequest {
  const match = /^(tools|describe|call)(?:\s+([\s\S]*))?$/.exec(value.trim());
  if (!match)
    throw new Error(
      "/test-tab tools | describe <도구명> | call <도구명> [JSON 인수]",
    );
  if (match[1] === "tools") {
    if (match[2]) throw new Error("/test-tab tools");
    return { action: "list" };
  }
  const target = /^(\S+)(?:\s+([\s\S]*))?$/.exec(match[2] || "");
  if (!target || (match[1] === "describe" && target[2]))
    throw new Error("/test-tab describe <도구명> | call <도구명> [JSON 인수]");
  if (match[1] === "describe") return { action: "describe", tool: target[1] };
  let args: any = {};
  try {
    if (target[2]) args = JSON.parse(target[2]);
  } catch {
    throw new Error(
      '인수는 JSON 객체로 입력하세요. 예: {"resourceTypes":["fetch"]}',
    );
  }
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("인수는 JSON 객체여야 합니다.");
  return { action: "call", tool: target[1], args };
}
