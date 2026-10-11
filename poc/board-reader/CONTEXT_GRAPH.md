# Reader → ContextGraph

기존 `board_reader.py`의 조회·원문 보존 기능 위에 전체 Markdown 변환, 관계 수집, 세션별 저장과 명시적 갱신을 추가했다. Python 3.10+ 표준 라이브러리만 필요하다. 기존 요약/inspect CLI도 유지한다.

## 바로 실행

저장소 루트 기준:

```sh
# 최초 수집: 본문·답글 전체 + 직접 첨부 + 개발의 상위 작업 및 그 작업의 모든 개발
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context \
  --session-prompt collect dev:22643

# 로그인/네트워크 없이 캐시 상태 확인
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context load

# 저장된 Markdown 전체를 그대로 출력 (의도적으로 축약하지 않음)
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context context

# 모든 기존 노드 + 시작 글의 수집 범위 재확인
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context \
  --session-prompt refresh

# 특정 노드 갱신 / 수동 추가
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context \
  --session-prompt refresh dev:22643
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context \
  --session-prompt add job:12350
```

인증은 기존과 같이 ERP URL과 Request Cookie 헤더를 숨김 입력하거나 `--session-stdin` / `ECOUNT_SESSION_JSON`으로 전달한다. 그래프, Markdown, meta에 인증값을 넣지 않는다. 조회 실패 시 JSON의 `code`와 `post`에 오류 종류와 대상이 나온다. API 호출에는 로그인된 사용자의 조회 권한을 그대로 적용한다.

`add-context`, `update-context`는 CLI의 `add`, `refresh` 별칭이다. 이미 존재하는 노드를 add하면 조회하지 않는다. collect는 이미 존재하는 세션 그래프를 덮어쓰지 않는다.

## 구성

| 파일 | 역할 |
|---|---|
| `post_reader.py` | `PostReader.readCurrent/readById/listDevelopments`, ERP 관계·첨부 조회, 오프라인 FixtureReader |
| `context_graph.py` | MarkdownParser, GraphService, ContextRenderer, SnapshotStore, ContextSession |
| `context_cli.py` | 인증 입력·명령 실행·오류 출력 |
| `current_page.mjs` | 선택적인 기존 Chromium CDP 탭의 현재 글 식별 어댑터 |
| `../../extensions/context-graph.ts` | Pi `/collect-context`, `/add-context`, `/update-context`, 캐시 전달 훅 |

Python API는 동기식이다. 문서의 Promise 인터페이스와 같은 책임을 가지며 세션별 파일 락 안에서 순차 실행한다.

## 실제 지원 범위

| 유형 | 실사이트 Reader | Parser/Graph |
|---|---|---|
| `job` 작업 | 실제 API 검증 완료 | 지원 |
| `dev` 개발 | 실제 API 검증 완료 | 지원 |
| `tp` 테스트오류수정 (Test Progress) | 실제 API 검증 완료 | 지원 |
| `decision` 방향결정 | 실제 API 검증 완료 | 지원 |
| `hub`, `dp`, `meeting` | 명시적 `unsupported` 오류 | 지원, 7개 유형 계약 fixture 제공 |

미구현 게시판을 빈 노드로 저장하거나 성공으로 처리하지 않는다. 해당 유형을 자동 수집해야 하는 상황에서는 전체 작업을 실패시켜 기존 스냅샷을 유지한다. `tests/fixtures`의 7개 유형은 **합성 계약 fixture**이며, 7개 게시판의 실제 조회를 검증했다는 의미가 아니다. 실제 job/dev 캡처는 `.local/context-live`에 있다.

사이트 연결 설정은 `post_reader.py`의 `SITE_TYPES`이다. 개발의 작업 연결 필드 및 상세 메뉴는 실제 확인한 구조를 사용한다. 사이트별 추가 유형을 지원하려면 해당 게시판의 설정·관계 필드 및 실제 fixture를 먼저 검증해야 한다.

## 현재 글 조회

`PostReader`의 `current_provider`는 **호출할 때마다 현재 화면의 `{type,id}`만 읽는 함수**다. `readCurrent()`는 그 식별자로 매번 새 API 요청을 보내므로 오래된 화면 본문을 사용하지 않으며 새로고침하지 않는다.

독립 CLI는 이미 로그인된 Chromium의 **루프백 CDP 연결**이 있을 때 다음과 같이 사용할 수 있다.

```sh
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/current \
  --cdp http://127.0.0.1:9222 --session-prompt read-current

# 현재 글을 시작점으로 전체 수집
# 위 명령의 read-current 대신 collect current
```

