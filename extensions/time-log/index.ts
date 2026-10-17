import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readJSON, piRoot } from "./src/state.ts";
import {
  buildTimeLogPreview,
  createTimeLogPreviewComponent,
  confirmTimeLogPreview,
} from "./src/draft/preview.ts";
import {
  collectTimeLogSessions,
  validateTimeLogSessionSources,
} from "./src/sessions/sessions.ts";
import {
  buildTimeLogPayload,
  defaultProfile,
  normalizeTimeLogDate,
  type TimeLogPayload,
  type TimeLogProfile,
} from "./src/erp/payload.ts";
import {
  summarizeTimeLogCollection,
  resolvedRemarksModel,
  REMARKS_POLICY_VERSION,
  type RemarksModelConfig,
} from "./src/draft/summarize.ts";
import {
  claimDraft,
  draftPath,
  finishDraft,
  hashValue,
  readDraft,
  releaseDraft,
  saveResponseDiagnostics,
  saveDraft,
  type DraftStatus,
  type TimeLogDraft,
} from "./src/draft/drafts.ts";
import type { TimeLogSavePlan } from "./src/erp/transport.ts";

const ENTRY = "time-log-draft";
const TARGET_MODE = "context-graph";
const CONNECTION_LABEL = "ContextGraph 연결 탭";
const INPUT_POLICY_VERSION = 4;
type Settings = {
  profile?: TimeLogProfile;
  contextDir?: string;
  remarksModel?: RemarksModelConfig;
};

