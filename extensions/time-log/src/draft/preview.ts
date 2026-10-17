import {
  Key,
  Markdown,
  Text,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { timeLogDeliveryLabel, type TimeLogProfile } from "../erp/payload.ts";
import type { TimeLogSessionCollection } from "../sessions/sessions.ts";
import { formatTimeLogRemarks } from "./notes.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";

export const TIME_LOG_PREVIEW_COLUMNS = [
  "작업명",
  "PL명",
  "업무명",
  "거래명",
  "카테고리명",
  "시간(분)",
  "시간",
  "종료 예정일",
  "비고",
] as const;

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|><$~-]/g, "\\$&");
}

function cell(value: string): string {
  return value.split(/\r?\n/).map(escapeMarkdown).join("<br>");
}

/** One canonical, reviewable table string is also stored in the draft's hash. */
export function buildTimeLogPreview(
  collection: TimeLogSessionCollection,
  profile: TimeLogProfile,
  connectionLabel: string,
): string {
  const inactive = collection.skipped.filter(
    (item) => item.reason === "no_activity",
  ).length;
  const exclusions = collection.skipped.filter(
    (item) => item.reason !== "no_activity",
  );
  const selected = new Set(
    collection.rows.flatMap((row) =>
      row.sources.map((source) => source.sessionId),
    ),
  );
  const lines = [
    `일자: ${escapeMarkdown(collection.date)} | 작성일: ${escapeMarkdown(collection.date)} | 담당자: ${escapeMarkdown(profile.person.name)} | 부서: ${escapeMarkdown(profile.department.name)}`,
    `전달 범위: ${escapeMarkdown(timeLogDeliveryLabel(profile))}`,
    `검사한 세션: ${collection.scanned}개 | 선택한 세션: ${selected.size}개 | 입력 행: ${collection.rows.length}개`,
    `날짜에 해당하지 않음: ${inactive}개 | 제외 기록: ${exclusions.length}건`,
    ...(collection.rows.some((row) =>
      row.sources.some((source) => source.snapshot),
    )
      ? ["집계 범위: 수집 시점까지의 기록 (이후 작업은 다시 생성하면 반영)"]
      : []),
    "",
    `| ${TIME_LOG_PREVIEW_COLUMNS.map(cell).join(" | ")} |`,
    `| ${TIME_LOG_PREVIEW_COLUMNS.map(() => "---").join(" | ")} |`,
  ];
  for (const row of collection.rows) {
    const job = row.context.job as typeof row.context.job & {
      plName?: string | null;
    };
    const values = [
      job?.name || "",
      job?.plName || "",
      row.context.transaction.bizzName,
      row.context.transaction.name,
      "개발",
      "",
      "",
      collection.date,
      formatTimeLogRemarks(row.description),
    ];
    lines.push(`| ${values.map(cell).join(" | ")} |`);
  }
  lines.push("", "프로젝트와 출처 세션:");
  for (const [index, row] of collection.rows.entries()) {
    const project =
      [row.context.project.code, row.context.project.name]
        .filter(Boolean)
        .join(" ") || "미지정";
    const sources = row.sources
      .map((source) => `${source.name} (${source.sessionId})`)
      .join("; ");
    lines.push(
      `행 ${index + 1} 프로젝트: ${escapeMarkdown(project)}`,
      `출처: ${escapeMarkdown(sources)}`,
      "",
    );
  }
  if (exclusions.length) {
    lines.push("", "제외한 기록:");
    for (const item of exclusions) {
      lines.push(
        `- ${escapeMarkdown(item.name)}${item.entryKey ? ` (${escapeMarkdown(item.entryKey)})` : ""}: ${escapeMarkdown(item.message)}`,
      );
    }
  }
  lines.push(
    "",
    `합계: 미입력 | 접속 대상: ${escapeMarkdown(connectionLabel)}`,
  );
  return lines.join("\n");
}

type ParsedPreview = {
  before: string;
  headers: string[];
  rows: string[][];
  after: string;
};

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function decodeCell(value: string): string {
  return unescapeMarkdown(value.trim().replaceAll("<br>", "\n"));
}

function splitTableLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === "\\" && index + 1 < line.length) {
      current += character + line[++index];
    } else if (character === "|") {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells.slice(1, -1).map(decodeCell);
}

