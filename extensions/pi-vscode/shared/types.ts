// Pi와 VS Code가 같은 형식으로 데이터를 주고받는지 확인한다.
export const PROTOCOL_VERSION = 1 as const;

// 디버거가 알려준 출력 위치다. 위치가 없는 출력도 있다.
export interface DebugConsoleSource {
  name?: string;
  path?: string;
  sourceReference?: number;
  line?: number;
  column?: number;
}

// 기록 하나는 출력 이벤트 하나 또는 콘솔에서 실행한 식의 결과 하나다.
export interface DebugConsoleEntry {
  id: number;
  timestamp: string;
  sessionId: string;
  sessionName: string;
  category: string;
  output: string;
  truncated: boolean;
  variablesReference?: number;
  source?: DebugConsoleSource;
}

// 세션은 한 번의 디버깅이다. 부모와 자식 디버거는 하나의 세션으로 묶는다.
export interface DebugSessionInfo {
  id: string;
  name: string;
  type: string;
  workspaceUri?: string;
  active: boolean;
  entryCount: number;
  droppedEntries: number;
}

// 한 번 읽은 결과다. nextBefore를 다음 호출의 before에 넣으면 이전 기록을 읽는다.
export interface DebugConsolePage {
  protocolVersion: typeof PROTOCOL_VERSION;
  instanceId: string;
  selectedSessionId: string | null;
  entries: DebugConsoleEntry[];
  requestedLimit: number;
  nextBefore: string | null;
  hasMore: boolean;
  droppedEntries: number;
  sessions: DebugSessionInfo[];
}
