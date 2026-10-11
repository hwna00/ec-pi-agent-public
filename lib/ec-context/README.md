# ECOUNT Context Pi extension

프로젝트의 `.pi/extensions/context-graph.ts`가 자동 로드된다. 기존 `tp-context.ts`의 수동 `/tp` 기능은 유지하고, 새 ContextGraph가 있으면 중복 주입하지 않는다.

## 설치 및 사용

Node 22.19 이상, Python 3, Chrome이 필요하다. Python 저장소 잠금은 Windows에서 `msvcrt`, macOS/Linux에서 `fcntl`을 사용한다. Windows에서는 기본적으로 `python`을 실행하며 `PYTHON` 환경 변수로 실행 파일을 지정할 수 있다. Chrome은 운영체제별 설치 경로에서 찾으며 `executablePath`로 지정할 수 있다. `localMcpPath`를 생략하면 설치된 `chrome-devtools-mcp`를 사용한다.

```sh
npm ci --prefix .pi/lib/ec-context
```

Pi에서 `/reload` 후 실행한다.

```text
/ec-connect
/load-context tp:26128
/load-context dev 22643
/test-server
/test-server test
/test-server --edit
```

- `/ec-connect`: Chrome DevTools MCP `autoConnect`로 기존 Chrome의 로그인된 ERP 탭을 찾는다. Chrome 144 이상에서 `chrome://inspect/#remote-debugging`을 활성화하고 Chrome의 연결 허용 창을 승인해야 한다. 한 탭이면 인증 API로 검증하고 연결한다. 여러 탭이면 브라우저 ID·탭 ID·호스트·제목으로 선택한다.
- 로그인된 탭이 없으면 연결 가능한 브라우저에 새 로그인 탭을 만든다. Chrome에 연결할 수 없으면 Playwright MCP가 별도 프로필의 보이는 Chrome을 실행한다. 회사코드·ID·마스킹 비밀번호를 입력받아 자동 로그인하고 인증 API 검증 후 연결한다. 계정은 프로젝트 공용 `.pi/.local/ec-account.json`에 평문으로 저장하며 파일 권한은 `0600`, Git에서는 제외한다. 다른 Pi 세션에서도 재사용한다. `/ec-connect --edit`로 계정을 수정한다 (이미 로그인된 탭의 계정을 전환하거나 로그아웃하지는 않는다). 추가 인증이나 로그인 오류는 브라우저에서 확인하고 완료 후 `/ec-connect`를 다시 실행한다. 자동 제출은 한 번만 한다. 로그인 페이지에는 `__disableMin`을 넣지 않는다. 로그인 후 ERP 화면과 API 요청에는 `__disableMin=Y`를 강제한다. 연결 시에도 이를 확인하고, 누락되었거나 값이 다르면 기존 쿼리와 해시를 보존한 URL로 실제 재진입한다. 로그인 리다이렉트가 플래그를 제거한 경우에도 `/ec-connect`에서 복구한다.
- `/load-context <type>:<number>` 또는 `<type> <number>`: 새 snapshot에 관련 게시글을 재귀 수집한다. 본문과 전체 답글, 첨부 게시글, 개발의 상위 작업 및 작업에 속한 개발을 포함한다. 순환 참조는 한 번만 조회한다. 모든 수집이 성공한 뒤 활성 snapshot을 전환한다. 다음 에이전트 요청의 system prompt에 `context.md`를 주입한다.
- `tp` 테스트오류수정, `hub` 개발본부 Hub, `dev` 개발, `dp` 테스트/배포, `job` 작업. 기존 `decision` 방향결정과 `meeting` 회의도 인식한다. 게시판별 ID와 상세 메뉴 매핑은 `poc/board-reader/post_reader.py`, `boards.json`에 있다.
- `/add-context type:number`, `/update-context [type:number]`는 기존 그래프 추가·갱신용이다. `/collect-context`는 `/load-context`의 별칭이다.
- `/test-server [test|zeus|stage]`: entry post의 서버/계정정보를 사용한다. 후보가 여러 개면 선택하고, 빠진 회사코드·ID·비밀번호·서버만 질문한다. 비밀번호 입력은 마스킹한다. 저장한 계정을 수정하려면 `--edit`를 지정한다. `https://{환경}.ecount.com/` 로그인 페이지를 새 탭에 연다. 로그인 성공 후 ERP URL에는 `__disableMin=Y`를 적용한다. 상세 서버명(예: `zeus07lxba1`)은 로그인 화면의 서버 필드에 입력한다. 환경 생략 시 상세 서버명의 접두사로 결정한다. 화면 구조·계정·추가 인증 때문에 로그인 성공을 확인하지 못하면 성공으로 보고하지 않는다. 로컬 서버 프로세스를 실행하는 명령이 아니라 이미 운영 중인 테스트 웹사이트를 여는 명령이다.

