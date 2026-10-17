# 설계, 구현 검증 — 2026-10-17

아래 내용은 검토 당시의 구조와 검증 기록이다. 현재 main 병합 검증은 마지막 절에 기록했다.

비교 기준: `main`과 `origin/main`의 `1bd80bc`. 원격 fetch로 일치를 확인했다.
작업 브랜치: `codex/design-quality-audit`.
기존 검증 기준 `d0ec029` 이후 3개 커밋을 작업 브랜치에 병합했다(`5764f07`).
원본 main의 파일과 브랜치는 변경하지 않았다.

활성 Extension, 컨텍스트 런타임, 시간 기록, 세션 RAG, VS Code 연동, 실행 스크립트를 검토했다.
새 시간 기록, 테스트 탭, Git 전환 기능을 포함한다. main에서 변경되지 않은 기존 수정도 다시 확인했다.
현재 main 대비 운영 TypeScript 코드는 **107줄 감소**했다. 테스트와 문서는 이 수치에서 제외했다.
새 프레임워크와 패키지는 추가하지 않았다. main의 lock에 있는 `yaml@2.9.0`만 작업트리에 보완했다.

| 원칙 | 적용과 보존한 경계 |
|---|---|
| 중복 제거 | MCP 응답 해석, 연결 검증, 검색 후보 검증, 빈 디렉터리 정리, 저장 잠금 소유자 검사를 기존 함수로 통합 |
| 과도한 오류 처리 제거 | 세션 그래프는 입력 때 전체 검증하고 내부 탐색의 반복 검사를 제거. 잠금은 `wx/EEXIST`로 원자적으로 확인 |
| OCP | 분류 목록에서 타입, 파서, 도움말을 생성. main의 새 `plan` 분류도 목록에 반영. 기존 서비스 주입과 수집 인터페이스 유지 |
| YAGNI | 미사용 세션 경로 함수, `workspace` 옵션, `listDevelopments` 분기, 시간 기록 `host` 옵션, 미사용 인자, 단일 입력의 배치 임베딩 구조 제거 |

취소, 세션 전환, 원본 해시, 부분 수집, 저장 복구, 승인 후 재조회와 중복 저장 방지는 유지했다.
도구 오류와 실제 연결 실패를 구분하는 작은 오류 타입만 추가했다.

| 확인한 결함 | 수정 결과 |
|---|---|
| MCP 탭 선택 실패 후 잘못된 ID 유지 | 선택 성공 후에만 갱신. main의 새 탭 선택 갱신도 유지 |
| 테스트 탭의 일반 MCP 오류를 연결 단절로 처리 | 정상 연결과 요청 핸들을 유지. 실제 단절 때만 해제 |
| 시간 기록 생성 응답의 최상위 `Error/Errors` 무시 | 실패로 판정. 저장 여부 불명 상태와 자동 재전송 금지 유지 |
| PL 연결의 중첩, 평면 값 충돌 무시 | 이름, SID, 업무 충돌을 거부. 정상 캡처와 충돌 캡처가 함께 있어도 이름은 빈칸 |
| 요약 입력의 환경변수 API 토큰, JSON `apiToken` 노출 | 기존 가림 규칙에 해당 키를 추가 |
| 시간 기록 미리보기와 세션 제목의 터미널 제어문자 | 표준 제거 함수를 재사용. 미리보기의 여러 줄 비고 유지 |
| HTTP 401을 입력 길이 오류로 오인해 7회 재시도 | 401, 403, 429는 분할 재시도 없이 종료 |
| VS Code 직접 입력과 파일 입력의 연결 검사 불일치 | 동일한 URL, 토큰 검증 적용. JSON `null`도 설정 오류로 처리 |

RAG 임계값은 현재 코드의 `0.59`를 유지하고 오래된 문서, 경계 테스트를 맞췄다.
첨부 순서 테스트는 실제 정렬 계약에 맞췄다. `/load-context` 설명도 현재 자동 적용 동작에 맞췄다.

