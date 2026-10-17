import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { controlDebug } from "../pi-vscode/src/pi/client.ts";
import { readConnection } from "../pi-vscode/src/shared/connection.ts";

// 확장 파일을 기준으로 프로젝트와 실행 스크립트의 위치를 찾는다.
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(EXTENSION_DIR, "../../..");
const SCRIPT_PATH = join(EXTENSION_DIR, "src/gco-branches.sh");
const BASH_BIN = [
	process.env.GCO_BASH_BIN || "",
	"C:/Program Files/Git/bin/bash.exe",
	"C:/Program Files/Git/usr/bin/bash.exe",
	"C:/Program Files (x86)/Git/bin/bash.exe",
].find(path => path && existsSync(path)) || "bash";

// Pi로 스크립트를 실행하고, 실패한 경우 실행 로그를 오류로 전달한다.
async function runScript(pi: ExtensionAPI, args: string[]): Promise<string> {
	const result = await pi.exec(BASH_BIN, [SCRIPT_PATH, ...args], { cwd: PROJECT_DIR, timeout: 10 * 60_000 });
	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");

	if (result.code !== 0 || result.killed) {
		throw new Error(output || "gco 스크립트 실행에 실패했습니다.");
	}

	return output;
}

// 두 저장소의 원격 브랜치 목록을 읽는다.
async function readBranches(pi: ExtensionAPI): Promise<string[]> {
	const output = await runScript(pi, ["list"]);
	return output.split(/\r?\n/).map(branch => branch.trim()).filter(Boolean);
}

// 원격/브랜치 일치, 브랜치명 일치, 부분 일치 순서로 후보를 찾는다.
function findBranchMatches(branches: string[], query: string): string[] {
	if (!query) return branches;

	const search = query.toLowerCase();
	const exactMatches = branches.filter(branch => branch.toLowerCase() === search);
	if (exactMatches.length > 0) return exactMatches;

	const branchMatches = branches.filter(branch => branch.slice(branch.indexOf("/") + 1).toLowerCase() === search);
	if (branchMatches.length > 0) return branchMatches;

	return branches.filter(branch => branch.toLowerCase().includes(search));
}

// Windows 경로의 구분자와 대소문자를 통일한다.
function normalizeWorkspace(path: string): string {
	return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

// 소스 프로젝트에서 실행 중인 디버거를 찾는다.
async function stopSourceDebuggers(): Promise<void> {
	const source = process.env.GCO_SOURCE_DIR || "D:/ecxsolution/ecount.nextv56/ecount.solution";
	const connection = readConnection(source);
	const result = await controlDebug(connection, { action: "list" });
	const workspace = normalizeWorkspace(source);
	const runs = result.runs.filter(run => normalizeWorkspace(run.workspacePath) === workspace && run.status !== "stopped");

	// 해당 실행만 중지하고, 종료 결과를 확인한다.
	for (const run of runs) {
		const stopped = await controlDebug(connection, { action: "stop", runId: run.runId });
		if (stopped.run?.status !== "stopped") {
			throw new Error(`디버거 종료를 확인하지 못했습니다: ${run.runId}`);
		}
	}
}

export default function gcoExtension(pi: ExtensionAPI) {
	pi.registerCommand("gco", {
		description: "Stop source debugging, rebase source, and clean and pull artifacts on a shared remote branch",

		// 입력한 문자열을 포함하는 원격 브랜치를 자동 완성에 표시한다.
		async getArgumentCompletions(prefix) {
			const branches = await readBranches(pi);
			const search = prefix.trim().toLowerCase();

			return branches
				.filter(branch => branch.toLowerCase().includes(search))
				.slice(0, 50)
				.map(branch => ({ value: branch, label: branch }));
		},

		async handler(args, ctx) {
			// 에이전트가 작업 중이면 실행하지 않는다.
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /gco after the current turn finishes.", "warning");
				return;
			}

			try {
				// 공통으로 사용할 원격과 브랜치를 선택한다.
				ctx.ui.notify("Loading source/artifact branch list...", "info");
				const matches = findBranchMatches(await readBranches(pi), args.trim());
				if (matches.length === 0) {
					ctx.ui.notify("일치하는 원격 브랜치가 없습니다.", "warning");
					return;
				}

				const selected = matches.length === 1 ? matches[0] : await ctx.ui.select("원격 / 브랜치 선택", matches);
				if (!selected) return;

				// 미커밋 변경이 있으면 사용자가 처리 방법을 선택해야 한다.
				let changeAction = "clean";
				const sourceChanges = await runScript(pi, ["source-status"]);
				if (sourceChanges) {
					const choices = [
						"1. 제거 (미커밋 변경과 새 파일 삭제)",
						"2. 스태시 (보관만)",
						"3. 스태시 후 재적용 (대상 브랜치에 복원)",
					];
					// 기본 선택 없이 시작한다. 이동 후 Enter 또는 숫자 키로만 확정한다.
					const choiceIndex = await ctx.ui.custom<number | undefined>((tui, theme, keys, done) => {
						let index = -1;
						const text = new Text("", 1, 1);
						const refresh = () => text.setText([
							theme.fg("accent", `소스 미커밋 변경 처리: ${selected}`),
							"",
							...choices.map((choice, i) => i === index ? theme.fg("accent", `> ${choice}`) : `  ${choice}`),
							"",
							"1/2/3: 선택 실행 | 위/아래: 이동 | Enter: 선택 실행 | Esc: 전체 취소",
						].join("\n"));
						refresh();
						return {
							render: width => text.render(width),
							invalidate: () => text.invalidate(),
							handleInput(data) {
								if (keys.matches(data, "tui.select.cancel")) done(undefined);
								else if (/^[123]$/.test(data)) done(Number(data) - 1);
								else if (keys.matches(data, "tui.select.confirm")) {
									if (index >= 0) done(index);
								} else if (keys.matches(data, "tui.select.down") || keys.matches(data, "tui.select.up")) {
									index = index < 0 ? (keys.matches(data, "tui.select.down") ? 0 : choices.length - 1)
										: Math.max(0, Math.min(choices.length - 1, index + (keys.matches(data, "tui.select.down") ? 1 : -1)));
									refresh();
									tui.requestRender();
								}
							},
						};
					});
					if (choiceIndex === undefined) return;
					changeAction = ["discard", "stash", "reapply"][choiceIndex];
				}

				// Git 작업을 시작하기 전에 소스 디버거를 중지한다.
				ctx.ui.notify("소스 디버거 확인 및 중지 중...", "info");
				await stopSourceDebuggers();

				// 선택한 원격과 브랜치를 스크립트에 전달한다.
				const separator = selected.indexOf("/");
				const remote = selected.slice(0, separator);
				const branch = selected.slice(separator + 1);
				ctx.ui.notify(`소스 rebase / 산출물 pull: ${selected}`, "info");
				const output = await runScript(pi, ["checkout", remote, branch, changeAction]);

				// 완료 결과와 실행 로그를 Pi 대화에 전달한다.
				ctx.ui.notify(`소스 rebase / 산출물 pull 완료: ${selected}`, "info");
				pi.sendUserMessage(`브랜치 이동이 완료되었습니다. 결과를 짧게 확인해 주세요.\n\nBranch: ${selected}\n\n\`\`\`text\n${output}\n\`\`\``);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
