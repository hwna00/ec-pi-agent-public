import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { applyContext, chooseContext, clearContext } from "../lib/ec-context/selection.ts";
import { installResumeMenu, resumeContext } from "../lib/ec-context/resume.ts";

type KeybindingsManager = ConstructorParameters<typeof CustomEditor>[2];
export type SessionCategory = "tp" | "dev" | "hub" | "dp" | "job" | "decision" | "meeting" | "default";
export type SessionLabel = {
	category: SessionCategory;
	title: string;
	entryKey?: string;
	number?: string;
	projectCode?: string | null;
	projectTitle?: string | null;
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

function displayText(value: string): string {
	return stripAnsi(value).replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

// Read the mounted component tree before setFooter replaces the default footer.
// Constructor names work across Pi's separate extension module loaders.
function findDefaultFooter(component: Component): Component | undefined {
	if (component.constructor.name === "FooterComponent") return component;
	if (!("children" in component) || !Array.isArray(component.children)) return;
	for (let index = component.children.length - 1; index >= 0; index--) {
		const footer = findDefaultFooter(component.children[index]);
		if (footer) return footer;
	}
}

function footerName(entries: readonly unknown[]): string | undefined {
	const label = getCurrentSessionLabel(entries);
	return label?.entryKey && label.projectCode
		? `[${label.projectCode}] ${label.projectTitle || label.title}`
		: label?.entryKey ? label.title : getCurrentSessionName(entries);
}

function footerCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const local = relative(resolve(home), resolve(cwd));
	return local === ".." || local.startsWith(".." + sep) || isAbsolute(local)
		? cwd : local ? "~" + sep + local : "~";
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

		const data = customEntry.data as Partial<SessionLabel>;
		if (
			typeof data.category === "string" &&
			isSessionCategory(data.category) &&
			typeof data.title === "string"
		) {
			if (!data.title.trim()) return undefined;
			return {
				category: data.category,
				title: data.title.trim(),
				...(typeof data.entryKey === "string" ? { entryKey: data.entryKey } : {}),
				...(typeof data.number === "string" ? { number: data.number } : {}),
				...(typeof data.projectCode === "string" || data.projectCode === null
					? { projectCode: data.projectCode }
					: {}),
				...(typeof data.projectTitle === "string" || data.projectTitle === null
					? { projectTitle: data.projectTitle }
					: {}),
			};
		}
	}

	return undefined;
}

function formatSessionName(category: SessionCategory, title: string): string {
	const trimmedTitle = title.trim();
	return category === "default" ? trimmedTitle : `[${category}] ${trimmedTitle}`;
}

export function getCurrentSessionName(entries: readonly unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as {
			type?: string; name?: string; customType?: string; data?: Partial<SessionLabel>;
		};
		if (entry?.type === "session_info") return entry.name?.trim() || undefined;
		if (entry?.type === "custom" && entry.customType === SESSION_LABEL_ENTRY_TYPE &&
			entry.data && isSessionCategory(entry.data.category || "") && typeof entry.data.title === "string") {
			return entry.data.title.trim() ? formatSessionName(entry.data.category!, entry.data.title) : undefined;
		}
	}
	return undefined;
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

async function askSessionName(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "ui" | "sessionManager">): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	const leafId = ctx.sessionManager.getLeafId();
	const title = await ctx.ui.input("세션 제목", "title");
	if (!title?.trim() || ctx.sessionManager.getSessionId() !== sessionId || ctx.sessionManager.getLeafId() !== leafId) {
		return;
	}

	const sessionName = saveSessionLabel(pi, "default", title);
	ctx.ui.notify(`Session renamed to: ${sessionName}`, "info");
}

class SessionLabelEditor extends CustomEditor {
	private readonly getLabel: () => { name?: string; label?: SessionLabel };

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		getLabel: () => { name?: string; label?: SessionLabel },
	) {
		super(tui, theme, keybindings);
		this.getLabel = getLabel;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const { name, label } = this.getLabel();
		const contextLabel = label?.number && label.category !== "default" ? label : undefined;
		const sessionName = contextLabel
			? `${contextLabel.category.toUpperCase()} ${contextLabel.number} | ${contextLabel.title}`
			: name;
		if (lines.length === 0) return lines;

		lines[0] = this.borderColor(sessionName ? topBorderWithLabel(width, displayText(sessionName)) : straightBorder(width));

		for (let index = lines.length - 1; index > 0; index--) {
			if (isHorizontalBorder(lines[index] ?? "")) {
				lines[index] = this.borderColor(straightBorder(width));
				break;
			}
		}
		return lines;
	}
}

export default function sessionLabelEditorExtension(
	pi: ExtensionAPI,
	services: {
		chooseContext: typeof chooseContext;
		applyContext: typeof applyContext;
		clearContext: typeof clearContext;
		resumeContext?: typeof resumeContext;
	} = { chooseContext, applyContext, clearContext, resumeContext },
) {
	let defaultFooter: Component | undefined;
	pi.registerCommand("resume-context", {
		description: "작업과 게시글을 선택하여 연결된 세션 재개",
		handler: async (_args, ctx) => {
			try {
				await (services.resumeContext || resumeContext)(ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
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
		let editor: SessionLabelEditor | undefined;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			defaultFooter = findDefaultFooter(tui) || defaultFooter;
			editor = new SessionLabelEditor(tui, theme, keybindings, () => {
				const branch = ctx.sessionManager.getBranch();
				return { name: getCurrentSessionName(branch), label: getCurrentSessionLabel(branch) };
			});
			return editor;
		});
		if (editor) installResumeMenu(editor, ctx);
		if (defaultFooter) {
			const original = defaultFooter;
			ctx.ui.setFooter((tui, theme, footerData) => ({
				invalidate: () => original.invalidate(),
				dispose: footerData.onBranchChange(() => tui.requestRender()),
				render(width) {
					const lines = original.render(width);
					const branch = footerData.getGitBranch();
					const name = footerName(ctx.sessionManager.getBranch());
					const line = footerCwd(ctx.sessionManager.getCwd()) + (branch ? ` (${branch})` : "") + (name ? ` • ${displayText(name)}` : "");
					lines[0] = truncateToWidth(theme.fg("dim", line), width, theme.fg("dim", "..."));
					return lines;
				},
			}));
		}

		const hasEntries = ctx.sessionManager.getEntries().length > 0;
		const shouldAskName = event.reason === "new" || (event.reason === "startup" && !hasEntries && !pi.getSessionName());
		if (ctx.hasUI && shouldAskName) {
			const sessionId = ctx.sessionManager.getSessionId();
			const leafId = ctx.sessionManager.getLeafId();
			const isCurrent = () => ctx.sessionManager.getSessionId() === sessionId && ctx.sessionManager.getLeafId() === leafId;
			try {
				const description = await services.chooseContext(ctx);
				if (!isCurrent()) return;
				if (description === null) services.clearContext(pi, ctx);
				else if (description !== undefined) services.applyContext(pi, ctx, description);
			} catch (error) {
				if (isCurrent()) ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		}
	});
}