/** Parse only our generated nine-column table; all other text stays native Markdown. */
function parsePreview(preview: string): ParsedPreview | null {
  const lines = preview.split("\n");
  const start = lines.findIndex(
    (line, index) =>
      line.startsWith("| ") &&
      splitTableLine(line).join("\0") === TIME_LOG_PREVIEW_COLUMNS.join("\0") &&
      /^\|(?:\s*-{3,}\s*\|){9}$/.test(lines[index + 1] || ""),
  );
  if (start === -1) return null;
  const rows: string[][] = [];
  let end = start + 2;
  while (lines[end]?.startsWith("| ")) {
    const values = splitTableLine(lines[end]!);
    if (values.length !== TIME_LOG_PREVIEW_COLUMNS.length) return null;
    rows.push(values);
    end++;
  }
  return {
    before: lines.slice(0, start).join("\n"),
    headers: [...TIME_LOG_PREVIEW_COLUMNS],
    rows,
    after: lines.slice(end).join("\n"),
  };
}

/** Plain fallback confirmations contain the same fields and bullet lines, without HTML. */
export function timeLogPreviewPlainText(preview: string): string {
  const parsed = parsePreview(preview);
  if (!parsed) return unescapeMarkdown(preview);
  const lines = [unescapeMarkdown(parsed.before).trimEnd()];
  for (const [index, row] of parsed.rows.entries()) {
    lines.push("", `${index + 1}.`);
    for (const [column, header] of parsed.headers.entries()) {
      lines.push(`${header}: ${row[column] || ""}`);
    }
  }
  lines.push("", unescapeMarkdown(parsed.after).trimStart());
  return lines.join("\n");
}

function columnWidths(parsed: ParsedPreview, width: number): number[] | null {
  const overhead = 3 * parsed.headers.length + 1;
  const minimum = parsed.headers.map((header) =>
    Math.min(6, visibleWidth(header)),
  );
  const budget = width - overhead;
  if (minimum.reduce((sum, value) => sum + value, 0) > budget) return null;
  const natural = minimum.map((_value, column) =>
    Math.max(
      visibleWidth(parsed.headers[column]!),
      ...parsed.rows.map((row) =>
        Math.max(...(row[column] || "").split("\n").map(visibleWidth)),
      ),
    ),
  );
  const result = [...minimum];
  const weights = [3, 1, 2, 4, 1, 1, 1, 1, 6];
  let remaining = budget - result.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    const candidates = result.map((value, column) => ({
      column,
      score:
        value < natural[column]!
          ? weights[column]! / Math.max(1, value - minimum[column]! + 1)
          : 0,
    }));
    candidates.sort(
      (left, right) => right.score - left.score || left.column - right.column,
    );
    if (!candidates[0]?.score) break;
    result[candidates[0].column]!++;
    remaining--;
  }
  return result;
}

function renderTable(
  parsed: ParsedPreview,
  width: number,
  theme: MarkdownTheme,
): string[] {
  const widths = columnWidths(parsed, width);
  if (!widths) {
    // Small terminals retain every field in readable blocks instead of clipping a table.
    return parsed.rows.flatMap((row, index) => [
      ...wrapTextWithAnsi(`${index + 1}.`, width),
      ...parsed.headers.flatMap((header, column) =>
        wrapTextWithAnsi(`${header}: ${row[column] || ""}`, width),
      ),
      "",
    ]);
  }
  const border = (left: string, middle: string, right: string) =>
    left + widths.map((value) => "─".repeat(value + 2)).join(middle) + right;
  const lines = [border("┌", "┬", "┐")];
  const addRow = (row: string[], header = false) => {
    const wrapped = row.map((value, column) =>
      wrapTextWithAnsi(value, widths[column]!),
    );
    const height = Math.max(1, ...wrapped.map((value) => value.length));
    for (let line = 0; line < height; line++) {
      const cells = wrapped.map((value, column) => {
        const text = value[line] || "";
        const padded =
          text + " ".repeat(Math.max(0, widths[column]! - visibleWidth(text)));
        return header ? theme.bold(padded) : padded;
      });
      lines.push(`│ ${cells.join(" │ ")} │`);
    }
  };
  addRow(parsed.headers, true);
  if (parsed.rows.length) lines.push(border("├", "┼", "┤"));
  for (const [index, row] of parsed.rows.entries()) {
    addRow(row);
    if (index < parsed.rows.length - 1) lines.push(border("├", "┼", "┤"));
  }
  lines.push(border("└", "┴", "┘"));
  return lines;
}

