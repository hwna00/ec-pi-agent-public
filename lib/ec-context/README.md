# ECOUNT Context Pi extension

프로젝트의 `.pi/extensions/context-graph.ts`가 자동 로드된다. `/load-context`로 수집하고 `/apply-context`로 세션에 적용한다. 기존 `tp-context`와 수동 `/tp` 명령은 제거했으며 세션의 `tp.md`는 자동으로 만들거나 주입하지 않는다.

## 설치 및 사용

Node 22.19 이상과 Chrome이 필요하다. 수집·HTML 파싱·그래프·저장·다운로드는 모두 TypeScript로 실행한다. Chrome 경로는 `executablePath`로 지정할 수 있다. `localMcpPath`를 생략하면 설치된 `chrome-devtools-mcp`를 사용한다.

```sh
npm ci --prefix .pi/lib/ec-context
```

Pi에서 `/reload` 후 새 세션을 만들고 작업 → 유형 → 게시글을 선택한다. 작업은 `[프로젝트 코드] JOB 번호 | 작업 제목`으로 표시한다. 선택한 게시글은 바로 적용되며 첫 모델 요청부터 게시글 정보, 작업 디렉터리 기준 상대 경로, 선택한 작업의 폴더 구조, Markdown 스키마 설명을 자동 주입한다. `/apply-context`나 `/add-context`를 추가로 실행할 필요는 없다. `Default (라벨 없음)`을 고르면 맥락 안내를 주입하지 않는다. 이후 `/apply-context`로 저장한 맥락을 적용할 수 있다.

새 자료를 수집하거나 현재 세션의 선택을 바꿀 때는 다음 명령을 사용한다.

```text
/ec-connect
/load-context tp:26128
/load-context dev 22643
/apply-context
/apply-context dev:22643
/test-server
/test-server test
/test-server --edit
```

- `/ec-connect`: Chrome DevTools MCP `autoConnect`로 기존 Chrome의 로그인된 ERP 탭을 찾는다. Chrome 144 이상에서 `chrome://inspect/#remote-debugging`을 활성화하고 Chrome의 연결 허용 창을 승인해야 한다. 한 탭이면 인증 API로 검증하고 연결한다. 여러 탭이면 브라우저 ID·탭 ID·호스트·제목으로 선택한다.
- 로그인된 탭이 없으면 연결 가능한 브라우저에 새 로그인 탭을 만든다. Chrome에 연결할 수 없으면 Playwright MCP가 별도 프로필의 보이는 Chrome을 실행한다. 회사코드·ID·마스킹 비밀번호를 입력받아 자동 로그인하고 인증 API 검증 후 연결한다. 계정은 프로젝트 공용 `.pi/.local/ec-account.json`에 평문으로 저장하며 파일 권한은 `0600`, Git에서는 제외한다. 다른 Pi 세션에서도 재사용한다. `/ec-connect --edit`로 계정을 수정한다 (이미 로그인된 탭의 계정을 전환하거나 로그아웃하지는 않는다). 추가 인증이나 로그인 오류는 브라우저에서 확인하고 완료 후 `/ec-connect`를 다시 실행한다. 자동 제출은 한 번만 한다. 로그인 페이지에는 `__disableMin`을 넣지 않는다. 로그인 후 ERP 화면과 API 요청에는 `__disableMin=Y`를 강제한다. 연결 시에도 이를 확인하고, 누락되었거나 값이 다르면 기존 쿼리와 해시를 보존한 URL로 실제 재진입한다. 로그인 리다이렉트가 플래그를 제거한 경우에도 `/ec-connect`에서 복구한다.
- `/load-context <type>:<number>` 또는 `<type> <number>`: 공용 저장 루트에 게시글별 Markdown만 수집한다. 실행한 세션의 선택·라벨·이름은 바꾸지 않는다. 본문·추가 본문·답글, 연결 작업, 작업 화면의 관련 목록, 첨부 게시글을 재귀 수집한다. 실행당 같은 글은 한 번 조회한다. 다시 실행하면 서버를 재조회하고 같은 파일을 덮어쓴다.
- `/apply-context [type:number]`: 이미 저장한 게시글을 현재 세션에 적용한다. 인자를 생략하면 작업 → 유형 → 게시글 순서로 선택한다. 재수집·브라우저 연결 없이 로컬 파일과 무결성을 확인한다. `/apply-context default` 또는 선택 화면의 기본값은 적용을 해제하고 라벨 없는 세션으로 바꾼다. 취소하거나 저장 자료 확인에 실패하면 기존 선택을 유지한다. 적용 후 첫 모델 요청부터 게시글 정보, 상대 경로, 선택한 작업의 폴더 구조, Markdown 스키마 설명을 자동 주입한다.
- `tp` 테스트오류수정, `hub` 개발본부 Hub, `dev` 개발, `dp` 테스트/배포, `job` 작업. 기존 `decision` 방향결정과 `meeting` 회의도 인식한다. 게시판별 ID와 상세 메뉴 매핑은 `site-api.ts`의 `siteTypes`에 있다.
- `/add-context type:number`: 지정한 글과 관련 범위를 재수집해 저장 자료에 추가한다. 세션의 프롬프트 주입을 시작하는 명령은 아니며 새 세션 선택 후에는 필요 없다. `/update-context`: 현재 시작 글에서 맥락을 다시 수집한다. `/update-context type:number`: 현재 맥락 안의 지정 글과 관련 범위를 재수집한다. 선택한 시작 글은 유지한다. `/collect-context`는 `/load-context`의 별칭이다.
- `/test-server [test|zeus|stage]`: 선택한 TP Markdown의 `test_accounts`를 읽는다. 후보가 여러 개면 선택하고, 빠진 회사코드·ID·비밀번호·서버만 질문한다. 비밀번호 입력은 마스킹한다. 보완한 계정은 같은 원본 후보가 유지되는 동안 재사용한다. TP 재로드로 후보가 바뀌면 최신 후보를 사용한다. 저장한 계정을 수정하려면 `--edit`를 지정한다. `https://{환경}.ecount.com/` 로그인 페이지를 새 탭에 연다. 로그인 성공 후 ERP URL에는 `__disableMin=Y`를 적용한다. 상세 서버명(예: `zeus07lxba1`)은 로그인 화면의 서버 필드에 입력한다. 환경 생략 시 상세 서버명의 접두사로 결정한다. 로그인 성공을 확인하지 못하면 오류를 표시한다.

