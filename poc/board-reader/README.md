# 게시글 본문·답글 조회 PoC

Python 3.10 이상과 표준 라이브러리만 사용한다. 패키지 설치 없이 실행 가능하다.
게시판 이름과 글 번호를 받아 ECOUNT 내부 조회 API를 호출하며, 글 작성·수정 API는 사용하지 않는다.

## 실행

저장소 루트에서 실행한다.

```sh
python3 .pi/poc/board-reader/board_reader.py read 개발 22643 --session-prompt
```

숨김 입력 프롬프트에 로그인된 ERP URL과 DevTools의 실제 요청 `Cookie` 헤더를 입력한다.
세션은 프로세스 메모리에만 유지하며 파일에 저장하지 않는다. URL의 `ec_req_sid`와 쿠키는 같은 로그인 세션에서 가져와야 한다.
입력은 셸 명령행 인자로 전달하지 않는다.

자동화 시 `--session-stdin`으로 아래 형식의 JSON을 보안 저장소/상위 프로세스에서 전달하거나 `ECOUNT_SESSION_JSON` 환경변수로 전달한다. 실제 값을 코드·Git에 넣지 않는다.

```json
{"host":"logine.ecount.com","ec_req_sid":"<current session>","cookie":"<current request Cookie header>"}
```

세션 만료는 종료 코드 3으로 반환한다. 재로그인 후 새 URL·쿠키로 다시 실행한다. 만료 세션 자동 재발급, 로그인 자동화, 브라우저 쿠키 동기화는 이 PoC에 포함되지 않는다. 일반 실패는 2, 성공은 0이다. 세션 오류 시 무한 재시도하지 않는다.

`--out <새 디렉터리>`로 저장 위치를 지정할 수 있다. 기본은 이 폴더의 `.local/<timestamp>/`이다. 기존 디렉터리는 덮어쓰지 않는다.

## 지원 범위와 메뉴 설정

개발·작업·테스트오류수정(TP)·방향결정 게시판은 이름과 번호만으로 실제 조회 검증을 완료했다. `boards.json`에 **상세 메뉴 ID**만 등록되어 있다. 게시판 ID와 목록 메뉴, 양식, 게시글 내부 ID 및 위젯은 실행 시 API에서 조회한다.

다른 게시판은 정확한 이름으로 조회하고 상세 화면에서 확인한 `menu_sid`를 추가 지정한다.

```sh
python3 .pi/poc/board-reader/board_reader.py read '다른 게시판' 123 --view-menu M_실제상세메뉴ID --session-prompt
```

목록 API가 반환한 조회 메뉴와 상세 위젯 메뉴는 다를 수 있다. 현재 상세 메뉴의 보편적인 자동 탐색은 해결하지 않았으므로 임의의 SID로 성공한 것처럼 처리하지 않는다. 확인된 매핑은 `boards.json`에 추가할 수 있다. 동일 이름의 게시판이 여러 개면 모호성 오류를 반환한다.

## 데이터 구조와 토큰 절약

- `post.json`: 본문 `body`, 답글 `replies`, 연결된 다른 글 `linked`, 원본 메타데이터, 답글 레코드, 완전성 검증 결과.
- 각 콘텐츠의 `content.raw_html`: 서버에서 받은 ctt 문자열을 그대로 보존. `sha256`으로 무결성 확인.
- `content.text`: 읽기·검색용 파생 텍스트. 줄바꿈, 표 셀, 이미지 alt 처리. 원본을 대체하지 않는다.
- `content.events`: 태그·속성·텍스트·엔티티·주석의 이벤트 목록. `links`, `assets`는 링크와 미디어 속성 목록.
- `raw/*.json`: 전체 API 응답. KeyPack 응답도 보존하며 처리할 때 키 사전으로 풀어 사용한다.
- `widgets.json`: 실제 화면 설정에서 추출한 조회 위젯.
- `requests.json`: API 종류·응답 바이트 수·소요 시간·응답 파일 경로. 인증 헤더와 요청 URL은 기록하지 않는다.
- `summary.json` 및 stdout: 짧은 메타데이터와 `contents.linked`(연결 작업), `contents.body`(본문), `contents.replies`(각 답글)의 미리보기. 모든 항목을 포함하며 각 미리보기는 최대 400자이다. 게시판·번호·제목·작성자와 `truncated`, `next_offset`을 함께 표시한다. 전체 출력 크기는 항목 수에 비례한다. 기존 `body_preview`도 유지한다.

