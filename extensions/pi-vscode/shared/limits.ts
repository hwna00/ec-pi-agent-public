// 한 번에 읽는 기록 수와 전체 보관 개수다.
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const MAX_HISTORY_ENTRIES = 1_000;

// 저장할 때만 출력 길이를 줄인다. 조회할 때는 보관한 텍스트를 그대로 준다.
export const MAX_ENTRY_BYTES = 16 * 1_024;