## 세션과 저장

인증 세션 ID·쿠키를 별도 파일로 내보내지 않는다. 선택한 ERP 탭에서 `fetch(credentials: include)`를 실행하며 HttpOnly 쿠키도 브라우저가 전송한다. 탭을 닫거나 로그아웃하거나 SID가 변경되면 `/ec-connect`로 재연결한다. 브라우저 자체 프로필에는 Chrome의 정책대로 쿠키가 저장된다.

기본 저장 루트는 실행 프로젝트의 `.pi/context/`다. 설정의 `contextDir` 또는 환경 변수 `ECOUNT_CONTEXT_DIR`로 변경할 수 있다. 상대 경로는 Pi의 작업 디렉터리를 기준으로 계산한다.

```text
.pi/context/
├── <프로젝트 코드>/job_<번호>/
│   ├── job_<번호>.md
│   ├── index.md
│   ├── 개발_스프린트/dev_<번호>.md
│   ├── 회의록/meeting_<번호>.md
│   ├── 방향결정/decision_<번호>.md
│   ├── 오류_수정/tp_<번호>.md
│   └── attachments/<유형_번호>/<파일 ID>/<원본 파일명>
├── hub_<번호>/hub_<번호>.md
└── .context/
    ├── catalog.json
    ├── posts/, entries/, captures/
    └── test-accounts/
```

폴더와 Markdown 파일명의 공백은 `_`로 바꾼다. 작업 번호가 없으면 루트의 `<유형>_<번호>/`에 저장한다. 작업 번호만 있고 프로젝트 코드가 없으면 루트의 `job_<번호>/`를 사용한다. 각 글은 자신의 연결 작업 정보로 위치를 결정한다. 다른 글의 작업 정보를 물려받지 않는다. 명령의 `/load-context dev 22643`처럼 공백을 쓰는 번호 입력 문법은 유지한다.