## 세션과 저장

인증 세션 ID·쿠키를 별도 파일로 내보내지 않는다. 선택한 ERP 탭에서 `fetch(credentials: include)`를 실행하며 HttpOnly 쿠키도 브라우저가 전송한다. 탭을 닫거나 로그아웃하거나 SID가 변경되면 `/ec-connect`로 재연결한다. 브라우저 자체 프로필에는 Chrome의 정책대로 쿠키가 저장된다.

Pi 세션 sidecar의 `context-graph/` 안에 저장한다.

- `active.json`: 활성 snapshot 포인터
- `snapshots/<id>/context.md`, `graph.json`, `context.meta.json`: 컨텍스트와 무결성 해시
- `snapshots/<id>/captures/`: 원본 응답·원본 HTML·파싱 결과 (재검증용)
- `snapshots/<id>/test-servers.json`: entry에서 추출한 테스트 계정 후보
- `test-account.json`: 선택하거나 보완한 테스트 계정. 파일 모드 `0600`. 이 파일의 비밀번호는 Pi 메시지에 주입하지 않는다.

원본 게시글 자체에 계정이 적힌 경우 원문 보존 정책에 따라 captures 또는 본문에 포함될 수 있다. 인증 쿠키와 별도로 사용자가 요청한 테스트 계정을 보관하는 구조다.

`ec-context-session` Pi custom entry에는 entryKey·snapshot·카테고리·테스트 서버 요약만 기록한다. 비밀번호는 기록하지 않는다. Pi 종료·세션 전환 시 진행 중인 Reader를 취소하고 MCP 연결을 닫는다. 연결을 시작하는 도중 세션이 종료되어도 늦게 생성된 MCP 연결을 정리한다. 기존 Chrome 탭을 의도적으로 닫지 않지만 Playwright가 소유한 브라우저는 MCP 종료와 함께 종료될 수 있다. 저장된 컨텍스트를 읽는 데는 브라우저가 필요 없다.

## 여러 브라우저 / 설정

설정 파일은 선택 사항인 `.pi/ec-context.json`이다. 기본은 기존 Chrome autoConnect, 연결할 브라우저가 없으면 Playwright fallback이다. 서로 다른 브라우저 프로필은 각각 CDP endpoint로 지정할 수 있다. 같은 프로필의 여러 창/탭은 한 연결에서 후보로 표시된다.

```json
{
  "maxNodes": 100,
  "browsers": [
    { "id": "work-chrome", "provider": "chrome" },
    { "id": "debug-browser", "provider": "playwright", "endpoint": "http://127.0.0.1:9222" }
  ]
}
```

Chrome channel은 `stable`, `beta`, `dev`, `canary`를 선택할 수 있다. 등록한 브라우저만 검색하며 임의의 OS 프로필에서 쿠키를 복사하지 않는다. Playwright에 endpoint를 생략하면 별도 관리 프로필을 사용한다.

MCP 서버는 익스텐션 코드가 직접 실행하고 SDK로 호출한다. Pi의 일반 MCP 도구 목록에 큰 응답을 전달하지 않는다. Python과 Node 간 private stdio로 원본을 전달해 로컬에서 파싱하며, 명령 결과는 게시글 수·관계 수·아티팩트 경로만 표시한다. `context.md`는 요청한 컨텍스트이므로 에이전트에 본문 전체가 주입된다.

## 검증

```sh
node .pi/lib/ec-context/doctor.mjs
node --test .pi/lib/ec-context/tests/unit.test.mjs
python3 -m unittest discover -s .pi/poc/board-reader/tests -q
node .pi/lib/ec-context/tests/mcp-replay.mjs
```

마지막 테스트는 `.local/decision-validation/captures`의 기존 실제 응답을 사용한다. 실제 MCP 두 개와 실제 Chrome에서 네트워크 응답을 replay하여 본문/답글·그래프·HttpOnly 쿠키·세션 변경 차단·테스트 로그인 폼을 검증한다. **실서버 로그인 검증과 구분한다.** fixture 로그인 화면은 실제 테스트 서버 화면의 확인을 대체하지 않는다.

공식 문서:
- https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect
- https://github.com/microsoft/playwright-mcp

## Pi 브라우저 관리와 resend

책임은 다음처럼 분리되어 있다.

- Chrome DevTools MCP: 공식 도구와 `resend_network_request`. Pi 세션을 알지 못한다.
- `extensions/browser-tools.ts`: Pi에 `resend_poc_*` 도구를 등록한다. 기존 호출 이름을 유지한다.
- `browser-registry.mjs`: Chrome 발견·생성·재사용 및 브라우저/세션 기록을 소유한다.
- `browser-session.mjs`: 공식 `--wsEndpoint`로 MCP를 실행하고 세션/브라우저별 연결을 공유한다.
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