CDP 어댑터는 현재 ERP 탭 DOM에서 상세 팝업의 게시판명과 번호만 식별한다. ERP 탭이 여러 개거나 열린 상세 팝업을 식별할 수 없으면 오류로 중단한다. 페이지 이동/수정/새로고침을 하지 않는다. Node.js 22+가 필요하다.

**Codex 내장 브라우저는 이 CLI에 CDP 주소를 제공하지 않는다.** 현재 내장 브라우저의 세션을 자동 연결하거나 쿠키를 자동 추출하는 기능은 없다. 현재 화면에서 확인한 dev:22643을 resolver로 제공한 API 재조회는 검증했으며, 실제 Chrome CDP 연결은 이 환경에서 검증하지 않았다. 내장 브라우저를 사용할 때는 확인된 ID로 `collect dev:22643`을 실행하거나 호스트가 `current_provider`를 제공한다.

## 수집 범위와 관계

- 초기 수집: 시작 글, 시작 글 본문/답글의 직접 첨부, 개발 시작 글의 상위 작업과 해당 작업의 모든 개발.
- 작업 하위 개발은 연결 게시글 번호의 range 조건으로 검색하고 `total_count`까지 페이지네이션한다. 답글 레코드는 제외하고 번호를 중복 제거한다.
- 첨부된 글/다른 개발의 첨부는 재귀 수집하지 않는다. 각 노드는 한 작업 안에서 최대 한 번 조회한다.
- 관계는 사이트 필드, 첨부 API, 식별 가능한 명시적 HTML 링크에서만 추출한다. 본문에 단순히 “작업12350”이라고 쓰여 있다는 이유로 관계를 만들지 않는다.
- `dev → job`은 `belongs_to`, 링크를 가진 원본 → 첨부 대상은 `attach_to`다.
- 노드 없이 엣지를 만들지 않는다. 아직 수집하지 않은 대상은 원본 노드의 Markdown 관계 구역에만 남긴다. 나중에 그 노드가 추가되면 이미 기록된 명시적 관계를 연결한다.
- add는 그 글만 조회하며 재귀 확장하지 않는다. 선택적 Python `edge` 인자는 실제 원본 관계인지 확인한다. 사용자 추가 사실만으로 업무 관계를 생성하지 않는다.
- 전체 refresh는 모든 저장 노드를 재조회한다. 단일 refresh는 해당 노드를 갱신하되, 초기 entry 또는 entry의 상위 작업이면 초기 수집 범위도 검사한다.
- 조회한 원본이 소유한 엣지만 재구성한다. 끊긴 관계는 제거하지만 기존 노드는 삭제하지 않는다.

## Markdown 보존

`ContextNode`는 정확히 `key`, `id`, `type`, `data`만 가진다. data에는 제목, 본문 전체, 답글 전체, 답글의 부모 관계, 코드, 목록, 표, 링크, 미디어 참조, 별도 첨부 및 상위 작업 관계를 넣는다. 본문 미리보기나 요약을 재사용하지 않는다.

- 코드 블록의 공백·연속 줄바꿈은 보존한다.
- 표는 rowspan/colspan과 셀 안 구조를 잃지 않도록 Markdown 안의 HTML table로 보존한다.
- 상대 링크는 실제 ERP document URL 기준 절대 주소로 변환한다.
- 인증/일회성 query 값, UI 버튼/스크립트는 Markdown에서 제외한다. 원본 API/HTML은 로컬 capture에 보존한다.
- 관계 목록과 첨부 목록은 정렬하며 의미 없는 UI wrapper 때문에 공백이 달라지는 것을 정규화한다.
- 파일 바이너리를 내려받는 기능은 없다. HTML 원본의 모든 표현 속성을 Markdown에 그대로 재현한다는 의미는 아니며, 의미 있는 콘텐츠와 원문은 각각 Markdown/capture에 보존한다.

## 캐시와 원자적 갱신

```text
<session-dir>/
  graph.json
  context.md
  context.meta.json
  .context.lock
  captures/             # 원본 조회 증거; 그래프 데이터 모델과 분리
```

노드는 key로, 엣지는 `(from,to,relation)`로 중복 제거한다. Renderer는 entry 먼저, 나머지 key 순, 엣지는 `(from,relation,to)` 순으로 전체 내용을 출력한다. 순환 관계에서도 각 노드 본문은 한 번만 출력된다.

정상 load는 파일과 SHA-256만 검증한다. 네트워크·파싱·렌더링을 수행하지 않는다. 변경이 없으면 renderer와 스냅샷 파일 재쓰기를 생략한다. 원본 조회 capture는 갱신할 때 새로 생긴다.

