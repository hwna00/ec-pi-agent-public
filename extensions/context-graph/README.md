# ECOUNT Context Pi extension

프로젝트의 `.pi/extensions/context-graph/index.ts`가 자동 로드된다. `/load-context`로 수집하면 해당 게시글의 최신 연결 세션을 재개하거나 새 세션을 만들어 맥락을 적용한다. 이미 저장한 문서는 `/apply-context`로 현재 세션에 적용할 수 있다. 기존 `tp-context`와 수동 `/tp` 명령은 제거했으며 세션의 `tp.md`는 자동으로 만들거나 주입하지 않는다.

## 설치 및 사용

이 폴더 전체를 프로젝트의 `.pi/extensions/context-graph/`에 복사한다. 이 위치를 기준으로 설정과 연결 상태를 프로젝트 `.pi/`에서 읽는다. `time-log` 없이 단독으로 설치할 수 있다.

Node 22.19 이상, Pi 0.87.1 이상과 Chrome이 필요하다. 수집·HTML 파싱·그래프·저장·다운로드는 모두 TypeScript로 실행한다. Chrome 경로는 `executablePath`로 지정할 수 있다. `localMcpPath`를 생략하면 설치된 `chrome-devtools-mcp`를 사용한다.

공통 Pi SDK·TypeScript·Node 타입은 `.pi/package.json`에서 관리한다. 프로젝트 폴더의 PowerShell에서 공통 패키지를 먼저 설치한 뒤, 이 확장의 브라우저·수집 의존성을 설치한다.

```powershell
npm ci --prefix .\.pi
npm ci --prefix .\.pi\extensions\context-graph
```

Pi에서 `/reload` 후 `/load-context`로 수집하거나 `/apply-context`로 저장한 문서를 선택한다. 선택한 게시글은 바로 적용되며 다음 모델 요청부터 게시글 정보, 작업 디렉터리 기준 상대 경로, 선택한 작업의 폴더 구조, Markdown 스키마 설명을 자동 주입한다. `Default (라벨 없음)`을 고르면 맥락 안내를 주입하지 않는다.

선택 사항인 `session-label-editor/index.ts`를 함께 설치하면 일반 새 세션에서 작업 → 유형 → 게시글을 선택한다. `/load-context`로 만드는 세션은 수집한 글을 사용하므로 이 선택창을 생략한다. 작업은 `[프로젝트 코드] JOB 번호 | 작업 제목`으로 표시하며 선택한 게시글을 바로 적용한다.

새 자료를 수집하거나 현재 세션의 선택을 바꿀 때는 다음 명령을 사용한다.

`dp`를 `/load-context`로 수집하면 `--only` 여부와 관계없이 저장 후 로컬 작업 선택창을 연다. 선택지는 현재 저장된 작업 문서의 `[프로젝트 코드] JOB 번호 | 작업 제목`이다. 작업이 하나이거나 같은 DP가 이미 적용된 세션이어도 직접 선택하며 기본값은 없다. 선택한 작업에 DP 문서와 첨부를 배치하고 해당 작업의 맥락으로 세션을 연결한다. `--only dp:번호`도 작업을 선택하지만, 선택한 작업의 본문이나 다른 게시글을 수집 범위에 추가하지 않는다. 기존에 수집한 게시글·관계와 제한 색인을 유지하며 저장 위치와 프로젝트 정보를 갱신한다. 이 배정은 로컬 저장소에만 기록하며 ERP 게시글은 수정하지 않는다. 취소하거나 로컬 작업이 없으면 수집한 자료를 보관하고 현재 세션을 유지한다. 로컬 작업이 없으면 `/load-context job:번호`로 작업을 먼저 수집한 뒤 DP를 다시 로드한다.

```text
/ec-connect
/load-context tp:26128
/load-context dev 22643
/load-context dp:123005
/load-context --only tp:28502
/apply-context
/apply-context dev:22643
/test-server
/test-server test
/test-server --edit
/list-network
/list-network <목록에 표시된 요청ID>
```

