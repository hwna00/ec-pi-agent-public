import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { controlDebug } from "./client.ts";
import { readConnection } from "../shared/connection.ts";

export function registerDebugCommands(pi: ExtensionAPI) {

  pi.registerCommand("run-and-debug", {
    description: "Run the ERP compound: /run-and-debug",
    async handler(_args, ctx) {
      try {
        const result = await controlDebug(readConnection(ctx.cwd), {
          action: "start",
          compound: "Run & Debug [ERP]",
          workspacePath: "D:/ecxsolution/ecount.nextv56/ecount.solution",
        });
        const run = result.run;
        if (!run) throw new Error("VS Code가 실행 결과를 반환하지 않았습니다.");
        ctx.ui.notify(run.status === "failed"
          ? `실행 실패: ${run.error ?? run.compound} (runId: ${run.runId}). /stop-debug로 남은 세션을 중단할 수 있습니다.`
          : `${run.compound}: ${run.status} (runId: ${run.runId})`, run.status === "failed" ? "error" : "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const uncertain = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        ctx.ui.notify(uncertain ? `${message}\n시간 초과·취소 시 실행이 진행됐을 수 있으므로 /stop-debug에서 상태를 확인하세요.` : message, "error");
      }
    },
  });

  pi.registerCommand("stop-debug", {
    description: "Stop a bridge-managed debug run: /stop-debug [runId]",
    async handler(args, ctx) {
      try {
        const connection = readConnection(ctx.cwd);
        const listed = await controlDebug(connection, { action: "list" });
        const runId = args.trim();
        const candidates = listed.runs.filter(r => runId ? r.runId === runId : r.status !== "stopped");
        if (!candidates.length) {
          ctx.ui.notify(runId ? `runId를 찾을 수 없습니다: ${runId}` : "이 브리지에서 중단할 실행이 없습니다.", "warning");
          return;
        }
        let target = runId ? candidates[0] : undefined;
        if (!target) {
          if (!ctx.hasUI) throw new Error("/stop-debug <runId>로 중단할 실행을 지정하세요.");
          const options = candidates.map(r => `${r.compound} (${r.workspacePath}) [${r.status}] ${r.runId}`);
          const selected = await ctx.ui.select("중단할 VS Code 실행", options);
          if (selected === undefined) return;
          target = candidates[options.indexOf(selected)];
        }
        if (!target) return;
        await controlDebug(connection, { action: "stop", runId: target.runId });
        ctx.ui.notify(`${target.compound} 중단 완료`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
