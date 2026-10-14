import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserPool } from "../lib/ec-context/browser.ts";
import { piRoot, serverSpec } from "../lib/ec-context/mcp.ts";
import { runReader } from "../lib/ec-context/reader.ts";
import { ContextError } from "../lib/ec-context/graph.ts";
import {
  contextDirectory,
  contextSelection,
  contextPrompt,
  readJSON,
  privateJSON,
  parseReference,
  completeTarget,
  askSecret,
} from "../lib/ec-context/session.ts";
import { loginAccount, loginERP } from "../lib/ec-context/login.ts";
import { openTestServer } from "../lib/ec-context/test-server.ts";
import {
  chooseContext,
  applyContext,
  clearContext,
} from "../lib/ec-context/selection.ts";

export default function contextGraph(
  pi: ExtensionAPI,
  services = { BrowserPool, runReader, openTestServer },
) {
  let pool: any,
    browser: any,
    busy = false,
    stopped = false;
  let operations = new AbortController();
  const accountPath = join(piRoot, ".local", "ec-account.json");
  const config = () =>
    readJSON(
      process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
      {},
    );
  const getPool = (ctx: any) =>
    (pool ||= new services.BrowserPool(
      (config().browsers || [{ provider: "chrome" }]).map((s: any) =>
        serverSpec(s.provider, {
          ...s,
          sessionId: ctx.sessionManager.getSessionId(),
        }),
      ),
    ));
  const store = (ctx: any) => contextDirectory(ctx, config());
  const readStore = (ctx: any, args: string[], connected?: any) =>
    services.runReader(store(ctx), args, connected, {
      workspace: true,
      signal: operations.signal,
    });
  function selected(ctx: any) {
    const entry = contextSelection(ctx.sessionManager);
    if (!entry) throw new Error("먼저 /apply-context로 게시글을 선택하세요.");
    return entry;
  }
  async function connect(ctx: any, { edit = false, automatic = false } = {}) {
    if (automatic) browser = null;
    let account = readJSON(accountPath)?.account;
    if (edit) {
      account = await loginAccount(undefined, {
        input: (label: string, secret: boolean) =>
          secret ? askSecret(ctx.ui, label) : ctx.ui.input(label),
      });
      if (!account) return false;
      privateJSON(accountPath, { version: 1, account });
    }
    const candidates = await getPool(ctx).discover();
    if (!automatic && !candidates.length) {
      account = await loginAccount(account, {
        input: (label: string, secret: boolean) =>
          secret ? askSecret(ctx.ui, label) : ctx.ui.input(label),
      });
      if (!account) return false;
      privateJSON(accountPath, { version: 1, account });
      const loginBrowser = await getPool(ctx).openLogin();
      ctx.ui.notify(
        "자동 로그인 중입니다. 추가 인증이 표시되면 브라우저에서 완료하세요.",
        "info",
      );
      const page = await loginERP(loginBrowser, account, {
        signal: operations.signal,
      });
      candidates.push({
        browser: loginBrowser,
        page,
        label: `${loginBrowser.id} · 탭 ${page.id} · ${new URL(page.url).hostname}`,
      });
    }
    let candidate: any;
    if (automatic) {
      candidate = candidates.find(
        (c: any) => new URL(c.page.url).hostname === "logine.ecount.com",
      );
      if (!candidate)
        throw new Error(
          "logine.ecount.com의 로그인된 ERP 탭이 없어 수집을 중단했습니다.",
        );
    } else {
      const saved = candidates.filter(
        (c: any) => c.page.id === c.browser.savedPageId,
      );
      candidate = saved.length === 1 ? saved[0] : candidates[0];
      if (saved.length !== 1 && candidates.length > 1) {
        const labels = candidates.map(
          (c: any, i: number) => `${i + 1}. ${c.label}`,
        );
        const selected = await ctx.ui.select(
          "연결할 이카운트 탭 (브라우저 / 탭 / 호스트)",
          labels,
        );
        if (!selected) return false;
        candidate = candidates[labels.indexOf(selected)];
      }
    }
    await candidate.browser.connect(candidate.page);
    // URL alone is insufficient: test the authenticated read-only API.
    const check = await candidate.browser.fetch(
      "/ec5/api/app.common/action/GetBizzTypeSearchV5Action",
      {
        code_type_response: true,
        select_by_bizz_group: {
          target_bizz_group_sids: ["BG_00000C000044"],
          search_param: "",
        },
      },
    );
    let envelope: any;
    try {
      envelope = JSON.parse(check.body);
    } catch {
      throw new Error(
        "로그인 검증에 실패했습니다. ERP 로그인 후 다시 연결하세요.",
      );
    }
    if (
      check.status !== 200 ||
      envelope.Status !== 200 ||
      envelope.Error ||
      /IInvalidSessionException/.test(check.body)
    )
      throw new Error("ERP 세션이 만료되었거나 게시판 접근 권한이 없습니다.");
    browser = candidate.browser;
    ctx.ui.setStatus("ec-context", `EC: ${candidate.label}`);
    ctx.ui.notify(
      `연결 완료: ${candidate.label}. 인증 정보는 브라우저에서 관리합니다.`,
      "info",
    );
    return true;
  }
  function notifyCollectionFailures(result: any, entry: string, ctx: any) {
    const areas = [
      ...new Set<string>(
        [
          ...(result.failedWidgets || []).map(
            (widget: any) => `${widget.post} ${widget.label}`,
          ),
          ...(result.failedAttachments || []).map(
            (attachment: any) =>
              `${attachment.post} ${attachment.owner === "본문" ? "본문 첨부" : "답글 첨부"}`,
          ),
        ].map((area) => area.replace(/\s+/g, " ")),
      ),
    ];
    if (!areas.length) return;
    const summary =
      areas.slice(0, 3).join(", ") +
      (areas.length > 3 ? ` 외 ${areas.length - 3}개` : "");
    ctx.ui.notify(
      `일부 영역 수집 실패 (${summary}). /load-context ${entry}로 재수집하세요.`,
      "warning",
    );
  }
  function command(
    name: string,
    description: string,
    handler: (args: string, ctx: any) => Promise<void>,
  ) {
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        if (busy) {
          ctx.ui.notify("이카운트 작업이 진행 중입니다.", "warning");
          return;
        }
        busy = true;
        try {
          await handler(args, ctx);
        } catch (error) {
          if (!stopped)
            ctx.ui.notify(
              error instanceof ContextError && error.key
                ? `${error.key}: ${error.message}`
                : error instanceof Error
                  ? error.message
                  : String(error),
              "error",
            );
        } finally {
          busy = false;
        }
      },
    });
  }
  command(
    "ec-connect",
    "기존 ERP 연결 / 자동 로그인 (--edit: 계정 재입력)",
    async (args, ctx) => {
      if (args.trim() && args.trim() !== "--edit")
        throw new Error("/ec-connect [--edit]");
      browser = null;
      await connect(ctx, { edit: args.trim() === "--edit" });
    },
  );
  async function collect(args: string, ctx: any) {
    const sessionId = ctx.sessionManager.getSessionId();
    const leafId = ctx.sessionManager.getLeafId?.();
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const only = tokens[0] === "--only";
    if (only) tokens.shift();
    if (tokens.some((token) => token.startsWith("--")))
      throw new Error("/load-context [--only] type:number 또는 type number");
    let entry: string;
    try {
      entry = parseReference(tokens.join(" "));
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n/load-context [--only] type:number 또는 type number`,
      );
    }
    const connected = (await connect(ctx, { automatic: true }))
      ? browser
      : null;
    if (!connected) return;
    ctx.ui.notify(`${entry} 및 관련 게시글 수집 중…`, "info");
    const result = JSON.parse(
      await readStore(
        ctx,
        [
          ...(only ? ["--only"] : []),
          ...(config().maxNodes === undefined
            ? []
            : ["--max-nodes", String(config().maxNodes)]),
          ...(config().downloadAttachments === false ? ["--no-downloads"] : []),
          "collect",
          entry,
        ],
        connected,
      ),
    );
    if (stopped) return;
    ctx.ui.notify(
      `${entry}: ${result.nodes}개 게시글, ${result.edges}개 관계 저장 완료.\n${result.entryPath || result.context}`,
      "info",
    );
    notifyCollectionFailures(result, entry, ctx);
    if (result.attachments?.failed)
      ctx.ui.notify(
        `첨부 파일 ${result.attachments.failed}개 다운로드 실패. 게시글의 첨부 상태를 확인하세요.`,
        "warning",
      );
    if (
      ctx.sessionManager.getSessionId() !== sessionId ||
      ctx.sessionManager.getLeafId?.() !== leafId
    )
      return;
    applyContext(pi, ctx, result);
    ctx.ui.notify(`${entry}: 현재 세션에 적용 완료.`, "info");
  }
  command(
    "load-context",
    "관련 게시글 수집 후 적용 (--only: 상위 작업 제외, 예: --only tp:12345)",
    collect,
  );
  command(
    "apply-context",
    "저장된 맥락을 현재 세션에 적용 (번호 생략 시 선택, default: 해제)",
    async (args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const leafId = ctx.sessionManager.getLeafId?.();
      const value = args.trim();
      const context =
        value.toLowerCase() === "default"
          ? null
          : value
            ? JSON.parse(await readStore(ctx, ["apply", parseReference(value)]))
            : await chooseContext(ctx, (options) => readStore(ctx, options));
      if (
        stopped ||
        context === undefined ||
        ctx.sessionManager.getSessionId() !== sessionId ||
        ctx.sessionManager.getLeafId?.() !== leafId
      )
        return;
      if (context === null) {
        clearContext(pi, ctx);
        ctx.ui.notify("맥락을 해제했습니다.", "info");
      } else {
        applyContext(pi, ctx, context);
        ctx.ui.notify(`${context.entryKey}: 저장된 맥락 적용 완료.`, "info");
      }
    },
  );
  command(
    "test-server",
    "선택한 게시글의 테스트 계정으로 test / zeus / stage 열기",
    async (args, ctx) => {
      const entry = selected(ctx);
      const metadata = JSON.parse(
        await readStore(ctx, ["--entry", entry, "test-accounts"]),
      );
      const accountFile = join(
        store(ctx),
        ".context",
        "test-accounts",
        `${entry.replace(":", "-")}.json`,
      );
      const saved = readJSON(accountFile);
      const candidates = metadata.candidates || [];
      const sourceHash = createHash("sha256")
        .update(JSON.stringify(candidates))
        .digest("hex");
      let target = saved?.sourceHash === sourceHash ? saved.target : undefined;
      if (!target && candidates.length === 1) target = candidates[0];
      if (!target && candidates.length > 1) {
        const labels = candidates.map(
          (t: any, i: number) =>
            `${i + 1}. ${t.server} · ${t.company || "회사 미지정"} · ${t.user || "ID 미지정"}`,
        );
        const selected = await ctx.ui.select("테스트 서버 / 계정 선택", labels);
        if (!selected) return;
        target = candidates[labels.indexOf(selected)];
      }
      target = { ...target };
      const tokens = args.trim().split(/\s+/).filter(Boolean),
        edit = tokens.includes("--edit");
      const environment = tokens.filter((t: string) => t !== "--edit");
      if (
        environment.length > 1 ||
        (environment.length &&
          !["test", "zeus", "stage"].includes(environment[0]))
      )
        throw new Error("/test-server [test|zeus|stage] [--edit]");
      if (edit) target = {};
      if (environment.length) target.environment = environment[0];
      target = await completeTarget(target, {
        input: (label: string) =>
          label === "테스트 계정 비밀번호"
            ? askSecret(ctx.ui)
            : ctx.ui.input(label),
      });
      privateJSON(accountFile, { entryKey: entry, sourceHash, target });
      // Opening a test server must not replace the pinned ERP source tab.
      let connected = browser || getPool(ctx).browsers[0];
      if (!connected) {
        await getPool(ctx).discover();
        connected = getPool(ctx).browsers[0];
      }
      if (!connected) connected = await getPool(ctx).openLogin();
      const result = await (services.openTestServer || openTestServer)(
        connected,
        target,
      );
      ctx.ui.notify(
        `테스트 서버 로그인 확인: ${result.environment} / ${result.server} (__disableMin=Y)`,
        "info",
      );
    },
  );
  pi.on("before_agent_start", async (event, ctx) => {
    const entry = contextSelection(ctx.sessionManager);
    if (!entry) return;
    try {
      const description = JSON.parse(
        await readStore(ctx, ["--entry", entry, "describe"]),
      );
      return {
        systemPrompt: `${event.systemPrompt}\n\n${contextPrompt(description, ctx.cwd)}`,
      };
    } catch (error) {
      ctx.ui.notify(
        `${entry}의 저장된 맥락을 읽지 못했습니다. /load-context ${entry}로 다시 수집하고 적용하세요.`,
        "warning",
      );
      throw error;
    }
  });
  pi.on("session_start", async () => {
    stopped = false;
    if (operations.signal.aborted) operations = new AbortController();
  });
  pi.on("session_shutdown", async () => {
    stopped = true;
    operations.abort();
    browser = null;
    await pool?.close();
    pool = null;
  });
}