- `/ec-connect`: Chrome DevTools MCP `autoConnect`로 기존 Chrome의 로그인된 ERP 탭을 찾는다. Chrome 144 이상에서 `chrome://inspect/#remote-debugging`을 활성화하고 Chrome의 연결 허용 창을 승인해야 한다. 한 탭이면 인증 API로 검증하고 연결한다. 여러 탭이면 브라우저 ID·탭 ID·호스트·제목으로 선택한다.
- 로그인된 탭이 없으면 연결 가능한 브라우저에 새 로그인 탭을 만든다. Chrome에 연결할 수 없으면 Playwright MCP가 별도 프로필의 보이는 Chrome을 실행한다. 회사코드·ID·마스킹 비밀번호를 입력받아 자동 로그인하고 인증 API 검증 후 연결한다. 계정은 프로젝트 공용 `.pi/.local/ec-account.json`에 평문으로 저장하며 파일 권한은 `0600`, Git에서는 제외한다. 다른 Pi 세션에서도 재사용한다. `/ec-connect --edit`로 계정을 수정한다 (이미 로그인된 탭의 계정을 전환하거나 로그아웃하지는 않는다). 추가 인증이나 로그인 오류는 브라우저에서 확인하고 완료 후 `/ec-connect`를 다시 실행한다. 자동 제출은 한 번만 한다. 로그인 페이지에는 `__disableMin`을 넣지 않는다. 로그인 후 ERP 화면과 API 요청에는 `__disableMin=Y`를 강제한다. 연결 시에도 이를 확인하고, 누락되었거나 값이 다르면 기존 쿼리와 해시를 보존한 URL로 실제 재진입한다. 로그인 리다이렉트가 플래그를 제거한 경우에도 `/ec-connect`에서 복구한다.
- `/load-context <type>:<number>` 또는 `<type> <number>`: 실행마다 브라우저·탭 조회 순서에서 호스트가 `logine.ecount.com`인 첫 번째 로그인된 ERP 탭을 자동 선택하고 인증 API로 검증한다. 저장된 탭이나 이전 연결보다 이 규칙을 우선한다. 해당 탭이 없으면 수집을 시작하지 않고 오류를 표시한다. 탭 선택이나 자동 로그인은 요청하지 않는다. 공용 저장 루트에 게시글별 Markdown을 수집한다. 수집·저장이 끝나면 현재 분기의 선택 게시글이 시작 글과 같은 세션 중 마지막 대화 시각이 가장 최근인 세션을 자동 재개한다. 과거에만 해당 글을 선택했던 세션은 자동 재개 대상에서 제외한다. 연결 세션이 없으면 새 세션을 만들고 시작 문서·라벨·이름을 적용하며, 새 세션의 맥락 선택창은 생략한다. 현재 세션도 같은 기준으로 비교하며 가장 최신이면 그 세션을 그대로 사용하고 수집 자료만 갱신한다. 다른 게시글의 현재 세션은 덮어쓰지 않으며 재개한 세션의 대화·선택·이름은 보존한다. `tp:28502`, `job:5511` 등 모든 지원 유형에 적용하며 다음 모델 요청부터 해당 문서와 작업의 맥락 안내를 주입한다. 수집 또는 세션 검색 중 다른 세션이나 분기로 이동했으면 자료만 저장하고 전환하지 않는다. 수집·검색 실패나 세션 전환 취소 시 기존 세션을 유지한다. 시작 글의 작업을 기준으로 본문·추가 본문·답글, 연결 작업, 작업 화면의 관련 목록, 첨부 게시글의 연결 관계를 끝까지 수집한다. 실행당 같은 글은 한 번 조회한다. 다시 실행하면 서버를 재조회하고 같은 파일을 덮어쓴다.
- 작업 번호가 다른 게시글은 첨부돼 있어도 수집 결과와 관계 목록에서 제외하며, 그 글의 작업이나 관련 목록으로 탐색을 확장하지 않는다. 다른 작업 번호가 직접 연결돼 있으면 조회 전에 차단한다. 일반 게시글은 소속을 확인한 뒤 제외하므로 소속 확인을 위한 조회 기록은 남을 수 있다. 연결 작업 없는 첨부 글은 현재 범위에서 연결된 경우 수집한다. 시작 글에 연결 작업이 없으면 작업 없는 글의 연결만 따라간다. 소속 작업 확인에 실패한 연결 글은 제외하고 재수집 안내에 표시한다.
- `/load-context --only <type>:<number>`: 옵션은 번호 앞에 쓴다. 시작 게시글의 본문·답글·파일과 직접 참조한 글을 수집하고, 참조한 글의 연결도 재귀적으로 따라간다. 저장 위치를 결정하는 연결 작업 번호·제목·프로젝트는 상세 정보와 연결 작업 FORM에서 확인한다. 각 글과 첨부는 일반 수집과 같은 작업 폴더에 저장하고, 전용 색인은 그 폴더의 `.context/only/<유형-번호>/index.md`에 저장한다. 상위 작업 본문·답글·관련 목록으로는 탐색을 확장하지 않는다. 다른 작업 소속 글도 명시적으로 참조하면 각자의 작업 폴더에 수집한다. `--only job:번호` 또는 명시적으로 참조한 작업 글은 그 글 자체와 자체 관련 목록을 수집한다. 옵션 없는 `/load-context`는 기존 작업 범위 수집을 유지한다. 다시 적용하거나 세션을 재개해도 전용 색인의 범위만 사용한다. 완료 후 일반 수집과 같은 규칙으로 최신 연결 세션을 재개하거나 새 세션에 시작 문서를 적용한다.
- 위젯 영역의 조회가 실패하면 해당 영역을 건너뛰고 나머지 수집을 계속한다. 완료 출력에 `일부 영역 수집 실패 (...). /load-context <type>:<number>로 재수집하세요.`를 한 줄 표시하고, 저장한 게시글에도 누락 영역을 기록한다. 성공한 재수집은 누락 표시를 지운다. 사용자가 취소하면 수집을 중단한다.
- 첨부 개수는 그룹 안의 실제 파일과 첨부 게시글을 기준으로 계산한다. 추가 조회 결과는 기존 첨부와 식별자로 병합한다. 조회가 실패하거나 개수가 부족해도 확보한 첨부와 본문을 저장하고, 위젯 실패와 함께 재수집 안내 한 줄을 출력한다.
- ECDrive 연결도 파일로 수집한다. 파일 객체 번호(`oid`)와 버전으로 중복을 구분하며, 일반 첨부와 다른 저장 경로를 사용한다. 다운로드는 원본 게시글의 파일 보안 확인, ECDrive 다운로드 토큰 발급, 파일 URL 조회, 바이트 저장 순서로 진행한다. 관련 게시글 팝업을 열 필요가 없으며 토큰과 다운로드 URL은 브라우저 안에서만 사용한다. 권한 확인이나 파일 전송이 실패하면 해당 파일을 `download_failed`로 남기고 본문·답글 저장을 계속한다. `--no-downloads` 또는 `downloadAttachments: false`일 때는 ECDrive 파일 정보만 저장한다.
- `/apply-context [type:number]`: 이미 저장한 게시글을 현재 세션에 적용한다. 인자를 생략하면 작업 → 유형 → 게시글 순서로 선택한다. 재수집·브라우저 연결 없이 로컬 파일과 무결성을 확인하며, 이전에 저장한 범위에 다른 작업 소속 글이 섞여 있어도 선택한 시작 글의 작업 범위만 적용한다. `/apply-context default` 또는 선택 화면의 기본값은 적용을 해제하고 라벨 없는 세션으로 바꾼다. 취소하거나 저장 자료 확인에 실패하면 기존 선택을 유지한다. 적용 후 첫 모델 요청부터 게시글 정보, 상대 경로, 선택한 작업의 폴더 구조, Markdown 스키마 설명을 자동 주입한다.
- 작업을 조회하면 작업 화면의 기획·방향결정 목록도 함께 조회하고, 연결된 게시글의 본문·답글·첨부를 수집한다. 기획은 `기획/plan_<번호>.md`, 방향결정은 `방향결정/decision_<번호>.md`로 저장하며 작업의 `index.md`에서 연결한다. 빈 목록은 추가 게시글 없이 완료하고 조회 실패는 누락으로 표시한다.
- `tp` 테스트오류수정, `hub` 개발본부 Hub, `dev` 개발, `dp` Dev. Progress, `job` 작업, `plan` 기획, `decision` 방향결정, `meeting` 회의를 인식한다. `기획:번호` 또는 `plan:번호`로 직접 조회·적용할 수도 있다. `dev progress:번호`, `dev. progress:번호`, `dev._progress:번호`도 `dp:번호`로 인식한다. 게시판별 ID와 상세 메뉴 매핑은 `src/collect/site-api.ts`의 `siteTypes`에 있다.
- 저장한 자료를 갱신하려면 같은 `/load-context type:number`를 다시 실행한다. 제한된 범위를 유지하려면 `/load-context --only type:number`를 사용한다.
- `/test-server [test|zeus|stage] [--edit]`: 현재 세션에서 선택한 게시글 Markdown의 frontmatter `test_accounts`를 읽는다. TP뿐 아니라 모든 지원 게시글 유형에 사용할 수 있다. 계정이 완비되어 있으면 문서를 다시 쓰지 않고 서버를 연다. 후보가 여러 개면 선택하고, 계정이 없거나 일부 값이 비어 있으면 빠진 서버·회사코드·ID·비밀번호만 질문한다. 비밀번호 입력은 마스킹한다. 입력을 완료하면 같은 문서의 frontmatter에 계정을 등록·보완하고, 문서 해시와 내부 자료를 함께 저장한 후 서버를 연다. 기존 본문과 다른 frontmatter 값은 보존한다. `--edit`는 선택한 계정의 값을 다시 입력받아 교체한다. 입력 취소, 저장 실패, 입력 중 세션·분기·선택 문서 변경 시 서버를 열지 않는다. 기존 `.context/test-accounts/*.json`은 읽거나 갱신하지 않는다.
- 수동 등록·수정한 계정은 내부 게시글 자료에 별도로 구분해 재수집이나 다른 게시글 저장 후에도 유지한다. 같은 서버·회사코드·ID의 원본 후보는 수동 값으로 대체하며, 수정 전 후보의 식별값도 함께 기억한다. 수정하지 않은 원본 후보는 재수집한 최신 값을 사용한다. `server: "zeus08lxba2"`이면 `https://zeus08lxba2.ecount.com/` 로그인 페이지를 새 탭에 연다. 상세 서버명을 `zeus` 같은 환경 접두사로 줄이지 않는다. 로그인 성공 후 ERP URL에는 `__disableMin=Y`를 적용한다. 로그인 화면에 서버 선택란이 있으면 함께 입력하고, 없으면 상세 호스트 주소로 서버를 결정한다. 환경은 상세 서버명의 접두사로 결정한다. 명령에 환경 인수를 주면 상세 서버명의 접두사와 일치해야 하며, 불일치하면 `--edit`로 서버명을 수정하도록 안내한다. 새 탭을 조작 대상으로 선택하되 수집에 사용하는 기존 ERP 탭의 고정 정보는 유지한다. 로그인 성공을 확인하지 못하면 오류를 표시하되 저장한 계정은 유지한다.
- `/list-network [요청ID]`: 현재 Pi 세션에서 `/test-server`로 연 마지막 테스트 탭만 조회한다. 인수가 없으면 MCP가 보유한 요청 중 최근 100개의 ID·메서드·URL·상태를 표시한다. 목록에 나온 `0123456789abcdef:17` 형태의 ID를 전달하면 요청·응답 헤더와 본문을 조회한다. 결과는 Pi 메시지로 표시하여 다음 모델 요청에서도 참고할 수 있다. 요청을 재전송하지 않는다. 세션 URL 값, 인증 헤더·쿠키, 비밀번호·토큰 필드는 표시 전에 마스킹한다. Chrome DevTools MCP 연결에서 지원하며 Playwright 연결은 안내만 표시하고 기존 로그인 동작을 유지한다.
- 테스트 탭은 `.pi/.local/test-server-tabs/<Pi sessionId>.json`에 브라우저·고유 `targetId`·연결 세대만 기록한다. URL·계정·네트워크 본문은 이 파일에 저장하지 않는다. 같은 URL의 다른 탭이나 현재 선택 탭으로 대체하지 않으며, 탭이 닫혔거나 Chrome 인스턴스가 바뀌면 다시 `/test-server`를 실행하도록 안내한다. 다시 `/test-server`를 실행하면 이전 탭 대신 새 탭을 고정한다. 로그인 제출 전에 연결하므로 로그인 실패한 탭의 요청도 조회할 수 있다. 기존 수집용 ERP 탭의 고정 정보는 별도로 유지한다.
- 테스트 탭을 연 MCP 연결을 유지하여 로그인부터 수집한 기록을 조회한다. 보존 범위는 MCP의 최근 탐색 기록에 한정되며 영구 저장하지 않는다. Pi 종료·확장 재로드·MCP 재연결 뒤에도 같은 Chrome 탭은 고유 ID로 찾지만, 이전 연결의 요청 기록은 복원되지 않을 수 있다. 재연결하거나 테스트 탭을 다시 열면 목록의 요청 ID도 바뀌며 이전 ID의 상세 조회는 거부한다. 새 요청은 테스트 탭에서 동작한 뒤 `/list-network`로 다시 조회한다.

