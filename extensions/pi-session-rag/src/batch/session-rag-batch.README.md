# 세션 선택과 RAG 일괄 적재

**선택한 Pi 세션을 순차 요약하고, 임베딩과 MongoDB 업로드까지 처리하는 실행 도구.**

[pi-session-rag](../../README.md)의 요약, 임베딩, 저장 로직 재사용. 과거 세션을 하나씩 열어 `/rag-summary`를 실행하는 작업 대신, 로컬 선택 화면 또는 제목 필터로 처리 범위 지정. 별도 Extension 등록 불필요.

## 준비와 실행

Node.js **22.19 이상**, 설치된 Pi SDK, Pi에 인증된 **`openai-codex/gpt-6-luna`** 모델 필요. 요약 reasoning effort는 **`medium`**. 프로젝트 루트에서 설치 후 실행.

```powershell
npm --prefix .\.pi ci
npm --prefix .\.pi\extensions\pi-session-rag ci
node --experimental-strip-types .\.pi\extensions\pi-session-rag\src\batch\session-rag-batch.mjs
```

터미널에 출력된 `url`을 브라우저에서 열어 세션 선택. 서버는 `127.0.0.1`에만 바인딩, 주소에는 실행마다 바뀌는 접근 토큰 포함. 기본 프로젝트는 이 프로그램이 들어 있는 프로젝트, 기본 포트는 운영체제 배정.

```powershell
node --experimental-strip-types .\.pi\extensions\pi-session-rag\src\batch\session-rag-batch.mjs --root "D:\ecxsolution\ecount.nextv56\ecount.solution" --port 8787
```

선택 화면과 선택 목록 저장에는 외부 서비스 설정 불필요. **요약과 적재 시작에는 Cloudflare와 MongoDB 설정 모두 필요.** 캐시 존재 여부와 관계없이 실행 전에 설정 검사.

```dotenv
CLOUDFLARE_ACCOUNT_ID=YOUR_32_HEX_CHARACTER_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_WORKERS_AI_TOKEN
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=pi_rag

# 선택, 기본값은 프로젝트 폴더 이름
MONGODB_PROJECT_ID=ec-pi-agent
```