쓰기 순서는 임시 파일 → graph 원자 교체 → context 원자 교체 → meta 마지막 교체다. 일반 예외는 기존 파일을 복원하고, 프로세스 중단으로 조합이 불일치하면 다음 load에서 유효한 graph만 사용해 context/meta를 재생성한다. graph까지 손상되면 중단하며 웹사이트에서 자동 복원하지 않는다. 수집·파싱 실패 시 graph/context/meta는 바뀌지 않는다.

## Pi 연결

`.pi/extensions/context-graph.ts`가 프로젝트 확장으로 로드되면:

```text
/collect-context dev:22643
/add-context job:12350
/update-context
/update-context dev:22643
```

Pi 프로세스에 `ECOUNT_SESSION_JSON`이 설정되어 있어야 조회 명령이 실행된다. 세션 파일에 대응하는 sidecar 디렉터리의 `context-graph/`에 저장한다. `before_agent_start`는 저장된 context.md를 해시 검증 후 그대로 전달한다. 로그인·사이트 재조회·정상 캐시 재렌더링은 하지 않는다. 캐시 오류는 훅에서 전파해 손상된 문서가 전달되지 않게 한다. 실제 Pi 앱을 재시작/실행하는 것은 이번 검증 범위 밖이며 확장 모듈 로드와 명령/훅 등록은 검증했다.

## 재현 테스트

```sh
python3 -m unittest discover -s .pi/poc/board-reader/tests -v

# 실제 캡처를 이용한 오프라인 실행; 인증·네트워크 불필요
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/offline-new \
  --fixtures .pi/poc/board-reader/.local/context-live/fixtures collect dev:22643
```

실제 검증: dev:22643 본문·답글 2개, job:12436 상위 작업, dev:22444 형제 개발, job:12350 첨부 글 조회. dev:22643 초기 그래프는 3개 노드·2개 엣지다. job:12350을 수동 추가하면 작업 두 글의 상호 첨부를 순환 엣지로 표현할 수 있다.

실서버 무변경 refresh에서 `changed:false`와 graph/context/meta 수정 시각 유지를 확인했다. 서버 게시글을 실제로 수정하지는 않았다. 본문/답글 수정, 신규 첨부/개발, 관계 변경, 부분 실패, 205건 페이지네이션, 저장 중단, 직렬화는 자동 테스트로 검증했다.


## TP (Test Progress / 테스트오류수정)

`tp:<번호>`를 사용한다. 기본 본문과 `내용2`(`body_html_ctt_002`)를 모두 조회·보존한다. 다른 글의 TP 첨부도 `attach_to` 관계로 처리한다. TP를 개발로 간주하거나 개발 전용 `belongs_to` 확장 규칙을 적용하지 않는다.

```sh
# 기존 그래프에 TP 자체를 추가 (첨부의 재귀 조회 없음)
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/my-context \
  --session-prompt add tp:26128

# TP를 시작점으로 수집 (직접 첨부도 수집 대상)
python3 .pi/poc/board-reader/context_cli.py \
  --session-dir .pi/poc/board-reader/.local/new-tp-context \
  --session-prompt collect tp:번호

# 그래프 없이 본문/답글 원문 조회
python3 .pi/poc/board-reader/board_reader.py read 테스트오류수정 26128 --session-prompt
```

실제 TP 26128에는 방향결정 2199가 첨부되어 있다. 방향결정 Reader도 지원하므로 `collect tp:26128`은 방향결정 2199를 함께 수집하고 `tp:26128 → decision:2199`의 `attach_to` 관계를 만든다. `add tp:26128`은 기존 규칙대로 첨부를 자동 확장하지 않는다.

TP 실제 조회 증거는 `.local/tp-validation/captures/`, RawPost fixture는 `.local/tp-validation/fixtures/tp-26128.json`에 보관한다. 이 파일은 업무 데이터이므로 Git에서 제외한다.


## 방향결정

`decision:<번호>`로 수집·추가·갱신한다. 기본 본문·내용2와 답글 전체를 보존한다. 일반 파일 첨부의 별도 bizz_sid를 게시글로 오인하지 않으며 파일명·크기를 Markdown에 보존한다. 파일 바이너리는 다운로드하지 않는다.

```sh
# context_cli.py가 있는 폴더에서 실행
python context_cli.py --session-dir .local/decision-2199 --session-prompt collect decision:2199
python context_cli.py --session-dir .local/tp-26128 --session-prompt collect tp:26128
```

실제 검증 결과는 `.local/decision-validation/tp-26128/context.md`에 있다. `hub`, `dp`, `meeting`은 여전히 실사이트 Reader 미지원이다.