## 세션과 저장

### 테스트 탭의 공통 MCP 호출

Pi `/reload` 후 `/test-server`로 테스트 탭을 열면 에이전트 도구 `test_tab`, 범용 명령어 `/test-tab`, 단축 명령어 `/list-network`가 같은 연결·검증 계층을 사용한다. 현재 지원 도구는 `list_network_requests`, `get_network_request`, `emulate` 세 가지다. MCP 서버는 수정하지 않으며, 실제 연결의 도구 목록과 JSON Schema를 읽는다. `src/test-server/test-tab.ts`는 탭 식별·복원·MCP 수명만 담당하고 `src/test-server/test-tab-tools.ts`가 지원 도구, 인수 검증, 네트워크 요청 ID와 결과 표시를 담당한다.

직접 실행:

```text
/test-tab tools
/test-tab describe list_network_requests
/test-tab call list_network_requests {"resourceTypes":["xhr","fetch"],"pageSize":20,"pageIdx":0,"includePreservedRequests":true}
/test-tab call get_network_request {"reqid":"목록에 나온 요청ID"}
/test-tab call get_network_request {"reqid":"목록에 나온 요청ID","requestFilePath":"request.json","responseFilePath":"response.json"}
/test-tab describe emulate
/test-tab call emulate {"networkConditions":"Slow 4G"}
/test-tab call emulate {}
/test-tab call emulate {"extraHttpHeaders":"{\"X-Test\":\"fixture\"}"}
/test-tab call emulate {"extraHttpHeaders":""}
```

