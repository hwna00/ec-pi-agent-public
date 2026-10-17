import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type * as vscode from "vscode";
import { BridgeError } from "../shared/store.ts";
import type { DebugRequest, DebugRun, DebugControlResult } from "../shared/debug.ts";

function workspaceKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// VS Code API로 compound를 실행하고 해당 실행의 세션을 추적한다.
export function createDebugControl(api: Pick<typeof vscode, "workspace" | "debug">) {
  const runs = new Map<string, DebugRun>();
  const sessions = new Map<string, vscode.DebugSession>();
  let pending: { run: DebugRun; members: { folder: vscode.WorkspaceFolder; name: string }[] } | undefined;
  let busy = false;
  const subscriptions = [
    api.debug.onDidStartDebugSession(session => {
      sessions.set(session.id, session);
      const parentRun = session.parentSession && [...runs.values()].find(r => r.sessionIds.includes(session.parentSession!.id));
      const matching = pending?.members.some(m => m.name === session.configuration.name && m.folder.uri.toString() === session.workspaceFolder?.uri.toString());
      const run = parentRun ?? (matching ? pending?.run : undefined);
      if (run && !run.sessionIds.includes(session.id)) run.sessionIds.push(session.id);
    }),
    api.debug.onDidTerminateDebugSession(session => {
      sessions.delete(session.id);
      for (const run of runs.values()) {
        if (run.status === "running" && !run.sessionIds.some(id => sessions.has(id))) run.status = "stopped";
      }
    }),
  ];

  function catalog() {
    return (api.workspace.workspaceFolders ?? []).flatMap(folder => {
      const compounds = api.workspace.getConfiguration("launch", folder.uri).get<any[]>("compounds", []);
      return compounds.filter(c => typeof c.name === "string" && Array.isArray(c.configurations)).map(c => ({ folder, config: c }));
    });
  }
  function result(run?: DebugRun): DebugControlResult {
    return { protocolVersion: 1, compounds: catalog().map(c => ({ workspacePath: c.folder.uri.fsPath, name: c.config.name })), runs: [...runs.values()], ...(run ? { run } : {}) };
  }
  async function execute(request: DebugRequest): Promise<DebugControlResult> {
    if (request.action === "list") return result();
    if (request.action !== "start" && request.action !== "stop") throw new BridgeError(400, "action must be list, start, or stop");
    if (busy) throw new BridgeError(409, "A debug operation is already in progress; use list before retrying");
    busy = true;
    try {
      if (request.action === "stop") {
        const run = typeof request.runId === "string" ? runs.get(request.runId) : undefined;
        if (!run) throw new BridgeError(404, "Unknown runId; list runs started by this bridge");
        // 실행에서 추적한 세션을 지정해 중단한다.
        const targets = run.sessionIds.map(id => sessions.get(id)).filter((s): s is vscode.DebugSession => !!s);
        for (const session of targets) if (sessions.has(session.id)) await api.debug.stopDebugging(session);
        // stopDebugging의 반환보다 종료 이벤트가 늦게 도착할 수 있다.
        if (run.sessionIds.some(id => sessions.has(id))) await new Promise<void>((resolve, reject) => {
          const subscription = api.debug.onDidTerminateDebugSession(() => {
            if (!run.sessionIds.some(id => sessions.has(id))) { clearTimeout(timer); subscription.dispose(); resolve(); }
          });
          const timer = setTimeout(() => { subscription.dispose(); reject(new BridgeError(409, "Sessions have not terminated yet; use list and retry stop")); }, 10_000);
          if (!run.sessionIds.some(id => sessions.has(id))) { clearTimeout(timer); subscription.dispose(); resolve(); }
        });
        if (run.sessionIds.some(id => sessions.has(id))) throw new BridgeError(409, "Some sessions are still active; use list and retry stop");
        run.status = "stopped";
        return result(run);
      }
      if (typeof request.compound !== "string" || !request.compound.trim()) throw new BridgeError(400, "compound is required");
      if (request.workspacePath !== undefined && typeof request.workspacePath !== "string") throw new BridgeError(400, "workspacePath must be a string");
      const candidates = catalog().filter(c => c.config.name === request.compound && (request.workspacePath === undefined || workspaceKey(c.folder.uri.fsPath) === workspaceKey(request.workspacePath)));
      if (candidates.length !== 1) throw new BridgeError(candidates.length ? 400 : 404, "Choose a compound and workspacePath from list");
      const { folder, config } = candidates[0];
      const members = config.configurations.map((c: string | { name: string; folder: string }) => {
        const memberFolder = typeof c === "string" ? folder : api.workspace.workspaceFolders?.find(f => f.name === c.folder);
        if (!memberFolder) throw new BridgeError(400, "Compound references an unknown workspace folder");
        return { folder: memberFolder, name: typeof c === "string" ? c : c.name };
      });
      if ([...sessions.values()].some(s => members.some((m: { folder: vscode.WorkspaceFolder; name: string }) => m.name === s.configuration.name && m.folder.uri.toString() === s.workspaceFolder?.uri.toString()))) throw new BridgeError(409, "A compound member is already running");
      const run: DebugRun = { runId: randomUUID(), workspacePath: folder.uri.fsPath, compound: config.name, status: "starting", sessionIds: [] };
      runs.set(run.runId, run);
      pending = { run, members };
      try {
        // compound 이름을 그대로 VS Code에 전달한다.
        const started = await api.debug.startDebugging(folder, config.name);
        run.status = started ? (run.sessionIds.some(id => sessions.has(id)) ? "running" : "stopped") : "failed";
        if (!started) run.error = "VS Code could not start the compound; inspect VS Code debug output";
      } catch (error) {
        run.status = "failed";
        run.error = error instanceof Error ? error.message : String(error);
      } finally { pending = undefined; }
      return result(run);
    } finally { busy = false; }
  }
  return { execute, dispose: () => subscriptions.forEach(s => s.dispose()) };
}
