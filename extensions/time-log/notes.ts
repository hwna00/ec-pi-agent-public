/** Presentation only. Selecting and writing remarks belongs to the model. */
export function formatTimeLogRemarks(
  input: string | readonly string[],
): string {
  const values = typeof input === "string" ? [input] : [...input];
  const lines = values
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) =>
      value
        .trim()
        .replace(/^(?:[-*•](?:\s+|$)|\d+[.)]\s+)/, "")
        .trim(),
    )
    .filter(Boolean);
  const unique = [...new Set(lines)];
  if (!unique.length)
    throw new Error("비고에는 핵심 내용이 한 줄 이상 필요합니다.");
  return unique
    .slice(0, 3)
    .map((line) => `- ${line}`)
    .join("\n");
}