목록은 메서드·URL·상태와 현재 연결에서 발급한 요청 ID를 반환한다. `pageSize`를 생략하면 응답 중 최근 100개를 표시하고, 지정하면 MCP가 해당 페이지에 반환한 요청을 표시한다. `/list-network`는 보존 기록을 포함하는 목록 조회, `/list-network <요청ID>`는 상세 조회의 단축 명령이다. 범용 호출과 단축 명령에서 얻은 ID를 서로 사용할 수 있다. 네트워크 조건은 `Offline`, `Slow 3G`, `Fast 3G`, `Slow 4G`, `Fast 4G`를 지원하며 `{}`처럼 `networkConditions`를 생략하면 제한을 해제한다. 추가 헤더는 JSON 객체 문자열로 지정하고 빈 문자열로 제거한다. 나머지 `emulate` 옵션도 실제 MCP 스키마 범위에서 사용할 수 있다. 설정은 고정된 테스트 탭에만 적용된다.

에이전트는 사용자의 자연어 요청에 따라 `test_tab` 하나를 호출한다. `action: "list"`로 지원 목록을 찾고, `action: "describe", tool: "..."`로 인수를 확인한 뒤 `action: "call", tool: "...", args: {...}`로 실행한다. 예를 들어 `{"action":"call","tool":"list_network_requests","args":{"resourceTypes":["fetch"]}}`를 사용할 수 있다. `sessionId`와 `pageId`는 외부 입력으로 받지 않는다. 현재 Pi 세션에서 저장한 고유 탭을 찾아 `pageId`를 주입한다. 지원하지 않는 도구와 스키마에 없는 인수는 실행 전에 거부한다.

