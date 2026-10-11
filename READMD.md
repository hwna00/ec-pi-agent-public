# Pi Agent Harness

ERP 개발을 위한 Pi 기반 에이전트 하네스.

역할별 서브에이전트, IDE·DB·브라우저 연동, 업무 컨텍스트 수집, 세션 RAG로 확장한 개발 환경.

## Architecture

![Pi 하네스 연결 구조](reports/pi-harness-architecture.png)

| 연결 | 기능 | 실행 경로 |
| --- | --- | --- |
| Pi → IDE | 디버그 실행·중지, 콘솔 조회 | `pi-vscode` → VS Code HTTP 브리지 |
| Pi → Git | 소스·산출물 브랜치 동기화 | `gco` → Git 스크립트 |
| Pi → DB | 스키마·데이터·업무 설정 조회 | `pg_zeus` MCP |
| Pi → Vector DB | 세션 요약 저장·검색 | `pi-session-rag` → MongoDB |
| Pi → Website | 화면·통신 조사, 게시글·첨부 수집 | 브라우저 MCP·`context-graph`·`DebugMCP` |

## Work Context

![업무 컨텍스트 수집·저장·세션 적용 구조](reports/pi-work-context-flow.png)

- 관련 게시글·답글·첨부 수집과 업무 단위 저장
- 선택한 자료의 경로·파일 트리를 Pi에 전달
- 코드 분석과 구현에 필요한 업무 배경 제공

### 브라우저 연결

Pi의 브라우저 관리 계층에서 Chrome의 CDP(원격 디버깅) 연결을 확보하고, WebSocket 주소를 Chrome DevTools MCP에 전달.

1. 기존 Chrome 연결과 저장된 ERP 탭 복원, 후보가 여러 개면 연결할 탭 선택.
2. 선택한 탭의 읽기 전용 ERP API로 로그인 상태와 게시판 접근 권한 검증.
3. 검증된 탭에서 `fetch(credentials: include)`로 게시글 API 조회, 브라우저의 쿠키·로그인 세션 재사용.

로그인된 ERP 탭이 없으면 연결된 브라우저에 로그인 탭을 열고 자동 로그인.

기존 Chrome 연결에는 `chrome://inspect/#remote-debugging`의 원격 디버깅 설정과 연결 허용 필요.

`/ec-connect`로 연결·재연결, `/load-context`에서 필요할 때 같은 연결 절차 실행.

### 업무 트리

프로젝트 아래 작업(job)을 중심으로 개발(dev), 회의(meeting), 오류수정(tp·dp), 첨부 파일을 묶은 저장 구조.

연결 작업이 있는 자료는 업무 폴더에 배치하고, `index.md`에 관련 게시글 목록 구성.

```text
.pi/context/
└── <프로젝트 코드>/
    └── job_<작업 번호>/
        ├── job_<작업 번호>.md
        ├── index.md
        ├── 개발_스프린트/
        │   └── dev_<개발 번호>.md
        ├── 회의록/
        │   └── meeting_<회의 번호>.md
        ├── 오류_수정/
        │   ├── tp_<오류 번호>.md
        │   └── dp_<배포 번호>.md
        └── attachments/
```

### 프롬프트 전달 정보

게시글·프로젝트 메타데이터, 저장 경로·파일 트리, Markdown 형식과 읽기 지침 중심의 얇은 참조 스키마.

- 선택 글의 유형·번호·제목, 프로젝트 코드·연결 작업 제목
- 작업 디렉터리 기준 저장 루트, 선택한 업무의 파일·폴더 트리
- 유형별 폴더 설명, YAML 프론트매터·본문 구성·파일명 규칙과 읽기 지침

전체 본문 자동 주입 없이 메타데이터·경로·트리·파일 형식 안내 전달.

본문·답글·첨부 내용은 `index.md`와 Markdown 링크를 따라 필요할 때 Pi의 파일 도구로 조회.

### 수집과 적용 명령

| 명령 | 역할 |
| --- | --- |
| `/load-context <유형>:<번호>` | 브라우저에서 기준 글·관련 글·첨부 수집과 로컬 저장, 현재 세션의 선택 유지 |
| `/apply-context [유형:번호]` | 재수집·브라우저 연결 없이 로컬 자료를 현재 세션에 적용하고 선택·라벨 갱신 |

`/apply-context` 인자 생략 시 프로젝트 → 유형 → 게시글 순서로 선택.

`/apply-context default`로 적용된 맥락과 세션 라벨 해제.

## Session RAG

과거 세션의 분석 근거와 해결 과정을 현재 작업에서 참고하기 위한 검색 기능.

![세션 RAG 저장·검색 흐름](reports/pi-session-rag-flow.png)

| 단계 | 기능 |
| --- | --- |
| 수집 | 현재 메인 분기의 사용자·에이전트 텍스트를 질문·답변 단위로 구성 |
| 요약 | 원문 질문 보존, 턴별 답변 요약과 전체 세션 개요 생성 |
| 임베딩 | 요약 Markdown을 토큰 한도에 맞춰 무손실 분할하고 Cloudflare BGE-M3로 벡터 생성 |
| 저장 | 로컬 Markdown·벡터 보관과 MongoDB 문서·청크 저장 |
| 검색 | 의미 기반 벡터 검색과 BM25 키워드 검색, 코사인 유사도 필터와 RRF 순위 결합 |
| 반환 | 본문·출처 검증 후 청크 전체 텍스트와 세션·분기·원본 entry 참조 반환 |

