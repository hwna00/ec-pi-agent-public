import type { DebugConsolePage } from "../shared/types.ts";

export function formatDebugConsole(page: DebugConsolePage): string {
  // 먼저 조회 개수와 선택한 디버그 세션을 알려준다.
  const lines = [
    `VS Code debug console: ${page.entries.length}/${page.requestedLimit} entries (oldest to newest).`,
    `Selected session: ${page.selectedSessionId ?? "none"}`,
  ];

  if (!page.entries.length) {
    lines.push("No captured output matches this page. To begin capturing, start or restart debugging after the companion activates.");
  }

  if (page.droppedEntries) {
    lines.push(`${page.droppedEntries} older entries were evicted from the in-memory history.`);
  }

  // 오래된 이력부터 보여준다. 보관된 출력은 여기서 더 자르지 않는다.
  for (const entry of page.entries) {
    lines.push(
      `\n[${entry.id}] ${entry.timestamp} ${entry.category} | ${entry.sessionName} (${entry.sessionId})`,
      entry.output,
    );

    if (entry.truncated) {
      lines.push("[Output truncated during capture.]");
    }

    if (entry.variablesReference) {
      lines.push(`[Structured value reference ${entry.variablesReference}; object children are not expanded.]`);
    }
  }

  // 더 오래된 이력을 읽는 방법과 다른 디버그 세션을 알려준다.
  if (page.nextBefore) {
    lines.push(`\nOlder page: call vscode_debug_console with before=${JSON.stringify(page.nextBefore)} and sessionId=${JSON.stringify(page.selectedSessionId)}.`);
  } else {
    lines.push("\nNo older retained page.");
  }

  if (page.sessions.length > 1 || !page.selectedSessionId) {
    lines.push(`Captured sessions: ${JSON.stringify(page.sessions)}`);
  }

  return lines.join("\n");
}