| 위치 | 검증 명령 | 결과 |
|---|---|---|
| `lib/ec-context` | `npm test` | 387 통과, 네이티브 Chrome 1 기본 제외 |
| `lib/ec-context` | `npm run check` | 통과 |
| 저장소 루트 | `node --import ./lib/time-log/tests/no-network.ts --test lib/time-log/tests/*.test.ts` | 254 통과 |
| 저장소 루트 | `node node_modules/typescript/bin/tsc -p lib/time-log/tsconfig.json` | 통과 |
| `extensions/pi-session-rag` | `npm test && npm run typecheck` | 83 통과, 타입 검사 통과 |
| `extensions/pi-vscode` | `npm test` | 15 통과, 타입 검사, 빌드, 실제 Pi 로더 통과 |
| 저장소 루트 | `node --test scripts/gco-branches.test.mjs scripts/session-rag-batch.test.mjs` | 30 통과 |
| `lib/ec-context` | `EC_DOWNLOAD_NATIVE_TEST=1 node --test --test-name-pattern='native Chrome' tests/download.test.ts` | 2 통과. 기본 제외 테스트 포함 |
| `lib/ec-context` | `RESEND_MCP_PATH=<resend 빌드 파일> npm run test:browser` | 실제 Chrome, MCP 통합 1 통과 |

중복 실행을 제외한 **771개 테스트가 통과**했다. 추가 표적 테스트는 이 수치에 중복 합산하지 않았다.
Chrome 검증은 임시 프로필과 로컬 HTTP 서버를 사용했다.
재전송 접수 뒤 네트워크 조회로 HTTP 200, 본문, 쿠키 일치, 탭 복원과 세션 분리를 확인했다.
시간 기록 테스트는 네트워크, 자식 프로세스를 차단하고 주입한 가짜 서비스만 사용했다.

ContextGraph, 세션 라벨, GCO, PG 전환 Extension도 별도로 TypeScript 검사했다.
공개 내보내기와 Git 스크립트 구문, `git diff --check`도 통과했다.
수정 전 실패 재현과 독립 교차 검토로 동작 경계와 필요한 오류 처리의 보존을 확인했다.

검증 환경은 macOS와 Node 26.0.0이다. 컨텍스트, 시간 기록은 Pi 0.87.1, VS Code 로더는 Pi 1.0.0을 사용했다.
실제 ERP 저장, 로그인, Cloudflare, MongoDB, 모델 호출, Windows 디버거, VS Code GUI, 공개 게시 작업은 실행하지 않았다.
비활성 실험 코드와 과거 분석, 세션, 캐시 산출물은 활성 런타임 검증 대상이 아니다.
이전 설치에서 보고된 개발용 Pi 1.0.0의 `brace-expansion@5.0.9` 보안 항목은 이번에 갱신, 재현하지 않았다.
해당 의존성은 VS Code 배포 번들에 포함되지 않는다.


## main 병합 검증, 2026-10-18

`90de3b8` 기준으로 `codex/design-quality-audit`를 병합했다.
현재 Extension 폴더 구조에 맞춰 충돌 난 import 경로를 수정했다.
최신 포트폴리오 README와 이미지 구성을 유지했다.
main에서 삭제한 이전 MCP 재생 테스트는 복구하지 않았다.
첨부파일 순서 테스트는 현재 main의 계약을 유지했다.

| 검증 | 결과 |
|---|---|
| ContextGraph 테스트, 타입 검사 | 345 통과, 네이티브 Chrome 1개 기본 제외, 타입 검사 통과 |
| 시간 로그 테스트, 타입 검사 | 261 통과, 타입 검사 통과 |
| 세션 RAG 테스트, 타입 검사 | 83 통과, 타입 검사 통과 |
| RAG 일괄 처리 테스트 | 10 통과 |
| VS Code 연동 테스트 | 15 통과, 타입 검사, 빌드, Pi 로더 통과 |
| 공통 Extension 테스트 | 49 통과, 선택 실행용 3개 제외 |
| Git 전환 테스트 | 20 통과 |
| 네이티브 Chrome 다운로드 표적 테스트 | 2 통과, 기본 제외 테스트 포함 |
| Chrome과 MCP 통합 테스트 | 1 통과, 재전송 결과와 세션 분리 확인 |

로컬 HTTP 서버가 필요한 테스트는 실행 권한을 확보해 재실행했다.
실제 ERP 저장, 외부 모델, Cloudflare, MongoDB, Windows 디버거와 VS Code GUI 검증은 실행하지 않았다.
