import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function memoryExtension(pi: ExtensionAPI) {
	pi.registerCommand('memory', {
		description: '현재 작업과 관련된 short-term memory 검색',
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify('Agent 작업이 끝난 후 실행하세요.', 'warning');
				return;
			}

			const query = args.trim() || '현재 대화에서 /memory 호출 직전까지 작업하던 내용';
			pi.sendUserMessage(
				[
					'사용자가 /memory를 직접 호출했다.',
					'.pi/skills/memory/SKILL.md를 읽고 해당 절차를 실행하라.',
					`검색 질문(JSON): ${JSON.stringify(query)}`,
					`현재 세션 ID: ${ctx.sessionManager.getSessionId()}`,
				].join('\n'),
			);
		},
	});
}
