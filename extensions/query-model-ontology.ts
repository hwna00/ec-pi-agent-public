import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "../npm/node_modules/@earendil-works/pi-coding-agent/dist/index.js" with { "resolution-mode": "import" };

const PI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ONTOLOGY_CLI = join(PI_DIR, "ontology", "query-model", "tools", "ontology-cli.mjs");
const execFileAsync = promisify(execFile);

function splitCommandArgs(args: string): string[] {
	const result: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const char = args[i];
		if ((char === `"` || char === `'`) && !quote) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = undefined;
			continue;
		}
		if (/\s/.test(char) && !quote) {
			if (current) {
				result.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) result.push(current);
	return result;
}

async function runOntologyCli(args: string[]): Promise<string> {
	if (!existsSync(ONTOLOGY_CLI)) {
		throw new Error(`Ontology CLI does not exist: ${ONTOLOGY_CLI}`);
	}
	const { stdout, stderr } = await execFileAsync(
		process.execPath,
		[ONTOLOGY_CLI, ...args],
		{ cwd: resolve(PI_DIR, ".."), timeout: 5 * 60_000, maxBuffer: 1024 * 1024 * 20 },
	);
	return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
}

export default function queryModelOntologyExtension(pi: ExtensionAPI) {
	pi.registerCommand("ontology-ingest", {
		description: "Ingest query-model ontology evidence into project-local raw/normalized storage",
		handler: async (args, ctx) => {
			try {
				if (!ctx.isIdle()) {
					ctx.ui.notify("Agent is busy. Run /ontology-ingest after the current turn finishes.", "warning");
					return;
				}
				const parsed = splitCommandArgs(args);
				const source = parsed[0];
				if (!source) {
					const sessionFile = ctx.sessionManager.getSessionFile();
					if (!sessionFile) {
						ctx.ui.notify("No current Pi session file is available.", "warning");
						return;
					}
					ctx.ui.notify("Ingesting current Pi session into query-model ontology...", "info");
					const result = await runOntologyCli(["ingest", "pi", sessionFile]);
					ctx.ui.notify("Current Pi session was ingested. Run /ontology-index to rebuild the graph.", "info");
					pi.sendUserMessage(`현재 Pi session을 query-model ontology evidence로 ingest했습니다. 결과를 짧게 확인해 주세요.\n\n\`\`\`json\n${result}\n\`\`\``);
					return;
				}
				if (source === "pi" && (!parsed[1] || parsed[1] === "current")) {
					const sessionFile = ctx.sessionManager.getSessionFile();
					if (!sessionFile) {
						ctx.ui.notify("No current Pi session file is available.", "warning");
						return;
					}
					const result = await runOntologyCli(["ingest", "pi", sessionFile]);
					ctx.ui.notify("Current Pi session was ingested. Run /ontology-index to rebuild the graph.", "info");
					pi.sendUserMessage(`현재 Pi session을 query-model ontology evidence로 ingest했습니다. 결과를 짧게 확인해 주세요.\n\n\`\`\`json\n${result}\n\`\`\``);
					return;
				}
				ctx.ui.notify(`Ingesting ${source} into query-model ontology...`, "info");
				const result = await runOntologyCli(["ingest", ...parsed]);
				ctx.ui.notify(`${source} evidence was ingested. Run /ontology-index to rebuild the graph.`, "info");
				pi.sendUserMessage(`query-model ontology evidence ingest 결과를 짧게 확인해 주세요.\n\nSource: ${source}\n\n\`\`\`json\n${result}\n\`\`\``);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ontology-index", {
		description: "Rebuild query-model ontology graph artifacts",
		handler: async (_args, ctx) => {
			try {
				if (!ctx.isIdle()) {
					ctx.ui.notify("Agent is busy. Run /ontology-index after the current turn finishes.", "warning");
					return;
				}
				ctx.ui.notify("Rebuilding query-model ontology graph...", "info");
				const result = await runOntologyCli(["index"]);
				ctx.ui.notify("Query-model ontology graph was rebuilt.", "info");
				pi.sendUserMessage(`query-model ontology graph를 재생성했습니다. 산출물과 통계를 짧게 확인해 주세요.\n\n\`\`\`json\n${result}\n\`\`\``);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ontology-query", {
		description: "Ask an interactive question using the query-model ontology graph",
		handler: async (args, ctx) => {
			try {
				const question = args.trim();
				if (!question) {
					ctx.ui.notify("Usage: /ontology-query <question>", "warning");
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("Agent is busy. Run /ontology-query after the current turn finishes.", "warning");
					return;
				}
				ctx.ui.notify("Preparing query-model ontology context...", "info");
				const prompt = await runOntologyCli(["query", question]);
				pi.sendUserMessage(prompt);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ontology-status", {
		description: "Show query-model ontology source/index status",
		handler: async (_args, ctx) => {
			try {
				const result = await runOntologyCli(["status"]);
				pi.sendUserMessage(`query-model ontology status를 확인해 주세요.\n\n\`\`\`json\n${result}\n\`\`\``);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ontology-open", {
		description: "Open query-model ontology graph HTML",
		handler: async (_args, ctx) => {
			try {
				const result = await runOntologyCli(["open"]);
				ctx.ui.notify("Opened query-model ontology HTML.", "info");
				pi.sendUserMessage(`query-model ontology HTML을 열었습니다.\n\n\`\`\`json\n${result}\n\`\`\``);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
