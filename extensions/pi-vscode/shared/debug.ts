export interface DebugRequest {
  action: "list" | "start" | "stop";
  workspacePath?: string;
  compound?: string;
  runId?: string;
}

export interface DebugRun {
  runId: string;
  workspacePath: string;
  compound: string;
  status: "starting" | "running" | "stopped" | "failed";
  sessionIds: string[];
  error?: string;
}

export interface DebugControlResult {
  protocolVersion: 1;
  compounds: { workspacePath: string; name: string }[];
  runs: DebugRun[];
  run?: DebugRun;
}