/** Public pi-tui components only; no installed renderer mutation or private API. */
export function createTimeLogPreviewComponent(
  preview: string,
  theme: MarkdownTheme | Theme,
): Component {
  const parsed = parsePreview(preview);
  const resolvedTheme = markdownTheme(theme);
  const markdown = (text: string, width: number) =>
    new Markdown(text, 0, 0, resolvedTheme, undefined, {
      renderLatex: false,
    }).render(width);
  return {
    invalidate() {},
    render(width) {
      if (!parsed) return markdown(preview, width);
      // These generated metadata paragraphs need literal names and source IDs.
      // Text avoids native Markdown retaining escapes on continuation lines.
      const metadata = (text: string) =>
        new Text(unescapeMarkdown(text), 0, 0).render(width);
      return [
        ...metadata(parsed.before),
        ...renderTable(parsed, width, resolvedTheme),
        ...metadata(parsed.after),
      ];
    },
  };
}

export function createTimeLogPreviewDialog(
  preview: string,
  theme: MarkdownTheme,
  viewport: { rows: () => number; requestRender?: () => void },
  done: (confirmed: boolean) => void,
): Component {
  const content = createTimeLogPreviewComponent(preview, theme);
  let offset = 0,
    height = 1,
    total = 0,
    closed = false;
  const move = (amount: number) => {
    offset = Math.max(
      0,
      Math.min(Math.max(0, total - height), offset + amount),
    );
    viewport.requestRender?.();
  };
  return {
    invalidate() {
      content.invalidate();
    },
    render(width) {
      const lines = content.render(width);
      total = lines.length;
      const title = wrapTextWithAnsi(theme.bold("시간로그 저장 확인"), width);
      const keys = wrapTextWithAnsi(
        "Enter 저장 | Esc 취소 | ↑/↓ 이동 | PgUp/PgDn 페이지 | Home/End",
        width,
      );
      height = Math.max(
        1,
        Math.floor(viewport.rows()) - title.length - keys.length - 3,
      );
      offset = Math.max(0, Math.min(offset, Math.max(0, total - height)));
      const view = lines.slice(offset, offset + height);
      const status = `보기: ${total ? offset + 1 : 0}-${Math.min(total, offset + height)}/${total}줄`;
      return [
        ...title,
        "",
        ...view,
        "",
        ...keys,
        ...wrapTextWithAnsi(status, width),
      ];
    },
    handleInput(data) {
      if (closed) return;
      if (matchesKey(data, Key.enter)) {
        closed = true;
        done(true);
      } else if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c"))
      ) {
        closed = true;
        done(false);
      } else if (matchesKey(data, Key.down)) move(1);
      else if (matchesKey(data, Key.up)) move(-1);
      else if (matchesKey(data, Key.pageDown)) move(height);
      else if (matchesKey(data, Key.pageUp)) move(-height);
      else if (matchesKey(data, Key.home)) move(-total);
      else if (matchesKey(data, Key.end)) move(total);
    },
  };
}

function markdownTheme(theme: any): MarkdownTheme {
  if (typeof theme?.heading === "function") return theme;
  const fg = (color: string) => (text: string) =>
    typeof theme?.fg === "function" ? theme.fg(color, text) : text;
  const style = (name: string) => (text: string) =>
    typeof theme?.[name] === "function" ? theme[name](text) : text;
  return {
    heading: fg("mdHeading"),
    link: fg("mdLink"),
    linkUrl: fg("mdLinkUrl"),
    code: fg("mdCode"),
    codeBlock: fg("mdCodeBlock"),
    codeBlockBorder: fg("mdCodeBlockBorder"),
    quote: fg("mdQuote"),
    quoteBorder: fg("mdQuoteBorder"),
    hr: fg("mdHr"),
    listBullet: fg("mdListBullet"),
    bold: style("bold"),
    italic: style("italic"),
    underline: style("underline"),
    strikethrough: style("strikethrough"),
  };
}

/** In TUI mode the scrollable table is displayed before any save decision. */
export async function confirmTimeLogPreview(
  ctx: any,
  preview: string,
): Promise<boolean> {
  if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
    return ctx.ui.custom(
      (
        tui: any,
        theme: any,
        _keybindings: any,
        done: (confirmed: boolean) => void,
      ) =>
        createTimeLogPreviewDialog(
          preview,
          markdownTheme(theme),
          {
            rows: () => Math.max(6, Number(tui.terminal.rows) || 24),
            requestRender: () => tui.requestRender(),
          },
          done,
        ),
    );
  }
  return ctx.ui.confirm(
    "시간로그 실제 저장",
    `${timeLogPreviewPlainText(preview)}\n\n저장하시겠습니까?`,
  );
}