기존 공백 경로는 다음 수집 결과를 저장하기 전에 자동으로 `_` 경로로 변환한다. 읽기·적용만으로는 경로를 변환하지 않는다. 변환 시 관리하는 파일을 이동하고 색인과 Markdown 링크를 함께 갱신한다. 이전 관리 경로는 제거하며 관리하지 않는 파일은 유지한다.

수집 없이 로컬 경로만 변환하려면 `.pi/lib/ec-context/`에서 다음을 실행한다. 브라우저 연결은 필요 없다.

```sh
node context-cli.ts --store-dir ../../context migrate-paths
```

게시글 파일의 공통 프론트매터는 자신의 `type`, 문자열 `number`, `title`이다. `project_code`는 `job` 작업 파일에만 추가한다. TP 파일의 `test_accounts`는 후보별 `server`, `company_code`, `account_id`, `password`를 담고 실제 비밀번호를 보존한다. 연결 작업 번호와 제목은 별도 프론트매터 키로 중복 저장하지 않는다. `index.md`는 `type: index`, `number: null`, 목록의 `title`로 구분한다.

원본 조회·파싱이 성공한 뒤 공유 저장소의 파일을 교체한다. 쓰기는 파일 잠금으로 직렬화한다. 실패하면 기존 정상 파일을 유지한다. 연결 작업이 바뀌면 색인과 들어오는 링크를 갱신한다. 사라진 관계·첨부는 최신 글에서 제외하고 이전 공용 파일은 자동 삭제하지 않는다.

첨부 파일은 기본적으로 다시 다운로드한다. 실제 응답에 URL이 있으면 로그인된 브라우저에서 바이너리로 받는다. URL이 없으면 현재 ERP 탭에 정확한 게시글 팝업과 단일 파일 항목이 열려 있어야 한다. 다른 재귀 글의 팝업이 열려 있지 않으면 `download_failed`로 기록한다. 파일 실패 시 본문은 저장하며 실패 수를 알린다. ZIP은 압축 상태로 보존한다. `downloadAttachments: false`로 다운로드를 끌 수 있다.

원본 게시글 자체에 계정이 적힌 경우 원문 보존 정책에 따라 captures 또는 본문에 포함될 수 있다. 인증 쿠키와 별도로 사용자가 요청한 테스트 계정을 보관하는 구조다.

`ec-context-session` Pi custom entry에는 `version: 4`, 게시글 `entryKey`, 연결 작업 `jobKey`를 기록한다. 적용 해제는 두 키를 `null`로 저장한다. 작업 키는 적용 당시의 관계를 보존한다. 현재 세션의 분기에서 마지막 선택을 복원한다. 공용 활성 포인터는 없다. 수집은 어느 세션에서도 선택·라벨·이름을 변경하지 않는다. 적용 중 세션이 바뀌면 전환한 세션에 적용하지 않는다. Pi 종료 시 수집을 취소하고 MCP 연결을 닫는다. Pi 종료 후에도 계속 실행하는 별도 수집 데몬은 없다. 저장된 자료 조회는 브라우저와 Pi 세션 파일 없이 가능하다.

`session-label-editor.ts`의 새 세션 선택도 같은 로컬 목록을 사용한다. 작업 → 유형(개발, 오류 수정 등) → 게시글 순서로 고르며 기본값을 고르면 라벨 없는 세션을 만든다. 같은 프로젝트 코드에 여러 작업이 있어도 JOB 번호와 작업 제목으로 구분한다. 코드 없는 작업도 번호와 제목으로 표시한다. 연결 작업 없는 글은 별도 선택 항목으로 표시하며 저장 폴더를 새로 만들지 않는다. 입력창 위 테두리에는 선택한 게시글의 유형·번호·제목을 한 줄로 표시한다.

선택을 마치면 세션의 현재 분기에 적용 정보를 기록한다. `before_agent_start`가 첫 모델 요청부터 해당 글의 유형·번호·제목, 상대 경로, 작업의 폴더 구조와 위 프론트매터 스키마를 안내한다. 현재 게시글과 `index.md`를 읽고 관련 게시글·첨부 파일을 확인하도록 설명한다. 본문과 계정 값은 자동으로 복사하지 않는다. Default 세션에는 이 안내가 없으며 `/load-context`를 실행해도 선택이나 주입 상태는 바뀌지 않는다.

