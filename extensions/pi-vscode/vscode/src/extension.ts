import * as vscode from "vscode";
import { findConnectionFile, readConnection } from "../../shared/connection.ts";
import { DebugConsoleStore } from "../../shared/store.ts";
import { startServer } from "./server.ts";
import { createTracker, logicalSession } from "./tracker.ts";
import { createDebugControl } from "./debug.ts";

export async function activate(context: vscode.ExtensionContext): Promise<{ url: string; token: string } | undefined> {
  const folder = vscode.workspace.workspaceFolders?.find(f => findConnectionFile(f.uri.fsPath));
  // 연결 설정이 없는 다른 프로젝트 창에서는 브리지를 열지 않는다.
  if (!folder) {
    context.subscriptions.push(vscode.commands.registerCommand("pi-vscode.copyConnection", () => {
      void vscode.window.showErrorMessage("프로젝트의 .pi/.local/pi-vscode.json 연결 설정이 없습니다.");
    }));
    return undefined;
  }
  // 서버를 열기 전에 디버그 출력 수집을 시작한다.
  const store = new DebugConsoleStore();
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      return createTracker(store, session);
    },
  });
  context.subscriptions.push(tracker);
  const control = createDebugControl(vscode);
  context.subscriptions.push(control);

  try {
    // Pi와 같은 로컬 설정 파일의 고정 주소와 토큰을 사용한다.
    const connection = readConnection(folder.uri.fsPath);
    const port = Number(new URL(connection.url).port);
    const token = connection.token;
    const bridge = await startServer(port, token, (query) => {
      const active = vscode.debug.activeDebugSession;
      const activeSessionId = active ? logicalSession(active).id : undefined;

      return store.read(query, activeSessionId);
    }, control.execute);
    context.subscriptions.push({ dispose: bridge.close });

    // 사용자가 복사 명령을 실행할 때만 주소와 토큰을 클립보드에 넣는다.
    const copyConnection = vscode.commands.registerCommand("pi-vscode.copyConnection", async () => {
      await vscode.env.clipboard.writeText(JSON.stringify(connection, null, 2));
      void vscode.window.showInformationMessage("Pi VS Code connection copied (includes secret token).");
    });
    context.subscriptions.push(copyConnection);

    bridge.server.on("error", (error) => {
      void vscode.window.showErrorMessage(`Pi VS Code bridge error: ${error.message}`);
    });

    return connection;
  } catch (error) {
    // 연결 준비에 실패하면 수집을 멈추고 실패 이유를 알린다.
    tracker.dispose();
    control.dispose();

    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Pi VS Code failed to start: ${message}. Check .pi/.local/pi-vscode.json and whether another window of this project owns the port.`,
    );

    throw error;
  }
}