상세 조회의 `reqid`는 현재 목록의 문자열 ID를 필수로 사용한다. MCP의 원래 숫자 ID나 이전 연결·다른 탭의 ID는 사용할 수 없다. 본문 파일의 상대 경로는 Pi 작업 디렉터리를 기준으로 한다. 파일 내보내기는 MCP의 전체 본문을 받아 텍스트의 알려진 인증 필드를 마스킹한 뒤 저장하므로, 인라인 출력의 본문 길이 제한을 받지 않는다. 바이너리 본문은 바이트를 보존한다. 본문이 이미 폐기되어 없으면 저장 실패를 알린다. 조회 결과와 파일에 인증 헤더·쿠키·세션 URL 값·비밀번호·토큰 필드를 그대로 표시하지 않는다.

인증 세션 ID·쿠키를 별도 파일로 내보내지 않는다. 선택한 ERP 탭에서 `fetch(credentials: include)`를 실행하며 HttpOnly 쿠키도 브라우저가 전송한다. 탭을 닫거나 로그아웃하거나 SID가 변경되면 `/ec-connect`로 재연결한다. 브라우저 자체 프로필에는 Chrome의 정책대로 쿠키가 저장된다.

기본 저장 루트는 실행 프로젝트의 `.pi/context/`다. 설정의 `contextDir` 또는 환경 변수 `ECOUNT_CONTEXT_DIR`로 변경할 수 있다. 상대 경로는 Pi의 작업 디렉터리를 기준으로 계산한다.

```text
.pi/context/
├── <프로젝트 코드>/job_<번호>/
│   ├── job_<번호>.md
│   ├── index.md
│   ├── 기획/plan_<번호>.md
│   ├── 개발_스프린트/dev_<번호>.md
│   ├── 회의록/meeting_<번호>.md
│   ├── 방향결정/decision_<번호>.md
│   ├── 오류_수정/tp_<번호>.md
│   └── attachments/<유형_번호>/<파일 ID>/<원본 파일명>
├── hub_<번호>/hub_<번호>.md
└── .context/
    ├── catalog.json
    └── posts/, entries/, captures/
```

폴더와 Markdown 파일명의 공백은 `_`로 바꾼다. 작업 번호가 없으면 루트의 `<유형>_<번호>/`에 저장한다. 작업 번호만 있고 프로젝트 코드가 없으면 루트의 `job_<번호>/`를 사용한다. 각 글은 자신의 연결 작업 정보로 위치를 결정한다. 다른 글의 작업 정보를 물려받지 않는다. 명령의 `/load-context dev 22643`처럼 공백을 쓰는 번호 입력 문법은 유지한다.

기존 공백 경로는 다음 수집 결과를 저장하기 전에 자동으로 `_` 경로로 변환한다. 읽기·적용만으로는 경로를 변환하지 않는다. 변환 시 관리하는 파일을 이동하고 색인과 Markdown 링크를 함께 갱신한다. 이전 관리 경로는 제거하며 관리하지 않는 파일은 유지한다.

수집 없이 로컬 경로만 변환하려면 `.pi/extensions/context-graph/`에서 다음을 실행한다. 브라우저 연결은 필요 없다.

```sh
node src/cli/context-cli.ts --store-dir ../../context migrate-paths
```

