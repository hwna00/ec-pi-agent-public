import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SessionManagerLike = {
	getSessionFile(): string | undefined;
	getSessionName?(): string | undefined;
};

const TP_FILE_NAME = "tp.md";
const PI_DIR = resolve(process.cwd(), ".pi");
const CLIPPER_NORMALIZED_DIR = join(PI_DIR, "ontology", "query-model", "sources", "clipper", "normalized", "board-md");

function getTpFilePath(sessionManager: SessionManagerLike): string | undefined {
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) {
		return undefined;
	}

	const sessionDir = dirname(sessionFile);
	const sessionBaseName = basename(sessionFile, ".jsonl");

	// Future/core folder-style sessions: <session-id>/session.jsonl + tp.md
	if (basename(sessionFile) === "session.jsonl") {
		return join(sessionDir, TP_FILE_NAME);
	}

	// Current extension-compatible sidecar structure:
	// <session-id>.jsonl + <session-id>/tp.md
	return join(sessionDir, sessionBaseName, TP_FILE_NAME);
}

function ensureTpFile(sessionManager: SessionManagerLike): string | undefined {
	const tpFile = getTpFilePath(sessionManager);
	if (!tpFile) {
		return undefined;
	}

	mkdirSync(dirname(tpFile), { recursive: true });
	if (!existsSync(tpFile)) {
		writeFileSync(tpFile, "", "utf8");
	}
	return tpFile;
}

function readTp(sessionManager: SessionManagerLike): string | undefined {
	const tpFile = getTpFilePath(sessionManager);
	if (!tpFile || !existsSync(tpFile)) {
		return undefined;
	}

	const content = readFileSync(tpFile, "utf8").trim();
	return content.length > 0 ? content : undefined;
}

function clipperFileName(tpNo: string): string {
	const normalizedNo = tpNo
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[\\/:*?"<>|#]/g, "")
		.slice(0, 80);
	return `tp_${normalizedNo}`;
}

function extractTpNo(value: string | undefined): string | undefined {
	const match = value?.trim().match(/\d+/);
	return match?.[0];
}

function getCurrentSessionName(pi: ExtensionAPI, sessionManager: SessionManagerLike): string | undefined {
	return pi.getSessionName?.() ?? sessionManager.getSessionName?.();
}

function importClippedTp(sessionManager: SessionManagerLike, tpNo: string): { sourceFile: string; tpFile: string } {
	const sourceFile = join(CLIPPER_NORMALIZED_DIR, `${clipperFileName(tpNo)}.md`);
	if (!existsSync(sourceFile)) {
		throw new Error(`Clipped TP not found: ${sourceFile}`);
	}

	const tpFile = ensureTpFile(sessionManager);
	if (!tpFile) {
		throw new Error("Current session has no session file.");
	}

	writeFileSync(tpFile, readFileSync(sourceFile, "utf8"), "utf8");
	return { sourceFile, tpFile };
}

export default function tpContextExtension(pi: ExtensionAPI) {
	pi.registerCommand("tp", {
		description: "Import clipped TP markdown into current session tp.md",
		handler: async (args, ctx) => {
			const explicitTpNo = extractTpNo(args);
			const sessionName = getCurrentSessionName(pi, ctx.sessionManager);
			const tpNo = explicitTpNo ?? extractTpNo(sessionName);

			if (!tpNo) {
				ctx.ui.notify("TP 번호를 찾을 수 없습니다. 세션 제목을 TP 번호로 두거나 /tp 12345 형태로 실행하세요.", "warning");
				return;
			}

			try {
				const imported = importClippedTp(ctx.sessionManager, tpNo);
				ctx.ui.notify(`TP ${tpNo} imported: ${imported.tpFile}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		ensureTpFile(ctx.sessionManager);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		if (file) {
			const base = basename(file) === "session.jsonl" ? dirname(file) : join(dirname(file), basename(file, ".jsonl"));
			if (existsSync(join(base, "context-graph", "active.json")) || existsSync(join(base, "context-graph", "graph.json"))) return;
		}
		const tp = readTp(ctx.sessionManager);
		if (!tp) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\nCurrent TP for this session:\n\n${tp}`,
		};
	});
}