```text
─ DEV 23047 | 게시글 제목 ───
```

세션에 저장하는 이름과 `/resume` 목록의 이름은 `[A25_09780] DEV 23047 | 게시글 제목`이다. 프로젝트 코드가 없으면 `DEV 23047 | 게시글 제목`으로 저장한다. 입력창 위에는 앞의 예시처럼 게시글 유형·번호·제목만 표시한다.

하단 footer에는 현재 분기의 `session-label`에서 읽은 프로젝트 코드와 연결 작업 제목을 `[A25_09780] 연결 작업 제목`으로 표시한다. footer 표시는 저장된 세션 이름과 별도로 만든다. `setFooter`에서 기본 footer의 첫 경로·제목 줄만 바꾸고 사용량·모델·상태 줄은 기본 렌더러를 그대로 사용한다. 입력창에 프로젝트 정보나 별도 행은 추가하지 않는다. 테스트 계정이나 본문은 라벨과 프롬프트에 저장하지 않는다.

기존 세션은 재개나 `/reload` 시 자동으로 이름을 바꾸지 않는다. `/apply-context`로 맥락을 다시 적용하면 새 형식의 이름을 저장한다.

`/resume`과 재개 단축키는 `작업별 찾기` 또는 `기존 텍스트 검색` 메뉴를 연다. 기존 검색은 Pi 기본 화면을 그대로 사용한다. 작업별 찾기는 작업 → 유형 → 게시글 → 연결된 세션 순서로 선택하며, 유형 화면의 `전체 연결 세션`으로 해당 작업의 모든 세션을 볼 수 있다. 같은 게시글로 여러 대화가 있어도 마지막 활동 시각과 짧은 세션 ID로 구분한다. 선택한 세션의 제목·현재 연결 게시글·첫 메시지 미리보기를 아래에 표시한다. 대화 본문 검색도 지원한다. 작업별 찾기 화면은 세션 선택만 수행하며 삭제·이름 변경은 기본 검색 화면에서 한다. `/resume-context`로 작업별 찾기에 직접 들어갈 수도 있다.

세션의 과거 게시글 참조도 검색에 포함한다. 재개 시 저장된 마지막 분기를 복원하며, 검색에 사용한 게시글을 다시 적용하지 않는다. 기존 `entryKey` 기록은 현재 저장된 작업 관계로 연결한다. 명시적 키가 없는 오래된 세션은 제목으로 추정하지 않고 기존 텍스트 검색으로 찾는다. 목록 조회는 원본 JSONL을 수정하지 않는다. `.context/session-links.json`은 파일 경로·크기·수정 시각·게시글/작업 키만 담는 재생성 가능한 색인이다. 본문이나 계정 값은 저장하지 않는다. 색인은 추가 관계 파싱을 줄이며, Pi 목록 API는 세션 표시와 검색을 위해 원본 대화 텍스트를 읽는다.

프롬프트는 진행 중인 게시글과 프로젝트·작업을 각각 한 줄로 표시한다. `컨텍스트 저장 루트`는 현재 작업 디렉터리 기준 상대 경로다. 선택한 프로젝트와 작업만 트리에 표시하며 작업 아래에는 `index.md`, `job_<번호>.md`와 유형 폴더까지 보여준다. 유형 폴더의 개별 게시글은 나열하지 않고 파일명 규칙으로 찾는다.

```text
진행중인 작업: 개발 23047 | "게시글 제목"
프로젝트/작업: [A25_09780] "연결 작업 제목"
컨텍스트 저장 루트: .pi/context/A25_09780/job_5511

A25_09780/
└── job_5511/
    ├── index.md
    ├── job_5511.md
    ├── 개발_스프린트/
    ├── 회의록/
    ├── 방향결정/
    └── 오류_수정/
```

`job_<번호>.md`는 작업과 프로젝트 정보, `index.md`는 게시글 목록과 링크다. `개발_스프린트/dev_<번호>.md`는 개발, `회의록/meeting_<번호>.md`는 회의록, `방향결정/decision_<번호>.md`는 방향결정, `오류_수정/tp_<번호>.md`와 `dp_<번호>.md`는 오류 수정·테스트/배포, `개발본부_Hub/hub_<번호>.md`는 Hub다. 첨부 파일은 Markdown 링크로 찾는다. 다른 작업이나 독립 게시글은 관련 링크로 확인한다.

