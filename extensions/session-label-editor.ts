import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

type KeybindingsManager = ConstructorParameters<typeof CustomEditor>[2];
export type SessionCategory = "tp" | "dev" | "hub" | "dp" | "job" | "decision" | "meeting" | "default";
export type SessionLabel = {
	category: SessionCategory;
	title: string;
};

export const SESSION_CATEGORIES: SessionCategory[] = ["tp", "dev", "hub", "dp", "job", "decision", "meeting", "default"];
export const SESSION_LABEL_ENTRY_TYPE = "session-label";

function straightBorder(width: number): string {
	return "─".repeat(Math.max(0, width));
}

function topBorderWithLabel(width: number, sessionName: string): string {
	const label = `─ ${sessionName} `;
	if (visibleWidth(label) >= width) {
		return truncateToWidth(label, width, "");
	}
	return label + "─".repeat(width - visibleWidth(label));
}

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isHorizontalBorder(value: string): boolean {
	const stripped = stripAnsi(value);
	return stripped.includes("─") && stripped.replace(/[↑↓0-9 more]/g, "").split("").every((char) => char === "─");
}

function isSessionCategory(value: string): value is SessionCategory {
	return SESSION_CATEGORIES.includes(value as SessionCategory);
}

export function parseSessionName(sessionName: string): { category?: Exclude<SessionCategory, "default">; title: string } {
	const trimmed = sessionName.trim();
	const bracketMatch = /^\[(tp|dev|hub|dp|job|decision|meeting)\]\s+(.+)$/i.exec(trimmed);
	if (!bracketMatch) {
		return { title: trimmed };
	}

	return {
		category: bracketMatch[1]?.toLowerCase() as Exclude<SessionCategory, "default">,
		title: bracketMatch[2]?.trim() ?? "",
	};
}

export function getCurrentSessionLabel(entries: readonly unknown[]): SessionLabel | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") {
			continue;
		}

		const customEntry = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (customEntry.type !== "custom" || customEntry.customType !== SESSION_LABEL_ENTRY_TYPE) {
			continue;
		}

		if (!customEntry.data || typeof customEntry.data !== "object") {
			continue;
		}

		const data = customEntry.data as { category?: unknown; title?: unknown };
		if (
			typeof data.category === "string" &&
			isSessionCategory(data.category) &&
			typeof data.title === "string" &&
			data.title.trim()
		) {
			return {
				category: data.category,
				title: data.title.trim(),
			};
		}
	}

	return undefined;
}

function formatSessionName(category: SessionCategory, title: string): string {
	const trimmedTitle = title.trim();
	return category === "default" ? trimmedTitle : `[${category}] ${trimmedTitle}`;
}

function saveSessionLabel(pi: ExtensionAPI, category: SessionCategory, title: string): string {
	const label: SessionLabel = {
		category,
		title: title.trim(),
	};
	const sessionName = formatSessionName(label.category, label.title);

	pi.appendEntry<SessionLabel>(SESSION_LABEL_ENTRY_TYPE, label);
	pi.setSessionName(sessionName);
	return sessionName;
}

function parseRenameArgs(args: string): { category: SessionCategory; title: string } | undefined {
	const trimmed = args.trim();
	if (!trimmed) {
		return undefined;
	}

	const bracketMatch = /^\[(tp|dev|hub|dp|job|decision|meeting|default)\]\s+(.+)$/i.exec(trimmed);
	if (bracketMatch) {
		const category = bracketMatch[1];
		const title = bracketMatch[2];
		if (!category || !title) {
			return undefined;
		}

		return {
			category: category.toLowerCase() as SessionCategory,
			title: title.trim(),
		};
	}

	const [first, ...rest] = trimmed.split(/\s+/);
	if (first && isSessionCategory(first.toLowerCase())) {
		return {
			category: first.toLowerCase() as SessionCategory,
			title: rest.join(" ").trim(),
		};
	}

	return {
		category: "default",
		title: trimmed,
	};
}

async function askSessionName(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "ui">): Promise<void> {
	const category = await ctx.ui.select("세션 카테고리", SESSION_CATEGORIES);
	if (!category || !isSessionCategory(category)) {
		return;
	}

	const title = await ctx.ui.input("세션 제목", category === "default" ? "title" : `[${category}] title`);
	if (!title?.trim()) {
		ctx.ui.notify("Session title was not set.", "warning");
		return;
	}

	const sessionName = saveSessionLabel(pi, category, title);
	ctx.ui.notify(`Session renamed to: ${sessionName}`, "info");
}

class SessionLabelEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getSessionName: () => string | undefined,
	) {
		super(tui, theme, keybindings);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const sessionName = this.getSessionName();
		if (lines.length === 0) return lines;

		lines[0] = this.borderColor(sessionName ? topBorderWithLabel(width, sessionName) : straightBorder(width));

		for (let index = lines.length - 1; index > 0; index--) {
			if (isHorizontalBorder(lines[index] ?? "")) {
				lines[index] = this.borderColor(straightBorder(width));
				break;
			}
		}

		return lines;
	}
}

export default function sessionLabelEditorExtension(pi: ExtensionAPI) {
	pi.registerCommand("rename", {
		description: "Rename the current session with an optional category",
		handler: async (args, ctx) => {
			const parsed = parseRenameArgs(args);
			if (!parsed) {
				await askSessionName(pi, ctx);
				return;
			}

			if (!parsed.title) {
				ctx.ui.notify("Usage: /rename [tp|dev|hub|dp|job|decision|meeting|default] <session title>", "warning");
				return;
			}

			const sessionName = saveSessionLabel(pi, parsed.category, parsed.title);
			ctx.ui.notify(`Session renamed to: ${sessionName}`, "info");
		},
	});

	pi.on("session_start", async (event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new SessionLabelEditor(tui, theme, keybindings, () => pi.getSessionName()));

		const hasEntries = ctx.sessionManager.getEntries().length > 0;
		const shouldAskName = event.reason === "new" || (event.reason === "startup" && !hasEntries && !pi.getSessionName());
		if (ctx.hasUI && shouldAskName) {
			await askSessionName(pi, ctx);
		}
	});
}
