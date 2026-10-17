import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { piRoot } from "./transport.ts";
import { runReader } from "./reader.ts";
import { contextDirectory, readJSON } from "./session.ts";
import type { ContextSummary, WorkspaceStore } from "./workspace.ts";

export type ContextDescription = Awaited<
  ReturnType<WorkspaceStore["describe"]>
>;
export type ContextRead = (args: string[]) => Promise<string>;

const categories = [
  { name: "기획", types: ["plan"] },
  { name: "개발", types: ["dev"] },
  { name: "오류 수정", types: ["tp", "dp"] },
  { name: "회의록", types: ["meeting"] },
  { name: "방향결정", types: ["decision"] },
  { name: "개발본부 Hub", types: ["hub"] },
  { name: "작업 자체", types: ["job"] },
];
const defaultChoice = "Default (라벨 없음)";
const noJob = "연결 작업 없는 게시글";
const allSessions = "전체 연결 세션";
const labelText = (value: string) =>
  stripVTControlCharacters(value)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface ContextTarget {
  jobKey: string | null;
  entryKey?: string;
}

export function readLocalContext(ctx, args: string[]): Promise<string> {
  const config = readJSON(
    process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
    {},
  );
  return runReader(contextDirectory(ctx, config), args, undefined, {
    workspace: true,
  });
}

export async function chooseContextTarget(
  ctx,
  stored: ContextSummary[],
  options: { allowDefault?: boolean; allowAllSessions?: boolean } = {},
): Promise<ContextTarget | null | undefined> {
  if (!stored.length && !options.allowDefault) {
    ctx.ui.notify("수집된 작업 또는 게시글이 없습니다.", "info");
    return;
  }
  const jobs = [...new Set(stored.map((p) => p.jobKey).filter(Boolean))]
    .map((jobKey) => {
      const job =
        stored.find((p) => p.key === jobKey) ||
        stored.find((p) => p.jobKey === jobKey)!;
      return {
        jobKey,
        label: labelText(
          `${job.projectCode ? `[${job.projectCode}] ` : ""}JOB ${jobKey!.slice(4)} | ${job.projectTitle || job.title}`,
        ),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
  const selectedJob = await ctx.ui.select("작업", [
    ...(options.allowDefault ? [defaultChoice] : []),
    ...jobs.map((job) => job.label),
    ...(stored.some((p) => !p.jobKey) ? [noJob] : []),
  ]);
  if (selectedJob === undefined) return;
  if (selectedJob === defaultChoice) return null;
  const jobKey =
    selectedJob === noJob
      ? null
      : jobs.find((job) => job.label === selectedJob)?.jobKey;
  if (jobKey === undefined) return;
  const posts = stored.filter((p) => p.jobKey === jobKey);
  const available = categories.filter((c) =>
    posts.some((p) => c.types.includes(p.type)),
  );
  const category = await ctx.ui.select("작업 종류", [
    ...(options.allowAllSessions && jobKey ? [allSessions] : []),
    ...available.map((c) => c.name),
  ]);
  if (category === undefined) return;
  if (category === allSessions) return { jobKey };
  const group = available.find((c) => c.name === category);
  if (!group) return;
  const candidates = posts.filter((p) => group.types.includes(p.type));
  const labels = candidates.map((p) =>
    labelText(`${p.type.toUpperCase()} ${p.number} | ${p.title}`),
  );
  const selected = await ctx.ui.select("게시글", labels);
  if (selected === undefined) return;
  const post = candidates[labels.indexOf(selected)];
  if (post) return { jobKey, entryKey: post.key };
}

export async function chooseContext(
  ctx,
  read: ContextRead = (args) => readLocalContext(ctx, args),
): Promise<ContextDescription | null | undefined> {
  const stored: ContextSummary[] = JSON.parse(await read(["list-contexts"]));
  const target = await chooseContextTarget(ctx, stored, { allowDefault: true });
  if (!target) return target;
  return JSON.parse(await read(["apply", target.entryKey!]));
}

export function applyContext(pi, _ctx, context: ContextDescription) {
  pi.appendEntry("ec-context-session", {
    version: 4,
    entryKey: context.entryKey,
    jobKey: context.jobKey,
  });
  pi.appendEntry("session-label", {
    category: context.type,
    title: context.title,
    entryKey: context.entryKey,
    jobKey: context.jobKey,
    number: context.number,
    projectCode: context.projectCode,
    projectTitle: context.projectTitle,
  });
  pi.setSessionName(
    `${context.projectCode ? `[${context.projectCode}] ` : ""}${context.type.toUpperCase()} ${context.number} | ${context.title}`,
  );
}

export function clearContext(pi, _ctx) {
  pi.appendEntry("ec-context-session", {
    version: 4,
    entryKey: null,
    jobKey: null,
  });
  pi.appendEntry("session-label", { category: "default", title: "" });
  pi.setSessionName("");
}