## 여러 브라우저 / 설정

설정 파일은 선택 사항인 `.pi/ec-context.json`이다. 기본은 기존 Chrome autoConnect, 연결할 브라우저가 없으면 Playwright fallback이다. 서로 다른 브라우저 프로필은 각각 CDP endpoint로 지정할 수 있다. 같은 프로필의 여러 창/탭은 한 연결에서 후보로 표시된다.

```json
{
  "contextDir": ".pi/context",
  "downloadAttachments": true,
  "maxNodes": 100,
  "browsers": [
    { "id": "work-chrome", "provider": "chrome" },
    { "id": "debug-browser", "provider": "playwright", "endpoint": "http://127.0.0.1:9222" }
  ]
}
```

Chrome channel은 `stable`, `beta`, `dev`, `canary`를 선택할 수 있다. 등록한 브라우저만 검색하며 임의의 OS 프로필에서 쿠키를 복사하지 않는다. Playwright에 endpoint를 생략하면 별도 관리 프로필을 사용한다.

MCP 서버는 익스텐션 코드가 직접 실행하고 SDK로 호출한다. `reader.ts`가 브라우저 API를 직접 호출하고 TS 모듈로 파싱·수집·저장을 처리한다. Python 프로세스나 stdio 중계는 사용하지 않는다. 프롬프트 생성은 로컬 저장 자료에서 게시글 정보·상대 경로·작업의 폴더 구조를 읽고 파일명 규칙과 Markdown 스키마를 설명한다. 서버 조회·다운로드·본문 주입은 하지 않는다. 필요한 본문은 에이전트가 파일 도구로 읽는다.

## 검증

```sh
node .pi/lib/ec-context/doctor.ts
npm test --prefix .pi/lib/ec-context
npm run check --prefix .pi/lib/ec-context
EC_DOWNLOAD_NATIVE_TEST=1 node --test .pi/lib/ec-context/tests/download.test.ts
node .pi/lib/ec-context/tests/mcp-replay.ts
```

마지막 테스트는 `.local/decision-validation/captures`의 기존 실제 응답을 사용한다. 실제 MCP 두 개와 실제 Chrome에서 응답을 재생해 본문·답글·저장 파일·경로 안내·HttpOnly 쿠키·세션 변경 차단·테스트 로그인 폼을 검증한다. 신규 FORM·LIST 조회와 페이지 분기는 모의 응답으로 검증한다. 다운로드 테스트는 임시 Chrome에서 ZIP 바이트를 확인한다. 실제 ERP의 새 위젯 조회와 파일 다운로드는 아직 검증하지 않았다.

## 구현 파일

- `site-api.ts`: API 응답, Setup 위젯, 페이지, 본문·답글 완전성 확인.
- `posts.ts`: 프로젝트·작업 정보, 첨부 게시글·파일, TP 계정 추출.
- `html.ts`: HTML을 Markdown으로 변환. 원본 HTML은 captures에 보존.
- `graph.ts`: 유형·번호 검증, 재귀 수집, 중복·순환 처리.
- `workspace.ts`: 경로·프론트매터·색인·첨부·잠금·오류 복원.
- `selection.ts`: 로컬 작업·유형·게시글 공통 선택, 세션 적용·해제, 라벨 생성.
- `resume.ts`: `/resume` 입력 처리와 작업별 세션 선택·재개.
- `session-links.ts`: 원본 세션의 게시글 참조 조회와 관계 색인 캐시.
- `reader.ts`: 명령 실행, 취소와 시간 제한. `context-cli.ts`: 독립 CLI.

공식 문서:
- https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect
- https://github.com/microsoft/playwright-mcp

## Pi 브라우저 관리와 resend

책임은 다음처럼 분리되어 있다.