기존 수집에서 작업 정보가 누락되어 독립 폴더로 저장된 글은 아래 명령으로 복구한다. 저장된 원본 캡처의 정확한 연결 작업 번호를 사용하며, 브라우저를 조회하지 않는다. 게시글·첨부·색인의 해시를 확인하고 경로와 링크를 함께 갱신한다. 사용자 파일은 유지한다.

```sh
node src/cli/context-cli.ts --store-dir ../../context repair-grouping
```

게시글 파일의 공통 프론트매터는 자신의 `type`, 문자열 `number`, `title`이다. `project_code`는 `job` 작업 파일에만 추가한다. `test_accounts`는 후보별 `server`, `company_code`, `account_id`, `password`를 담고 실제 비밀번호를 보존한다. TP 파일은 수집 계정이 없어도 `test_accounts: []`를 만들고, 다른 유형도 계정이 있으면 같은 목록을 저장한다. 목록이 없거나 `null`이면 계정 없음으로 처리하며, 누락한 항목은 `null`로 읽고 실행 시 질문한다. 일반 YAML 및 LF/CRLF 줄바꿈을 지원한다. 계정 값은 문자열 또는 `null`이며, 앞자리 0이 있는 회사코드는 반드시 문자열로 쓴다. 연결 작업 번호와 제목은 별도 프론트매터 키로 중복 저장하지 않는다. `index.md`는 `type: index`, `number: null`, 목록의 `title`로 구분한다.

수집한 자료의 파싱이 끝나면 공유 저장소의 파일을 교체한다. 위젯 조회 실패와 첨부 수집 부족은 누락으로 표시한 부분 수집 결과를 저장한다. 그 외 전체 수집·검증·저장 실패는 기존 파일을 유지한다. 쓰기는 파일 잠금으로 직렬화한다. 연결 작업이 바뀌면 색인과 들어오는 링크를 갱신한다. 사라진 관계·첨부는 최신 글에서 제외하고 이전 공용 파일은 자동 삭제하지 않는다.

첨부 파일은 기본적으로 다시 다운로드한다. 실제 응답에 URL이 있으면 로그인된 브라우저에서 바이너리로 받는다. URL이 없으면 현재 ERP 탭에 정확한 게시글 팝업과 단일 파일 항목이 열려 있어야 한다. 다른 재귀 글의 팝업이 열려 있지 않으면 `download_failed`로 기록한다. 파일 실패 시 본문은 저장하며 실패 수를 알린다. ZIP은 압축 상태로 보존한다. `downloadAttachments: false`로 다운로드를 끌 수 있다.

원본 게시글 자체에 계정이 적힌 경우 원문 보존 정책에 따라 captures 또는 본문에 포함될 수 있다. 인증 쿠키와 별도로 사용자가 요청한 테스트 계정을 보관하는 구조다.

`ec-context-session` Pi custom entry에는 `version: 4`, 게시글 `entryKey`, 연결 작업 `jobKey`를 기록한다. 적용 해제는 두 키를 `null`로 저장한다. 작업 키는 적용 당시의 관계를 보존한다. 현재 세션의 분기에서 마지막 선택을 복원한다. 명시적 선택 항목이 없는 레거시 세션은 게시글 키가 저장된 라벨에서 맥락을 읽으며, 명시적 선택·해제와 Default 라벨을 우선한다. 재개 시 세션 파일을 다시 쓰지 않는다. 공용 활성 포인터는 없다. `/load-context`는 다른 게시글의 세션을 보존하고 연결 세션을 재개하거나 새 세션을 초기화한다. 적용 중 세션이 바뀌면 전환한 세션에 적용하지 않는다. Pi 종료 시 수집을 취소하고 MCP 연결을 닫는다. Pi 종료 후에도 계속 실행하는 별도 수집 데몬은 없다. 저장된 자료 조회는 브라우저와 Pi 세션 파일 없이 가능하다.

`session-label-editor/index.ts`의 새 세션 선택도 같은 로컬 목록을 사용한다. 작업 → 유형(개발, 오류 수정 등) → 게시글 순서로 고르며 기본값을 고르면 라벨 없는 세션을 만든다. 같은 프로젝트 코드에 여러 작업이 있어도 JOB 번호와 작업 제목으로 구분한다. 코드 없는 작업도 번호와 제목으로 표시한다. 연결 작업 없는 글은 별도 선택 항목으로 표시하며 저장 폴더를 새로 만들지 않는다. 입력창 위 테두리에는 선택한 게시글의 유형·번호·제목을 한 줄로 표시한다.

선택을 마치거나 `/load-context`로 새 세션을 만들면 해당 세션의 현재 분기에 적용 정보를 기록한다. 기존 연결 세션을 재개할 때는 저장된 적용 정보를 그대로 사용한다. `before_agent_start`가 첫 모델 요청부터 해당 글의 유형·번호·제목, 상대 경로, 작업의 폴더 구조와 위 프론트매터 스키마를 안내한다. 현재 게시글과 `index.md`를 읽고 관련 게시글·첨부 파일을 확인하도록 설명한다. 본문과 계정 값은 자동으로 복사하지 않는다. Default 세션에는 이 안내가 없으며 `/load-context`를 완료하면 연결 세션에서 수집한 시작 문서의 안내를 주입한다.