### 설계 포인트

- **출처 추적:** 질문·답변과 원본 세션·분기·entry 식별 정보 연결
- **결과 재사용:** 동일 스냅샷의 완성 요약과 본문·임베딩 정책이 일치하는 벡터 캐시 재사용
- **완성본 보존:** 임베딩·업로드 실패 시 앞 단계의 완성 파일 보존
- **검색 범위:** 현재 프로젝트의 검색 활성 청크 대상, 특정 세션 필터 지원

자동 수집 제외: 도구 호출·결과, 사고 과정, 이미지의 비텍스트 내용, 서브에이전트 원문.

검색에 보관할 서브에이전트 결과는 메인의 일반 답변 텍스트로 정리.

## Subagents

역할별로 작업을 나눠 메인 Pi의 컨텍스트 부담을 줄이고, 분석·구현·검증의 책임을 명확히 하기 위한 구성.

- 다섯 역할로 분리한 프롬프트·추가 도구·스킬
- 메인 Pi의 작업 위임과 역할별 결과·근거 보고

| 역할 | 담당 | 추가 도구 | 스킬 |
| --- | --- | --- | --- |
| [기술분석반](agents/technical-analysis.md) | 코드·제약 분석과 구조 설계 | Debug Console, Serena, Graphify 조회 | — |
| [데이터 조사반](agents/data-investigation.md) | 스키마·데이터·업무 설정 조사 | `pg_zeus` | `query-bizz-setting`, `query-template-setting`, `query-search-item-setting` |
| [현장 조사반](agents/field-investigation.md) | 화면·사용 흐름·통신 조사 | `DebugMCP`, `browser-tools` | `eccp` |
| [개발반](agents/development.md) | 기능 구현·버그 수정·마이그레이션·테스트 작성 | — | `ponytail` |
| [검증반](agents/verification.md) | Velox 서버 테스트 | Debug Console | `valuep-migration-verification` |

`pi-subagents` 기반의 역할 구성.

- 기술분석반·검증반: `pi-vscode` 연동
- 현장 조사반: `browser-tools` 연동
- 데이터 조사반: `switch-pg-connection` 연동

## Custom Extensions

| 확장 | 기능 |
| --- | --- |
| [context-graph](extensions/context-graph.ts) | 관련 게시글·관계·첨부 수집, 저장 경로와 파일 트리 안내 |
| [pi-session-rag](extensions/pi-session-rag/README.md) | Q&A 요약·BGE-M3 임베딩·MongoDB 저장·검색 |
| [pi-vscode](extensions/pi-vscode/README.md) | VS Code compound 디버그 실행·중지와 콘솔 로그 조회 |
| [gco](extensions/gco.ts) | 디버거 종료 후 소스 rebase, 산출물 브랜치 정리·pull |
| [switch-pg-connection](extensions/switch-pg-connection.ts) | `pg_zeus` 이름을 유지하며 접속 주소 변경·reload |
| [session-label-editor](extensions/session-label-editor.ts) | 세션 제목·분류 편집과 입력창 표시 |

## MCP

| MCP | 연동 목적 |
| --- | --- |
| Graphify·Serena | 코드의 심볼·호출·의존 관계 탐색 |
| `pg_zeus` | PostgreSQL 스키마·데이터 조회 |
| `DebugMCP` | 웹·외부 시스템 조사 |
| Chrome DevTools·Playwright | ERP 브라우저 연결·제어와 업무 자료 수집 |

## Skills

ERP 데이터 조사, 업무 컨텍스트 조회, 이관 검증, 개발 흐름 자동화 중심의 대표 스킬.

| 스킬 | 기능 |
| --- | --- |
| [query-bizz-setting](skills/query-bizz-setting/SKILL.md) | 업무 속성·항목 조회용 SQL 템플릿과 런타임 코드 대응 정리 |
| [query-template-setting](skills/query-template-setting/SKILL.md) | 화면·인쇄·현황 양식의 항목과 속성 조회 절차 |
| [query-search-item-setting](skills/query-search-item-setting/SKILL.md) | 검색 컬럼과 사용자별 검색 탭 설정 조회 |
|  |
| [html-report](skills/html-report/SKILL.md) | 독립 HTML 기술 보고서의 구조·문체·레이아웃 |
| [asd-ste100](skills/asd-ste100/SKILL.md) | 간결하고 명확한 문장 작성 |

## 디렉터리

```text
.pi/
├── settings.json       # 메인 도구·확장·스킬·패키지 선택
├── mcp.json            # 외부 MCP 서버 등록
├── agents/             # 역할·도구·스킬·작업 정책
├── extensions/         # Pi 명령·도구·이벤트 확장
├── skills/             # 작업 절차와 작성 규칙
├── scripts/            # Git·RAG 등 보조 실행 스크립트
├── context/            # 게시글·관계·첨부·수집 기록
├── sessions/           # Pi 세션 기록
└── rag-summaries/      # 세션 Q&A 요약·임베딩 결과
```

