import { SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import type {
  CustomEditor,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { chooseContextTarget, readLocalContext } from "./selection.ts";
import { filterLinkedSessions, listLinkedSessions } from "./session-links.ts";
import type { LinkedSession } from "./session-links.ts";
import type { ContextSummary } from "../workspace/workspace.ts";
import { stripVTControlCharacters } from "node:util";
import { getKeybindings, Text, truncateToWidth } from "@earendil-works/pi-tui";

const contextCommand = "/resume-context";
const clean = (text: string) =>
  stripVTControlCharacters(text)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .trim();

function stillCurrent(ctx: ExtensionContext) {
  const id = ctx.sessionManager.getSessionId(),
    leaf = ctx.sessionManager.getLeafId();
  return () => {
    try {
      return (
        ctx.sessionManager.getSessionId() === id &&
        ctx.sessionManager.getLeafId() === leaf
      );
    } catch {
      return false; // Pi invalidates the previous context after switching sessions.
    }
  };
}

// Install after setEditorComponent: Pi assigns the original submit handler there.
export function installResumeMenu(editor: CustomEditor, ctx: ExtensionContext) {
  const submit = editor.onSubmit;
  let choosing = false;
  const open = async () => {
    if (choosing) return;
    choosing = true;
    const isCurrent = stillCurrent(ctx);
    try {
      const method = await ctx.ui.select("세션 재개", [
        "작업별 찾기",
        "기존 텍스트 검색",
      ]);
      if (!isCurrent()) return;
      if (method === "작업별 찾기") await submit?.(contextCommand);
      else if (method === "기존 텍스트 검색") await submit?.("/resume");
    } catch (error) {
      if (isCurrent())
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
    } finally {
      choosing = false;
    }
  };
  editor.onSubmit = (text) =>
    text.trim() === "/resume" ? open() : submit?.(text);
  editor.onAction("app.session.resume", () => {
    void open();
  });
}

export function sessionChoiceLabel(session: LinkedSession) {
  const date = session.modified;
  const time = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${time} #${session.id.slice(-8)} | ${clean(session.name || "제목 없음")}`;
}

export async function selectLinkedSession(
  ctx: ExtensionContext,
  sessions: LinkedSession[],
): Promise<string | undefined> {
  // These labels are view data only. Persisted names and search text stay intact.
  const choices = sessions
    .map((session) => ({ ...session, name: sessionChoiceLabel(session) }))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return ctx.ui.custom<string | undefined>((tui, _theme, keybindings, done) => {
    const selector = new SessionSelectorComponent(
      async () => choices,
      async () => choices,
      (path) => done(path),
      () => done(undefined),
      () => done(undefined),
      () => tui.requestRender(),
      { keybindings },
      ctx.sessionManager.getSessionFile(),
    );
    const list = selector.getSessionList();
    list.onToggleSort?.(); // Native initial mode is threaded; start with recent.
    return {
      get focused() {
        return list.focused;
      },
      set focused(value: boolean) {
        list.focused = value;
      },
      invalidate() {
        list.invalidate();
      },
      handleInput(data: string) {
        // This screen selects a session; native /resume retains management actions.
        const keys = getKeybindings();
        if (
          keys.matches(data, "tui.input.tab") ||
          keys.matches(data, "app.session.delete") ||
          keys.matches(data, "app.session.deleteNoninvasive") ||
          keybindings?.matches(data, "app.session.rename")
        )
          return;
        list.handleInput(data);
      },
      render(width: number) {
        const selected = sessions.find(
          (session) => session.path === list.getSelectedSessionPath(),
        );
        const current =
          selected?.currentEntryKey?.replace(":", " ").toUpperCase() || "없음";
        const details = selected
          ? new Text(
              [
                clean(selected.name || "제목 없음"),
                `재개 시 연결: ${current}`,
                `대화 미리보기: ${clean(selected.firstMessage).slice(0, 200)}`,
              ].join("\n"),
              0,
              0,
            ).render(width)
          : [];
        return [
          truncateToWidth(
            "이어갈 세션 · 검색어 입력 · ↑↓ 선택 · Enter 재개 · Esc 취소",
            width,
          ),
          ...list.render(width),
          "",
          ...details,
        ];
      },
    };
  });
}

export async function resumeContext(
  ctx: ExtensionCommandContext,
  services = { readLocalContext, listLinkedSessions, selectLinkedSession },
) {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      "작업별 세션 선택은 대화형 Pi에서 사용할 수 있습니다.",
      "info",
    );
    return;
  }
  const isCurrent = stillCurrent(ctx);
  const stored: ContextSummary[] = JSON.parse(
    await services.readLocalContext(ctx, ["list-contexts"]),
  );
  if (!isCurrent()) return;
  const target = await chooseContextTarget(ctx, stored, {
    allowAllSessions: true,
  });
  if (!target || !isCurrent()) return;
  ctx.ui.setStatus("ec-resume", "세션 연결 확인 중…");
  let path: string | undefined;
  try {
    const sessions = filterLinkedSessions(
      await services.listLinkedSessions(ctx, stored),
      target,
    );
    if (!isCurrent()) return;
    if (!sessions.length) {
      ctx.ui.notify(
        "연결된 세션이 없습니다. 오래된 세션은 /resume의 기존 텍스트 검색으로 찾으세요.",
        "info",
      );
      return;
    }
    path = await services.selectLinkedSession(ctx, sessions);
  } finally {
    try {
      ctx.ui.setStatus("ec-resume", undefined);
    } catch {
      // A session switch can dispose the old context while the selector is open.
    }
  }
  if (path && isCurrent()) await ctx.switchSession(path);
}
