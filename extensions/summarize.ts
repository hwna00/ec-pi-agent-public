import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { complete, getModel } from '@earendil-works/pi-ai/compat';
import type {
	CompactionEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { DynamicBorder, getMarkdownTheme } from '@earendil-works/pi-coding-agent';
import { Container, Markdown, matchesKey, Text } from '@earendil-works/pi-tui';
import { getCurrentSessionLabel, getCurrentSessionName, parseSessionName, type SessionLabel } from './session-label-editor.ts';

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

const SUMMARY_DIR = resolve(process.cwd(), '.pi', 'memory', 'short-term');

const extractTextParts = (content: unknown): string[] => {
	if (typeof content === 'string') {
		return [content];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	const textParts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}

		const block = part as ContentBlock;
		if (block.type === 'text' && typeof block.text === 'string') {
			textParts.push(block.text);
		}
	}

	return textParts;
};

const extractToolCallLines = (content: unknown): string[] => {
	if (!Array.isArray(content)) {
		return [];
	}

	const toolCalls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}

		const block = part as ContentBlock;
		if (block.type !== 'toolCall' || typeof block.name !== 'string') {
			continue;
		}

		const args = block.arguments ?? {};
		toolCalls.push(`Tool ${block.name} was called with args ${JSON.stringify(args)}`);
	}

	return toolCalls;
};

type SummaryContext = {
	compactionSummary?: string;
	activeEntries: SessionEntry[];
	usedBoundaryFallback: boolean;
};

type ConversationTextResult = {
	text: string;
	usedBoundaryFallback: boolean;
};

export const selectSummaryContext = (entries: SessionEntry[]): SummaryContext => {
	let latestCompactionIndex = -1;
	let latestCompaction: CompactionEntry | undefined;

	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type === 'compaction') {
			latestCompactionIndex = index;
			latestCompaction = entry;
			break;
		}
	}

	if (!latestCompaction) {
		return {
			activeEntries: entries,
			usedBoundaryFallback: false,
		};
	}

	const firstKeptEntryIndex = entries.findIndex((entry) => entry.id === latestCompaction.firstKeptEntryId);
	const boundaryFound = firstKeptEntryIndex >= 0;
	const activeEntries = boundaryFound ? entries.slice(firstKeptEntryIndex) : entries.slice(latestCompactionIndex + 1);

	return {
		compactionSummary: latestCompaction.summary,
		activeEntries,
		usedBoundaryFallback: !boundaryFound,
	};
};

export const serializeConversationEntries = (entries: SessionEntry[]): string => {
	const sections: string[] = [];

	for (const entry of entries) {
		if (entry.type !== 'message') {
			continue;
		}

		const message = entry.message;
		if (message.role !== 'user' && message.role !== 'assistant') {
			continue;
		}

		const role = message.role;
		const isUser = role === 'user';
		const isAssistant = role === 'assistant';

		const entryLines: string[] = [];
		const textParts = extractTextParts(message.content);
		if (textParts.length > 0) {
			const roleLabel = isUser ? 'User' : 'Assistant';
			const messageText = textParts.join('\n').trim();
			if (messageText.length > 0) {
				entryLines.push(`${roleLabel}: ${messageText}`);
			}
		}

		if (isAssistant) {
			entryLines.push(...extractToolCallLines(message.content));
		}

		if (entryLines.length > 0) {
			sections.push(entryLines.join('\n'));
		}
	}

	return sections.join('\n\n');
};

export const buildConversationText = (entries: SessionEntry[]): ConversationTextResult => {
	const { compactionSummary, activeEntries, usedBoundaryFallback } = selectSummaryContext(entries);
	const sections: string[] = [];
	const normalizedCompactionSummary = compactionSummary?.trim();

	if (normalizedCompactionSummary) {
		sections.push(`[Latest Compaction Summary]\n${normalizedCompactionSummary}`);
	}

	const activeConversation = serializeConversationEntries(activeEntries);
	if (activeConversation) {
		sections.push(`[Active Conversation Context]\n${activeConversation}`);
	}

	return {
		text: sections.join('\n\n'),
		usedBoundaryFallback,
	};
};

type SummaryMode = 'wiki' | 'tp';

type WikiSummaryMetadata = {
	sessionId: string;
	date: string;
};

