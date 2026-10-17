import type * as vscode from "vscode";
import { DebugConsoleStore } from "../shared/store.ts";
import type { DebugConsoleSource } from "../shared/types.ts";

// 하나의 콘솔에 하위 디버그 세션이 여러 개 생길 수 있다. 맨 위 세션으로 묶는다.
export function logicalSession(session: vscode.DebugSession): vscode.DebugSession {
  while (session.parentSession) {
    session = session.parentSession;
  }

  return session;
}

function sourceOf(body: Record<string, any>): DebugConsoleSource | undefined {
  // 디버거가 알려준 출력 위치만 담는다.
  const source: DebugConsoleSource = {};

  if (body.source?.name !== undefined) source.name = body.source.name;
  if (body.source?.path !== undefined) source.path = body.source.path;
  if (body.source?.sourceReference !== undefined) source.sourceReference = body.source.sourceReference;

  if (body.line !== undefined) source.line = body.line;
  if (body.column !== undefined) source.column = body.column;

  return Object.keys(source).length > 0 ? source : undefined;
}

export function createTracker(store: DebugConsoleStore, adapterSession: vscode.DebugSession): vscode.DebugAdapterTracker {
  // 같은 콘솔의 출력은 맨 위 세션에 모은다.
  const session = logicalSession(adapterSession);
  store.upsertSession({
    id: session.id,
    name: session.name,
    type: session.type,
    workspaceUri: session.workspaceFolder?.uri.toString(),
    active: true,
  });

  const replRequests = new Set<number>();

  // 출력과 평가 결과를 같은 모양으로 저장한다.
  function append(
    output: string,
    category: string,
    variablesReference?: number,
    source?: DebugConsoleSource,
  ): void {
    store.append({
      sessionId: session.id,
      sessionName: session.name,
      category,
      output,
      variablesReference: (variablesReference ?? 0) > 0 ? variablesReference : undefined,
      source,
    });
  }

  return {
    onWillReceiveMessage(message) {
      // 콘솔에 직접 입력한 식의 요청 번호만 기억한다. Watch와 Hover 요청은 건너뛴다.
      if (message.type !== "request" || message.command !== "evaluate") return;
      if (message.arguments?.context !== "repl") return;

      replRequests.add(message.seq);
    },

    onDidSendMessage(message) {
      // 프로그램이 보낸 출력 메시지를 저장한다. 통계용 telemetry 메시지는 건너뛴다.
      if (message.type === "event" && message.event === "output") {
        const body = message.body;
        if (!body || typeof body.output !== "string" || body.category === "telemetry") return;

        append(body.output, body.category ?? "console", body.variablesReference, sourceOf(body));

        return;
      }

      // 기억한 요청의 결과만 저장한다. 번호를 지워 같은 응답이 두 번 쌓이지 않게 한다.
      if (message.type !== "response" || message.command !== "evaluate") return;
      if (!replRequests.delete(message.request_seq)) return;

      const body = message.body;
      const result = message.success
        ? body?.result
        : message.message ?? body?.error?.format ?? "Evaluation failed";
      if (typeof result !== "string") return;

      append(result, message.success ? "repl" : "stderr", body?.variablesReference);
    },

    onWillStopSession() {
      // 끝난 어댑터의 대기 요청은 비운다. 맨 위 세션이 끝날 때만 콘솔을 종료 표시한다.
      replRequests.clear();
      if (adapterSession.id === session.id) {
        store.endSession(session.id);
      }
    },
  };
}