- Chrome DevTools MCP: 공식 도구와 `resend_network_request`. Pi 세션을 알지 못한다.
- `extensions/browser-tools.ts`: Pi에 `resend_poc_*` 도구를 등록한다. 기존 호출 이름을 유지한다.
- `browser-registry.ts`: Chrome 발견·생성·재사용 및 브라우저/세션 기록을 소유한다.
- `browser-session.ts`: 공식 `--wsEndpoint`로 MCP를 실행하고 세션/브라우저별 연결을 공유한다.
- `context-graph.ts`: 실제 Pi sessionId를 전달하고 같은 연결을 사용한다.

MCP 서버에 `browser_session`, `--reuse-existing`, `--browser-session-id` 같은 커스텀 API/옵션을 보내지 않는다. `resend_poc_browser_session`은 Pi가 직접 처리하는 도구다. 기존 pi-mcp-adapter의 resend-poc 등록은 중복을 막기 위해 제거했다. 다른 adapter 서버 설정은 유지한다.

`.pi/ec-context.json`의 `browsers` 배열로 사용할 브라우저를 설정한다. `localMcpPath`는 개발 중 resend 빌드를 지정하는 실행 파일 교체 옵션일 뿐이다. 이 옵션을 생략하면 설치된 공식 `chrome-devtools-mcp`를 사용한다. 공식 버전에 resend가 포함되면 패키지 업데이트와 이 경로 제거만으로 전환할 수 있다. 설치된 공식 버전에 resend가 없다면 해당 도구는 제공되지 않는다.

기존 registry 디렉터리와 version=1 형식을 유지하여 저장된 endpoint, targetId, Chrome 프로필을 그대로 사용한다. 여기서 browserId는 창 번호가 아니라 연결 이름이다. 같은 URL의 탭은 targetId로 구분한다. pageId와 targetId의 연결은 임시 무작위 페이지 속성을 사용해 확인하고 즉시 정리한다. MCP 내부 클래스나 비공개 요청 수집 API는 사용하지 않는다.

사용 순서:

1. Pi `/reload`로 새 확장과 변경된 adapter 설정을 읽는다. 기존 adapter 도구가 남으면 Pi를 재시작한다.
2. `resend_poc_browser_session`에 `{ "action": "use", "browserId": "default" }`를 전달한다. sessionId 생략 시 현재 Pi 세션을 사용한다.
3. 기존 Chrome에 연결할 수 없으면 원격 디버깅을 허용한다. 별도 브라우저를 명시적으로 만들려면 action=create와 새 browserId를 사용한다.
4. `resend_poc_list_pages`, `resend_poc_list_network_requests`로 현재 pageId와 reqid를 얻는다.
5. `resend_poc_resend_network_request`에 `{ "pageId": 2, "reqid": 7 }` 형태로 전달한다.
6. 탭을 기억하려면 browser_session의 action=remember에 browserId와 pageId를 전달한다. `/ec-connect`도 선택한 탭을 기억한다.

동일 세션/브라우저를 다시 use하면 MCP를 재시작하지 않아 요청 기록을 유지한다. 한 세션의 여러 브라우저도 각각 연결을 유지한다. 세션 전환·종료 시 MCP 연결만 닫으며 Chrome은 유지한다. 재연결 이후에는 pageId와 reqid를 다시 조회해야 한다. 저장 탭이 여러 브라우저에서 동시에 발견되면 `/ec-connect`는 사용자에게 선택을 요청한다.

원래 요청의 frame에서 fetch를 재구성하며 현재 쿠키를 사용한다. 원본 fetch의 모든 실행 옵션을 보존하는 것은 아니다. XHR은 네이티브 재전송을 사용한다. 재전송 오류는 이미 전송된 뒤 발생할 수 있으므로 자동 재시도하지 않는다.

검증:

- `npm test`: 기존 컨텍스트와 registry 단위 테스트.
- `npm run test:mcp`: 기존 컨텍스트 확장의 MCP 재생 검증.
- `RESEND_MCP_PATH=/absolute/path/to/build/src/bin/chrome-devtools-mcp.js npm run test:browser`: 실제 Chrome에서 Pi 도구 노출, 탭 복원, 공유 요청 ID, fetch body/쿠키, 다중 브라우저 및 공식 MCP 호환성을 검증한다. 운영체제별 Chrome을 사용하는 격리된 테스트 프로필이며 `CHROME_EXECUTABLE_PATH`로 실행 파일을 지정할 수 있다. 실제 ERP는 호출하지 않는다.