const formatLocalDate = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export const buildWikiSummaryPrompt = (
  conversationText: string,
  metadata: WikiSummaryMetadata,
): string => `대화 세션에서 작업한 내용을 기억으로 변환한다.
용어들은 가능한 원문의 용어를 그대로 사용한다.

## "기억"해야 하는 데이터
- 사실로 확인된 논리적 개념
- 문제의 원인과 해결 방법의 관계
- 문제의 해결과정에서 핵심적으로 작용한 개념 및 용어, 그리고 그들 간의 관계
- 어떤 데이터가 DB의 어느 테이블에 저장되는지
  
### 예시
- 모델 Definition은 model_relation_info 의 정보를 바탕으로 생성된다.
- 업무설정된 항목의 데이터는 XXX 테이블에 저장된다.
- relation 항목 —[평탄화한다]→ 상세 검색 모델 속성
- 복수의 검색 조건 —[결합된다]→ AND 조건

## "망각"해도 되는 데이터
- 실제로 DB, 파일 등을 읽어서 알게된 정보
- 변수명, 함수명, 파일 이름과 같은 구체적인 코드 구현
- 문제의 해결과 연관이 적은 정보
  
### 예시
- 문제를 해결하며 알게된 정보를 엑셀 파일로 정리했다.
- DB의 XXX 테이블에 저장된 전표의 sid 는 AAABBBCCC 이다.
- 견적전표를 저장할 때는 InsertDac.ts를 호출한다.
- $details —[평탄화한다]→ 상세 검색 모델 속성
- 복수의 inv_s$data_dt 조건 —[결합된다]→ AND 조건

## 추출 가이드

아래의 레이어에 따라 데이터를 추출한다.
아래 Markdown 구조만 출력한다. 설명, 머리말, 코드 펜스는 문서 바깥에 추가하지 않는다.

\`\`\`md
---
title: "{{문서 주제를 나타내는 제목}}"
session_id: "${metadata.sessionId}"
date: "${metadata.date}"
---

## 개요
// 이번 작업에서 다룬 문제 또는 기능과 최종 결과를 짧게 설명한다.

## Terms
// 세션 대화 기록에서 메모리에 추가될 수 있는 용어 후보를 추출한다.

## Synonyms
// 유사한 의미를 가진 단어들끼리의 집합을 생성한다.

## Concepts
// 추출한 용어들을 하나의 클래스로 묶어 정의한다.

## Taxonomy
// 개념간 IS-A 계층을 정의한다.

## Relations
// 개념 간 비분류 관계 + 라벨을 부여한다.

## Rules
// 논리적 제약, 추론 규칙을 설정한다.
\`\`\`


<conversation>
${conversationText}
</conversation>`;

const buildTpSummaryPrompt = (conversationText: string): string => `다음 대화에서 오류 분석과 수정 내용을 추출하세요.
- 대화에서 확인된 내용만 작성하고, 확인되지 않은 원인이나 수정 결과를 만들어내지 마세요.
- 파일 경로와 심볼 이름은 원문 그대로 유지하세요.
- 파일이 여러 개면 "파일(경로포함) / as-is / to-be" 구성을 파일별로 반복하세요.
- 실제 코드 변경이 없으면 "수정 없음"이라고 작성하세요.
- 원인이 확정되지 않았다면 "미확정"이라고 표시하고 확인된 후보만 작성하세요.
- 각 항목을 생략하지 말고, 반드시 아래 구조만 사용하세요.

"""
[오류분류]
# 모델 | 검색 | Definition | 업무설정 | ...
# 간단한 명사형으로 작성

[오류원인]

[수정방향]
# 실제로 수정한 내용 작성

[수정내용(파일별)]

파일(경로포함)

as-is
# 변경 전 코드 블럭만 작성할 것.

to-be
# 변경 후 코드 블럭만 작성할 것.

[개선필요성]
# 구조적인 개선이 필요한 경우에만 작성. 꼭 필요한 경우에만 작성. 없다면 빈칸으로
"""

<conversation>
${conversationText}
</conversation>`;

const buildSummaryPrompt = (conversationText: string, mode: SummaryMode, wikiMetadata: WikiSummaryMetadata): string =>
	mode === 'tp' ? buildTpSummaryPrompt(conversationText) : buildWikiSummaryPrompt(conversationText, wikiMetadata);