export function koreaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function explicitDate(value: string): string {
  const date = normalizeTimeLogDate(value, "시간로그 일자");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export default function timeLog(
  pi: ExtensionAPI,
  services: {
    collectSessions?: typeof collectTimeLogSessions;
    summarize?: typeof summarizeTimeLogCollection;
    validateSources?: typeof validateTimeLogSessionSources;
    inspect?: (input: {
      sessionId: string;
      payload: TimeLogPayload;
      assertCurrent: () => Promise<void>;
    }) => Promise<TimeLogSavePlan>;
    submit?: (input: {
      sessionId: string;
      payload: TimeLogPayload;
      plan?: TimeLogSavePlan;
      assertCurrent: () => Promise<void>;
    }) => Promise<{ dataSid: string; boardNumber: number; title: string }>;
    root?: string;
    readConfig?: () => Settings;
    today?: () => string;
  } = {},
) {
  const root = services.root || join(piRoot, ".local", "time-log");
  const config =
    services.readConfig ||
    (() => readJSON(join(piRoot, "time-log.json"), {}) as Settings);
  const today = services.today || koreaDate;
  const collectSessions = services.collectSessions || collectTimeLogSessions;
  const summarize = services.summarize || summarizeTimeLogCollection;
  const validateSources =
    services.validateSources || validateTimeLogSessionSources;
  const inspect =
    services.inspect ||
    (async (input) => {
      const { inspectTimeLogDraft } = await import("./src/erp/transport.ts");
      return inspectTimeLogDraft(input);
    });
  const submit =
    services.submit ||
    (async (input) => {
      const { sendTimeLogDraft } = await import("./src/erp/transport.ts");
      return sendTimeLogDraft(input);
    });
  let busy = false;
  let stopped = false;
  let summaryController: AbortController | undefined;

  function contextConfig(settings = config()) {
    return {
      contextDir:
        settings.contextDir ||
        readJSON(join(piRoot, "ec-context.json"), {}).contextDir,
    };
  }
  function assertOwner(ctx: any, sessionId: string) {
    if (stopped || ctx.sessionManager.getSessionId() !== sessionId) {
      throw new Error(
        "현재 Pi 세션이 변경되었습니다. 원래 세션에서 초안을 확인하세요.",
      );
    }
  }
  function latestId(ctx: any): string | undefined {
    const entries = ctx.sessionManager.getBranch?.() || [];
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (
        entry.type === "custom" &&
        entry.customType === ENTRY &&
        entry.data?.sessionId === ctx.sessionManager.getSessionId()
      ) {
        return entry.data.id;
      }
    }
  }
  function load(ctx: any, id?: string): TimeLogDraft {
    id ||= latestId(ctx);
    if (!id)
      throw new Error(
        "시간로그 초안이 없습니다. 먼저 /time-log YYYY-MM-DD를 실행하세요.",
      );
    const draft = readDraft(root, ctx.sessionManager.getSessionId(), id);
    assertOwner(ctx, draft.sessionId);
    if (
      draft.scope !== "date" ||
      !draft.workDate ||
      !Array.isArray(draft.sources) ||
      !draft.sources.length
    ) {
      throw new Error(
        "날짜별 시간로그 초안이 아닙니다. /time-log YYYY-MM-DD로 다시 만드세요.",
      );
    }
    if (
      draft.inputPolicyVersion !== INPUT_POLICY_VERSION ||
      !draft.remarksGeneration ||
      draft.remarksGeneration.policyVersion !== REMARKS_POLICY_VERSION
    ) {
      throw new Error(
        `입력 기준이 변경된 초안입니다. /time-log ${draft.workDate}로 다시 만드세요.`,
      );
    }
    const settings = config();
    if (
      draft.host !== TARGET_MODE ||
      draft.profileHash !== hashValue(settings.profile || defaultProfile) ||
      (draft.remarksGeneration &&
        hashValue({
          provider: draft.remarksGeneration.provider,
          model: draft.remarksGeneration.model,
          reasoningEffort: draft.remarksGeneration.reasoningEffort,
        }) !== hashValue(resolvedRemarksModel(settings.remarksModel)))
    ) {
      throw new Error("시간로그 설정이 변경되었습니다. 초안을 다시 만드세요.");
    }
    return draft;
  }
  async function assertDraft(
    ctx: any,
    reviewed: TimeLogDraft,
    statuses: DraftStatus[],
    signal?: AbortSignal,
  ): Promise<TimeLogDraft> {
    signal?.throwIfAborted();
    assertOwner(ctx, reviewed.sessionId);
    const before = load(ctx, reviewed.id);
    if (
      before.reviewHash !== reviewed.reviewHash ||
      !statuses.includes(before.status)
    ) {
      throw new Error("확인한 시간로그 초안 또는 전송 상태가 변경되었습니다.");
    }
    await validateSources(
      ctx,
      before.workDate!,
      before.sources!,
      contextConfig(),
      signal,
    );
    signal?.throwIfAborted();
    assertOwner(ctx, reviewed.sessionId);
    const after = load(ctx, reviewed.id);
    if (
      after.reviewHash !== reviewed.reviewHash ||
      !statuses.includes(after.status)
    ) {
      throw new Error(
        "원본을 확인하는 동안 시간로그 초안 또는 전송 상태가 변경되었습니다.",
      );
    }
    return after;
  }
  async function prepare(
    ctx: any,
    requestedDate: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const sessionId = ctx.sessionManager.getSessionId();
    const settings = config();
    const date = explicitDate(requestedDate);
    let collection = await collectSessions(
      ctx,
      date,
      contextConfig(settings),
      signal,
    );
    assertOwner(ctx, sessionId);
    signal?.throwIfAborted();
    if (collection.date !== date)
      throw new Error("수집한 세션의 일자가 요청한 일자와 다릅니다.");
    const profile = settings.profile || defaultProfile;
    if (!collection.rows.length) {
      return {
        draftId: null,
        status: "empty" as const,
        preview: buildTimeLogPreview(collection, profile, CONNECTION_LABEL),
        rowCount: 0,
        payloadPath: null,
        saveCommand: null,
        networkRequests: 0,
        erpRequests: 0,
        modelRequests: 0,
      };
    }
    summaryController = new AbortController();
    const requestSignal = signal
      ? AbortSignal.any([signal, summaryController.signal])
      : summaryController.signal;
    let generated: Awaited<ReturnType<typeof summarizeTimeLogCollection>>;
    try {
      generated = await summarize(
        ctx,
        collection,
        settings.remarksModel,
        requestSignal,
        {
          onProgress: (completed, total) =>
            ctx.ui?.setStatus?.(
              "time-log-summary",
              `${
                resolvedRemarksModel(settings.remarksModel).model
              } low 비고 요약 ${completed}/${total}`,
            ),
        },
      );
    } finally {
      summaryController = undefined;
      ctx.ui?.setStatus?.("time-log-summary", undefined);
    }
    assertOwner(ctx, sessionId);
    requestSignal.throwIfAborted();
    collection = generated.collection;
    await validateSources(
      ctx,
      date,
      collection.rows.flatMap((row) => row.sources),
      contextConfig(settings),
      requestSignal,
    );
    assertOwner(ctx, sessionId);
    requestSignal.throwIfAborted();
    const summary = buildTimeLogPreview(collection, profile, CONNECTION_LABEL);
    const payload = buildTimeLogPayload({
      workDate: date,
      slipDate: date,
      profile,
      rows: collection.rows.map((row) => {
        if (!row.context.job)
          throw new Error("시간로그 행의 작업 연결을 확인할 수 없습니다.");
        if (!row.sources.length)
          throw new Error("시간로그 행에 원본 세션이 없습니다.");
        return {
          description: row.description,
          endDate: date,
          job: row.context.job,
          transaction: row.context.transaction,
        };
      }),
    });
    const draft = saveDraft(root, {
      sessionId,
      contextEntryId: null,
      entryKey: null,
      jobKey: null,
      scope: "date",
      workDate: date,
      inputPolicyVersion: INPUT_POLICY_VERSION,
      remarksGeneration: generated.generation,
      sources: collection.rows.flatMap((row) => row.sources),
      host: TARGET_MODE,
      profileHash: hashValue(profile),
      summary,
      payload,
    });
    pi.appendEntry(ENTRY, {
      id: draft.id,
      sessionId: draft.sessionId,
      scope: "date",
      workDate: date,
    });
    return {
      draftId: draft.id,
      status: draft.status,
      preview: summary,
      rowCount: collection.rows.length,
      payloadPath: draftPath(root, draft.sessionId, draft.id),
      saveCommand: `/time-log submit ${draft.id}`,
      networkRequests: generated.generation.modelCalls,
      erpRequests: 0,
      modelRequests: generated.generation.modelCalls,
    };
  }
  function show(value: string) {
    pi.sendMessage(
      { customType: "time-log-preview", content: value, display: true },
      { triggerTurn: false },
    );
  }
  async function submitReviewed(ctx: any, reviewed: TimeLogDraft) {
    if (!ctx.hasUI)
      throw new Error("시간로그 저장은 확인창이 있는 Pi 화면에서 실행하세요.");
    if (reviewed.status !== "draft")
      throw new Error(
        "이미 저장을 시도한 초안입니다. ERP에서 저장 여부를 확인하세요.",
      );
    await assertDraft(ctx, reviewed, ["draft"]);
    const plan = await inspect({
      sessionId: reviewed.sessionId,
      payload: reviewed.payload,
      assertCurrent: async () => {
        await assertDraft(ctx, reviewed, ["draft"]);
      },
    });
    await assertDraft(ctx, reviewed, ["draft"]);
    const operation =
      plan.action === "UPDATE"
        ? `저장 방식: 기존 게시글 수정\n대상: ${plan.target?.boardNumber} (${
            plan.target?.dataSid
          }) ${
            plan.target?.title || ""
          }\n최신 게시글의 수동 입력값과 연결이 다른 행은 보존합니다. 작업·업무·거래 연결이 같은 행은 이번 초안의 비고로 갱신합니다.`
        : "저장 방식: 신규 게시글 작성\n해당 일자와 담당자의 기존 시간로그가 없습니다.";
    const confirmed = await confirmTimeLogPreview(
      ctx,
      `${operation}\n\n${reviewed.summary}`,
    );
    if (!confirmed) return;
    const checked = await assertDraft(ctx, reviewed, ["draft"]);
    claimDraft(root, checked, plan.scopeKey);
    try {
      const result = await submit({
        sessionId: checked.sessionId,
        payload: checked.payload,
        plan,
        assertCurrent: async () => {
          try {
            await assertDraft(ctx, reviewed, ["submitting"]);
          } catch (error) {
            throw Object.assign(
              new Error(error instanceof Error ? error.message : String(error)),
              { submitted: false },
            );
          }
        },
      });
      finishDraft(root, checked, result);
      ctx.ui.notify(
        `시간로그 저장 완료: ${result.boardNumber} (${result.dataSid})`,
        "info",
      );
    } catch (error) {
      let diagnosticNotice = "";
      if (
        error &&
        typeof error === "object" &&
        "diagnostics" in error &&
        error.diagnostics
      ) {
        try {
          const path = saveResponseDiagnostics(
            root,
            checked,
            error.diagnostics as import("./src/erp/transport.ts").TimeLogResponseDiagnostics,
          );
          diagnosticNotice = `\n응답 진단: ${path}`;
        } catch {
          diagnosticNotice = "\n응답 진단 파일을 기록하지 못했습니다.";
        }
      }
      if (
        error &&
        typeof error === "object" &&
        "submitted" in error &&
        error.submitted === false
      ) {
        releaseDraft(root, checked);
        throw new Error(
          `${
            error instanceof Error ? error.message : String(error)
          }${diagnosticNotice}\n실제 저장 요청은 보내지 않았습니다. 조건을 확인한 뒤 같은 초안을 다시 저장할 수 있습니다.`,
        );
      }
      finishDraft(root, checked);
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }${diagnosticNotice}\n자동 재전송하지 않습니다. ERP에서 저장 여부를 먼저 확인하세요.`,
      );
    }
  }

  pi.registerMessageRenderer?.("time-log-preview", (message, _options, theme) =>
    createTimeLogPreviewComponent(
      typeof message.content === "string" ? message.content : "",
      theme,
    ),
  );

  pi.registerTool(
    defineTool({
      name: "time_log_draft",
      label: "날짜별 시간로그 초안",
      description:
        "Inspect local Pi sessions for a Korean calendar date and use a lightweight model to summarize closed issue conversations into confirmed work remarks. This tool calls the summary model but never an ERP API and does not show a save confirmation. Time remains empty, dates use the requested date, and category is 개발. The user reviews and saves with /time-log submit.",
      promptSnippet:
        "Create a daily time-log draft with model-written confirmed remarks including the problem investigated. Leave time empty; all dates use the requested day; category is 개발.",
      parameters: Type.Object(
        {
          date: Type.Optional(
            Type.String({
              description: "한국 일자 YYYY-MM-DD. 생략하면 한국의 오늘 날짜.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      async execute(_id, input, signal, _update, ctx) {
        if (busy) throw new Error("시간로그 작업이 진행 중입니다.");
        busy = true;
        try {
          const result = await prepare(ctx, input.date || today(), signal);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        } finally {
          busy = false;
        }
      },
    }),
  );

  pi.registerCommand("time-log", {
    description: "날짜별 Pi 세션 시간로그 미리보기 / 확인 후 저장",
    getArgumentCompletions(prefix) {
      const date = explicitDate(today());
      const day = Number(date.slice(8));
      const dates = Array.from(
        { length: day },
        (_, index) => date.slice(0, 8) + String(day - index).padStart(2, "0"),
      );
      const matches = dates
        .filter((value) => value.startsWith(prefix.trimStart()))
        .map((value) => ({ value, label: value }));
      return matches.length ? matches : null;
    },
    async handler(args, ctx) {
      if (busy) {
        ctx.ui.notify("시간로그 작업이 진행 중입니다.", "warning");
        return;
      }
      busy = true;
      try {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const action = tokens.shift() || "help";
        if (/^\d{4}-\d{2}-\d{2}$/.test(action) && !tokens.length) {
          const result = await prepare(ctx, action);
          show(
            result.preview +
              (result.draftId
                ? `\n\n초안 ID: ${result.draftId}\n본문: ${result.payloadPath}\n저장 명령: ${result.saveCommand}`
                : "\n\n입력할 행이 없습니다."),
          );
          if (result.draftId)
            await submitReviewed(ctx, load(ctx, result.draftId));
        } else if (action === "preview") {
          if (tokens.length > 1) throw new Error("/time-log preview [초안ID]");
          const draft = load(ctx, tokens[0]);
          show(
            `${draft.summary}\n\n상태: ${draft.status}\n초안 ID: ${
              draft.id
            }\n본문: ${draftPath(root, draft.sessionId, draft.id)}`,
          );
        } else if (action === "submit") {
          if (tokens.length !== 1) throw new Error("/time-log submit <초안ID>");
          const draft = load(ctx, tokens[0]);
          show(`${draft.summary}\n\n초안 ID: ${draft.id}`);
          await submitReviewed(ctx, draft);
        } else if (action === "help" && !tokens.length) {
          show(
            "/time-log YYYY-MM-DD\n/time-log preview [초안ID]\n/time-log submit <초안ID>\n지정한 한국 날짜의 로컬 Pi 세션을 모아 미리보기를 표시합니다. 확인창에서 승인하면 실제 저장합니다. 시간은 빈값, 종료 예정일은 입력한 날짜, 카테고리는 개발입니다.",
          );
        } else
          throw new Error(
            "/time-log YYYY-MM-DD | preview [초안ID] | submit <초안ID>",
          );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        busy = false;
      }
    },
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    summaryController?.abort();
  });
}