HTML의 **문자열 원문**을 보존하는 방식이다. HTML 파싱 과정의 공백 정리, 엔티티 해석, script/style 제외는 파생 `text`에만 적용된다. 이미지·첨부 파일의 URL/속성은 보존하지만 파일 바이너리는 내려받지 않는다. 원문 HTML을 브라우저에서 실행하는 기능은 없다.

필요한 부분만 제한된 크기로 읽는다. `--limit` 기본 1,500자, 최대 4,000자이며 `next_offset`으로 이어 읽는다. 문자 수 제한이지 토큰 수의 정확한 측정은 아니다.

```sh
python3 .pi/poc/board-reader/board_reader.py inspect .pi/poc/board-reader/.local/live-22643/post.json --section replies --index 0 --offset 0 --limit 800
```

전체 원문 파일을 에이전트에게 `cat`하거나 붙여넣지 않고 `inspect`를 사용한다. 원문과 게시글 데이터는 `.gitignore`로 Git에서 제외하고 JSON 파일은 소유자 읽기/쓰기 권한으로 생성한다.

## 호출과 검증

1. 게시판 목록에서 이름을 정확히 일치시킨다.
2. 조회 메뉴 후보와 목록 양식을 조회한다.
3. 글 번호로 검색하고 부모 레코드의 내부 ID를 확인한다. 검색 결과에 함께 나온 답글 ID도 보관한다.
4. 상세 데이터와 상세 화면 설정을 조회한다.
5. 설정의 `load_complete` 이벤트에서 본문·댓글 위젯을 추출한다. 위젯 개수를 5로 고정하지 않는다.
6. 본문·댓글이 필요한 위젯을 호출한다. 연결 게시판 본문은 별도 분리한다. 순차 호출하며 불필요한 FORM 위젯은 생략한다.
7. 답글 총수와 ID, 콘텐츠 필드 존재를 대조한다. 페이지가 더 있으면 조회하며, 같은 페이지 반복이나 누락은 오류로 반환한다.
8. 원문과 구조화 데이터를 로컬에 저장하고 짧은 요약만 출력한다.

댓글 조건에 부모의 `record_sid`를 넣으면 답글이 0개로 응답하는 것을 실제로 확인했다. 댓글은 부모 `data_sid` 조건으로 조회한다. 날짜 조건은 글의 `data_dt`를 사용하여 고정된 최근 2년 범위에 의한 오래된 글 누락을 피한다.

## 재현 가능한 테스트

```sh
python3 -m unittest discover -s .pi/poc/board-reader/tests -v

# 네트워크와 로그인 없이 캡처한 응답으로 같은 조회 로직 재실행
python3 .pi/poc/board-reader/board_reader.py replay .pi/poc/board-reader/.local/live-22643 --out .pi/poc/board-reader/.local/my-replay

# 저장된 HTML을 원본 위젯 API 응답과 문자열 및 SHA-256로 비교
python3 .pi/poc/board-reader/board_reader.py verify .pi/poc/board-reader/.local/my-replay
```

`replay`는 캡처된 글·호출 순서에 대한 오프라인 재실행이다. 다른 게시글을 서버에서 가져오는 기능은 `read`를 사용한다. `replay`의 API 소요 시간은 원래 캡처의 기록이다. 캡처에는 업무 데이터가 있으므로 `.local`은 공유/커밋하지 않는다.

현재 테스트는 HTML 보존, KeyPack 키 해제, 연결 글 구분, 위젯 추출, 댓글 조건, 페이지 반복 감지, 출력 크기 제한, 종단 조회와 답글 누락 실패를 검증한다. 실서버에서 다중 페이지 분량의 댓글은 아직 검증하지 못했으며 페이지 분기는 모의 응답으로 검증했다.

실서버 검증 결과는 `VALIDATION.md` 참조. ECOUNT 내부 API이므로 서비스 화면/스키마 변경 시 적응이 필요하다. 읽기 요청이라도 서버의 읽음 표시 등 부수 효과는 발생할 수 있다.

## ContextGraph 확장

전체 Markdown과 세션별 그래프 수집·추가·갱신은 [CONTEXT_GRAPH.md](CONTEXT_GRAPH.md)를 참조한다. 기존 요약 출력과 별개로 `context.md`에는 수집된 노드의 전체 내용이 들어간다.
