# 게시글 수집

수집기는 `.pi/lib/ec-context`의 TypeScript 모듈로 통합했다. Python 수집기와 CLI는 제거했다.

- [사용법과 브라우저 연결](../../lib/ec-context/README.md)
- [파일 구조·명령·저장 규칙](CONTEXT_GRAPH.md)
- [이전 실서버 검증 기록](VALIDATION.md)

`tests/fixtures`와 `.local`의 캡처는 검증 자료다.

```sh
npm ci --prefix .pi/lib/ec-context
npm run check --prefix .pi/lib/ec-context
npm test --prefix .pi/lib/ec-context
node .pi/lib/ec-context/context-cli.ts --store-dir .pi/context collect dev:12345
node .pi/lib/ec-context/context-cli.ts --store-dir .pi/context --entry dev:12345 describe
```