```text
─ DEV 23047 | 게시글 제목 ───
```

세션에 저장하는 이름과 `/resume` 목록의 이름은 `[A25_09780] DEV 23047 | 게시글 제목`이다. 프로젝트 코드가 없으면 `DEV 23047 | 게시글 제목`으로 저장한다. 입력창 위에는 앞의 예시처럼 게시글 유형·번호·제목만 표시한다.

하단 footer에는 현재 분기의 `session-label`에서 읽은 프로젝트 코드와 연결 작업 제목을 `[A25_09780] 연결 작업 제목`으로 표시한다. footer 표시는 저장된 세션 이름과 별도로 만든다. 첫 경로·제목 줄 아래에는 현재 분기의 `ec-context-session`과 로컬 문서 목록을 연결하여 `Context: 게시글 Markdown 절대 경로`를 표시한다. 세션 재개·분기 이동·문서 경로 변경에도 현재 목록의 경로를 사용하며 세션 메타데이터는 수정하지 않는다. 컨텍스트가 없거나 문서 경로를 읽지 못하면 해당 줄을 생략한다. 긴 경로는 터미널 폭에 맞춰 `...`로 줄인다. 사용량·모델·상태 줄은 기본 렌더러를 그대로 사용한다. 입력창에 프로젝트 정보나 별도 행은 추가하지 않는다. 테스트 계정이나 본문은 라벨과 프롬프트에 저장하지 않는다.

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
    ├── 기획/
    ├── 개발_스프린트/
    ├── 회의록/
    ├── 방향결정/
    └── 오류_수정/
```

`job_<번호>.md`는 작업과 프로젝트 정보, `index.md`는 게시글 목록과 링크다. `기획/plan_<번호>.md`는 기획, `개발_스프린트/dev_<번호>.md`는 개발, `회의록/meeting_<번호>.md`는 회의록, `방향결정/decision_<번호>.md`는 방향결정, `오류_수정/tp_<번호>.md`는 테스트 오류 수정, `오류_수정/dp_<번호>.md`는 Dev. Progress, `개발본부_Hub/hub_<번호>.md`는 Hub다. 첨부 파일은 Markdown 링크로 찾는다. 연결 작업 없는 첨부 게시글은 별도 저장 경로의 관련 링크로 확인한다. 다른 작업 소속 글은 현재 맥락의 관계 목록에서 제외한다.

## 여러 브라우저 / 설정

설정 파일은 선택 사항인 `.pi/ec-context.json`이다. 현재 프로젝트 설정은 `managedProfile: true`인 수집용 Chrome을 사용한다. 전용 프로필은 `<registry>/profiles/<browserId>/`에 저장하며, 현재 registry는 프로젝트의 `.pi/.local/context-browser/`다. 창이 열려 있으면 재연결하고 닫혀 있으면 같은 프로필로 다시 실행한다. 평소 Chrome에 자동 연결하지 않는다. 처음 열린 수집용 창에서 ERP에 로그인한 뒤 `/load-context`를 실행한다. 로그인 정보는 그 프로필에 유지하며 ERP 세션이 만료되면 다시 로그인한다. Pi가 종료돼도 Chrome 창은 유지한다.

```json
{
  "contextDir": ".pi/context",
  "downloadAttachments": true,
  "browsers": [
    { "id": "context-graph", "provider": "chrome", "managedProfile": true },
    {
      "id": "debug-browser",
      "provider": "playwright",
      "endpoint": "http://127.0.0.1:9222"
    }
  ]
}
```

기본 수집 노드 개수에는 제한이 없다. 한 작업 안의 연결 관계가 100개를 넘어도 모두 탐색한다. 개수를 제한하려면 설정에 `"maxNodes": 200`처럼 양의 정수를 명시하거나 독립 CLI에서 `--max-nodes 200`을 지정한다. 이때는 수집 결과에 포함되는 게시글만 개수에 포함하며, 상한을 초과하면 부분 그래프를 저장하지 않고 오류를 표시한다. 다른 작업 소속으로 제외한 글은 상한 개수에 포함하지 않는다.

Chrome channel은 `stable`, `beta`, `dev`, `canary`를 선택할 수 있다. 등록한 브라우저만 검색하며 임의의 OS 프로필에서 쿠키를 복사하지 않는다. Playwright에 endpoint를 생략하면 `.pi/.local/ec-context/ec-browser`의 별도 관리 프로필을 사용한다. MCP 출력은 `.pi/.local/ec-context/mcp-output`에 저장한다.

MCP 서버는 익스텐션 코드가 직접 실행하고 SDK로 호출한다. `src/collect/reader.ts`가 브라우저 API를 직접 호출하고 TS 모듈로 파싱·수집·저장을 처리한다. Python 프로세스나 stdio 중계는 사용하지 않는다. 프롬프트 생성은 로컬 저장 자료에서 게시글 정보·상대 경로·작업의 폴더 구조를 읽고 파일명 규칙과 Markdown 스키마를 설명한다. 서버 조회·다운로드·본문 주입은 하지 않는다. 필요한 본문은 에이전트가 파일 도구로 읽는다.

## 검증

프로젝트 폴더의 PowerShell에서 실행한다.

```powershell
node .\.pi\extensions\context-graph\src\cli\doctor.ts
npm test --prefix .\.pi\extensions\context-graph
npm run check --prefix .\.pi\extensions\context-graph
npm run test:browser-fixtures --prefix .\.pi\extensions\context-graph
$env:EC_DOWNLOAD_NATIVE_TEST = "1"
node --test .\.pi\extensions\context-graph\tests\collect\download.test.ts
Remove-Item Env:EC_DOWNLOAD_NATIVE_TEST
```

테스트와 타입 검사는 공통 패키지와 이 확장의 개발 의존성을 사용한다. `session-label-editor/index.ts`와의 통합 테스트는 저장소 루트의 `tests/`에 있다.

신규 FORM·LIST 조회와 페이지 분기는 모의 응답으로 검증한다. 일반 첨부 다운로드 테스트는 임시 Chrome에서 ZIP 바이트를 확인한다.

`test:browser-fixtures`는 임시 Chrome에서 로그인 흐름, 테스트 탭의 네트워크 격리·복원, 요청 본문 마스킹과 도구 호출을 검사한다. 로컬 서버와 모의 페이지만 사용하며 실제 ERP에 접속하거나 저장하지 않는다.
임시 파일은 Windows의 `%TEMP%`에 만들고 종료 시 삭제한다. Chrome은 기본 설치 경로에서 찾으며, 다른 위치에 설치했다면 `$env:CHROME_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"`로 지정한다.