프로젝트 `.env` 또는 `.pi/.env`에 설정. 우선순위는 **프로세스 환경 변수 > 프로젝트 `.env` > `.pi/.env`**. Cloudflare는 Workers AI 권한, MongoDB는 쓰기와 일반 인덱스 생성 권한 필요. 전체 설정은 [Extension README](../../README.md#설치와-실행) 참고.

## 처리 범위 선택

1. `.pi/sessions`의 모든 하위 폴더에서 Pi version 3 JSONL 수집.
2. 제목, 파일 경로, 세션 ID로 검색 후 **대화 보기**에서 사용자와 assistant 텍스트 확인. 미리보기에는 파일의 여러 분기 포함.
3. 세션을 체크하고 분기 범위 선택. **보이는 목록 선택**은 현재 검색 결과의 선택 가능 항목만 지정.
4. **선택 저장**으로 목록만 보관. 요약과 적재 버튼으로 선택 저장 후 처리 실행.

읽기 오류 또는 사용자 발화 없는 파일은 선택 차단.

| 분기 범위 | 대상 |
| --- | --- |
| `latest`, 기본값 | Pi 로더가 판단한 최신 leaf까지의 대화 경로 하나 |
| `all` | 사용자 발화가 있는 각 마지막 leaf의 대화 경로 |

분기는 entry 부모 관계로 해석. 모든 분기 선택 시 공통 대화가 여러 요약에 포함될 수 있음.

### 제목을 지정한 세션 처리

브라우저와 선택 서버 없이 제목이 있는 세션만 처리. 기본 범위는 최신 분기.

```powershell
node --experimental-strip-types .\.pi\extensions\pi-session-rag\src\batch\session-rag-batch.mjs --named
node --experimental-strip-types .\.pi\extensions\pi-session-rag\src\batch\session-rag-batch.mjs --named --scope all --limit 50
```

마지막 `session_info.name`이 비어 있지 않은 세션만 선택. 첫 질문 기반 표시 제목, 지운 이름, `subagent-<역할>-<UUID 또는 8자리 실행 ID>-<번호>` 형식의 자동 이름은 제외. 이름 필터 후 생성일의 최근 순서로 `--limit` 적용, 생략 시 전체 선택. `--scope`, `--limit`는 `--named`와 함께 사용. 진행 상태는 터미널 출력, **Ctrl+C**로 취소.

## 처리와 결과

```text
세션과 분기 선택 → 선택 목록과 원본 해시 저장
→ 턴별 답변 요약과 세션 개요 → Q&A Markdown과 실행 기록
→ 본문 청킹과 BGE-M3 임베딩 → 벡터 저장 → MongoDB 업로드와 검사
```

세션, 분기, 턴, 임베딩 청크 모두 순차 처리. 원문 질문 보존, 완료된 assistant 텍스트만 요약. 도구 호출과 결과, 사고, 이미지의 비텍스트 내용, 실패하거나 중단된 답변 제외. 답변 없는 턴도 상태 보존.

요약은 직전 턴의 질문과 요약 답변을 문맥으로 사용, 전체 Q&A로 개요 생성. `submit_summary`의 비어 있지 않은 `text` 하나 검사. 새 요약의 모델 호출 수는 텍스트 답변이 있는 턴 수 + 개요 1회. 프로그램의 요약 글자 수, 출력 토큰, 호출 횟수 상한은 없으며 모델 서비스 한도는 별도 적용.

임베딩은 BGE-M3 **1,024차원**, 청크당 **8,192토큰** 이내 무손실 분할. 세부 정책과 MongoDB 저장 구조는 [Extension README](../../README.md#임베딩과-결과-보관) 참고. 검색 인덱스 준비와 검색은 Pi의 `/rag-search-setup`, `/rag-search`에서 실행. 업로드 직후 검색 반영에는 지연 가능.

```text
.pi/
  rag-batch/
    selection.json                      # 마지막 선택 목록
    <run-id>.json                       # 전체 실행 결과
  rag-summaries/<session-hash>/
    <snapshot-hash>.md                  # Q&A Markdown
    metrics/<snapshot>-<run>.json       # 요약 시간, 토큰, 재사용량
    embeddings/<snapshot>-<key>.json    # 청크 본문, 위치, 토큰, 벡터, 정책
    uploads/<snapshot>-<key>-<run>.json  # 업로드 상태와 DB ID
```

`selection.json`은 세션 경로, ID, 원본 파일 해시, leaf ID 보관. 선택 저장 시 갱신, 다음 선택 화면에서 복원. 실행 결과는 매번 새 파일로 저장하며 분기별 상태, 실패 단계, 경과 시간, 결과 경로, DB 문서 ID 포함.

원본 JSONL은 메모리 전용 Pi 로더로 읽기만 수행. 요약 대상은 Pi 모델로, 원문 질문을 포함한 Markdown은 Cloudflare로, 청크 본문과 벡터, 출처는 MongoDB로 전송. 요약과 검색 결과는 `unverified`이며 개인정보 자동 제거는 보장하지 않음.

## 취소와 재실행

전체 분기 수, 현재 파일과 요약 턴, 임베딩과 DB 청크, 분기별 결과 표시. 브라우저를 닫거나 Pi 세션을 옮겨도 Node 프로세스 실행 중이면 처리 지속. 프로세스 종료와 컴퓨터 절전 이후 자동 복원은 미지원.

화면의 **처리 취소**는 현재 요청과 남은 분기를 취소. **Ctrl+C**는 취소 요청 후 서버 종료. 완료한 로컬 결과와 DB 내용 보존. 한 분기 실패 시 단계와 오류 기록 후 다음 분기 계속 처리, 필수 설정 오류는 실행 시작 차단.

- **재사용:** 동일 스냅샷의 완성 Markdown과 일치하는 벡터 캐시 재사용. DB 내용 검사 후 누락 청크와 게시 상태 복구, 충돌 시 덮어쓰기 차단.
- **실패 보존:** 임베딩 실패 시 Markdown, 업로드 실패 시 Markdown과 벡터 보존. 완성 벡터 파일이 없으면 임베딩 처음부터 재생성.
- **새 대화:** 새 스냅샷의 전체 턴과 개요 다시 요약. 증분 요약 미지원.
- **원본 변경:** 처리 전, 새 요약 게시 전, DB 업로드 전에 해시 검사. 변경 시 목록 새로고침 후 재선택과 저장 필요. `--named` 재실행은 선택 목록 새로 생성.
- **누락 entry:** 선택 분기의 부모 누락은 실패. 다른 분기의 누락은 경고 후 정상 최신 분기 처리.
- **실행 잠금:** 같은 서버의 중복 실행과 처리 중 선택 변경 차단. 별도 프로세스나 Pi Extension과 잠금 미공유. 같은 기록의 동시 처리 금지.

완성 파일 게시에는 hard link를 지원하는 파일 시스템 필요.

## 코드와 검증

| 파일 | 역할 |
| --- | --- |
| [`session-rag-batch.mjs`](session-rag-batch.mjs) | `scanSessions` → `readSession` → `selectSessions` → `processSelection`, 서버 진입점 `startServer` |
| [`session-rag-batch.html`](session-rag-batch.html) | 세션 검색, 선택, 미리보기, 진행 상태와 취소 |
| [`session-rag-batch.test.mjs`](../../tests/batch/session-rag-batch.test.mjs) | 선택 범위, 원본 보존, 재사용, 실패와 취소, 로컬 API |
| [Extension 코드](../../README.md#코드와-검증) | 요약, 임베딩, DB 저장 공통 로직 |

프로젝트 루트에서 실행.

```powershell
npm --prefix .\.pi\extensions\pi-session-rag run test:batch
npm --prefix .\.pi\extensions\pi-session-rag test
npm --prefix .\.pi\extensions\pi-session-rag run typecheck
```

자동 테스트는 모델, Cloudflare, MongoDB를 모의 응답으로 대체. 실제 Pi 분기 로더, 토크나이저, 임시 파일과 로컬 HTTP 서버 사용, 원본 세션 쓰기 없음. 로컬 서버 실행 권한 필요. 실제 인증, 서비스 응답, DB 신규 적재, Windows 동작은 별도 실환경 검증 대상.