const sanitizeFileName = (value: string): string => {
	const sanitized = value
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/[. ]+$/g, '')
		.trim();

	if (!sanitized) {
		throw new Error('세션 이름으로 파일명을 만들 수 없습니다.');
	}

	return sanitized;
};

const saveSummary = (summary: string, sessionLabel: SessionLabel): string => {
	mkdirSync(SUMMARY_DIR, { recursive: true });

	const { category, title } = sessionLabel;
	if (!title) {
		throw new Error('세션 제목이 없어 요약을 저장할 수 없습니다.');
	}

	const fileName = sanitizeFileName(category === 'default' ? title : `${category}_${title}`);
	const filePath = join(SUMMARY_DIR, `${fileName}.md`);

	writeFileSync(filePath, `${summary.trim()}\n`, 'utf8');
	return filePath;
};

const showSummaryUi = async (summary: string, ctx: ExtensionCommandContext) => {
	if (ctx.mode !== 'tui') {
		return;
	}

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = new DynamicBorder((s: string) => theme.fg('accent', s));
		const mdTheme = getMarkdownTheme();

		container.addChild(border);
		container.addChild(new Text(theme.fg('accent', theme.bold('Conversation Summary')), 1, 0));
		container.addChild(new Markdown(summary, 1, 1, mdTheme));
		container.addChild(new Text(theme.fg('dim', 'Press Enter or Esc to close'), 1, 0));
		container.addChild(border);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, 'enter') || matchesKey(data, 'escape')) {
					done(undefined);
				}
			},
		};
	});
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand('summarize', {
		description: 'Summarize the current conversation and save it to short-term memory',
		handler: async (args, ctx) => {
			const mode: SummaryMode = args.trim().split(/\s+/).includes('--tp') ? 'tp' : 'wiki';
			const branch = ctx.sessionManager.getBranch();
			const { text: conversationText, usedBoundaryFallback } = buildConversationText(branch);

			if (usedBoundaryFallback && ctx.hasUI) {
				ctx.ui.notify('Compaction boundary not found; using messages after the latest compaction', 'warning');
			}

			if (!conversationText.trim()) {
				if (ctx.hasUI) {
					ctx.ui.notify('No conversation text found', 'warning');
				}
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify('Preparing summary...', 'info');
			}

			const model = getModel('openai-codex', 'gpt-5.6-sol');
			if (!model && ctx.hasUI) {
				ctx.ui.notify('Model openai-codex/gpt-5.6-sol not found', 'warning');
			}

			const auth = model ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
			if (auth && !auth.ok && ctx.hasUI) {
				ctx.ui.notify(auth.error, 'warning');
			}
			if (auth?.ok && !auth.apiKey && ctx.hasUI) {
				ctx.ui.notify('No API key for openai-codex/gpt-5.6-sol', 'warning');
			}

			if (!model || !auth?.ok || !auth.apiKey) {
				return;
			}

			const summaryMessages = [
				{
					role: 'user' as const,
					content: [
						{
							type: 'text' as const,
							text: buildSummaryPrompt(conversationText, mode, {
								sessionId: ctx.sessionManager.getSessionId(),
								date: formatLocalDate(new Date()),
							}),
						},
					],
					timestamp: Date.now(),
				},
			];

			const response = await complete(
				model,
				{ messages: summaryMessages },
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					env: auth.env,
					reasoningEffort: 'low',
				}
			);

			const summary = response.content
				.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
				.map((c) => c.text)
				.join('\n');

			if (mode === 'tp') {
				await showSummaryUi(summary, ctx);
				return;
			}

			const labelEntries = ctx.sessionManager.getBranch();
			const sessionName = getCurrentSessionName(labelEntries);
			const storedLabel = getCurrentSessionLabel(labelEntries);
			const legacyLabel = sessionName?.trim()
				? (() => {
						const parsed = parseSessionName(sessionName);
						return {
							category: parsed.category ?? 'default',
							title: parsed.title,
						} satisfies SessionLabel;
				  })()
				: undefined;
			const sessionLabel = storedLabel ?? legacyLabel;
			if (!sessionLabel?.title) {
				throw new Error('세션 제목이 없어 요약을 저장할 수 없습니다.');
			}

			const savedPath = saveSummary(summary, sessionLabel);
			await showSummaryUi(summary, ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(savedPath, 'info');
			}
		},
	});
}