## 구현 파일

- `src/collect/site-api.ts`: API 응답, Setup 위젯, 페이지, 본문·답글 완전성 확인.
- `src/collect/posts.ts`: 프로젝트·작업 정보, 첨부 게시글·파일, TP 계정 추출.
- `src/collect/html.ts`: HTML을 Markdown으로 변환. 원본 HTML은 captures에 보존.
- `src/collect/graph.ts`: 유형·번호와 작업 소속 검증, 한 작업 범위의 재귀 수집, 중복·순환 처리.
- `src/workspace/workspace.ts`: 경로·프론트매터·색인·첨부·잠금·오류 복원, 저장 자료 적용·갱신의 작업 범위 유지.
- `src/session/selection.ts`: 로컬 작업·유형·게시글 공통 선택, 세션 적용·해제, 라벨 생성.
- `src/session/resume.ts`: `/resume` 입력 처리와 작업별 세션 선택·재개.
- `src/session/session-links.ts`: 원본 세션의 게시글 참조 조회와 관계 색인 캐시.
- `src/collect/reader.ts`: 명령 실행, 취소와 시간 제한. `src/cli/context-cli.ts`: 독립 CLI.

공식 문서:

- https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect
- https://github.com/microsoft/playwright-mcp

## Pi 브라우저 관리와 resend

책임은 다음처럼 분리되어 있다.

- Chrome DevTools MCP: 공식 도구와 `resend_network_request`. Pi 세션을 알지 못한다.
- `src/browser/pi-browser-tools.ts`: 현장 조사반이 직접 로드하여 Pi에 `resend_poc_*` 도구를 등록한다. 기존 호출 이름을 유지한다.
- `src/browser/browser-registry.ts`: Chrome 발견·생성·재사용 및 브라우저/세션 기록을 소유한다.
- `src/browser/browser-session.ts`: 공식 `--wsEndpoint`로 MCP를 실행하고 세션/브라우저별 연결을 공유한다.
- `index.ts`: 실제 Pi sessionId를 전달하고 같은 연결을 사용한다.

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
- PowerShell에서 `$env:RESEND_MCP_PATH = "C:\projects\chrome-devtools-mcp\build\src\bin\chrome-devtools-mcp.js"`를 지정한 뒤 `npm run test:browser`를 실행한다. 실제 Chrome에서 Pi 도구 노출, 탭 복원, 공유 요청 ID, fetch body/쿠키, 다중 브라우저 및 공식 MCP 호환성을 검증한다. 격리된 테스트 프로필을 사용하며 `CHROME_EXECUTABLE_PATH`로 실행 파일을 지정할 수 있다. 실제 ERP는 호출하지 않는다.
