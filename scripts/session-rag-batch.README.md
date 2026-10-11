# 세션 선택 · RAG 일괄 적재

`.pi/sessions`의 대화 기록을 체크박스로 선택하고, 선택한 세션만 **요약 → 임베딩 → MongoDB 업로드** 순서로 처리하는 일회용 프로그램입니다.

기존 [`pi-session-rag` 확장](../extensions/pi-session-rag/README.md)의 요약·임베딩·DB 저장 함수를 그대로 사용합니다. 별도 확장 등록은 필요하지 않습니다.

## 실행

프로젝트 루트에서 실행합니다.

```sh
node --experimental-strip-types .pi/scripts/session-rag-batch.mjs
```

터미널에 출력된 `url`을 브라우저에서 엽니다. 주소에는 접근 토큰이 포함되며, 실행할 때마다 달라집니다. 서버는 `127.0.0.1`에만 열립니다.

프로젝트 경로나 포트를 지정할 수도 있습니다. 기본 프로젝트는 이 프로그램이 들어 있는 프로젝트이고, 기본 포트는 운영체제가 배정합니다.

```sh
node --experimental-strip-types .pi/scripts/session-rag-batch.mjs --root /path/to/ec-pi-agent --port 8787
```

Node.js **22.19 이상**과 프로젝트의 로컬 Pi SDK·확장 의존성이 필요합니다. 처음 의존성을 준비할 때만 다음을 실행합니다.

```sh
npm --prefix .pi ci
npm --prefix .pi/extensions/pi-session-rag ci
```

요약에는 Pi에 설정된 **`openai-codex/gpt-6-luna` 인증**을 사용하고, reasoning effort는 **`medium`**입니다. 프로그램은 `.pi/node_modules`의 Pi SDK를 사용합니다.

## 직접 제목을 지정한 세션만 변환

체크박스 선택 없이 저장된 제목이 있는 세션만 바로 요약·임베딩·DB 적재하려면 실행합니다.

```sh
node --experimental-strip-types .pi/scripts/session-rag-batch.mjs --named
```

Pi의 마지막 `session_info.name`이 비어 있지 않은 세션을 선택합니다. 첫 질문에서 만든 표시 제목, 지워진 이름, `subagent-<역할>-<UUID 또는 8자리 실행 ID>-<번호>` 형식의 자동 하위 에이전트 이름은 제외합니다. 선택 목록과 전체 실행 결과는 체크박스 방식과 같은 경로에 저장됩니다.

기본 범위는 각 세션의 최신 분기입니다. 모든 분기를 처리하려면 `--named --scope all`을 사용합니다. 진행 상태는 터미널에 출력하며 **Ctrl+C**로 취소합니다. 이 모드는 브라우저나 선택 서버를 사용하지 않습니다.

생성일 기준 최근 개수만 처리하려면 `--limit`를 지정합니다. 이름 없는 세션과 자동 이름을 제외한 다음 최근 순서로 개수를 적용합니다. 생략하면 지정한 제목이 있는 전체 세션이 대상입니다.

```sh
node --experimental-strip-types .pi/scripts/session-rag-batch.mjs --named --limit 50
```

## 설정

선택 화면을 열고 선택 목록을 저장하는 데는 외부 서비스 설정이 필요하지 않습니다. **요약·적재를 시작하려면 Cloudflare와 MongoDB 설정이 모두 필요합니다.**

프로젝트의 `.env` 또는 `.pi/.env`에 넣습니다.

```dotenv
CLOUDFLARE_ACCOUNT_ID=YOUR_32_HEX_CHARACTER_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_WORKERS_AI_TOKEN

MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=pi_rag

# 선택: 생략하면 프로젝트 폴더 이름
MONGODB_PROJECT_ID=ec-pi-agent
```

동일 항목의 우선순위는 **프로세스 환경 변수 > 프로젝트 `.env` > `.pi/.env`**입니다. Cloudflare 토큰에는 Workers AI 사용 권한, MongoDB 계정에는 쓰기·일반 인덱스 생성 권한이 필요합니다. 이 프로그램은 캐시가 있어도 실행 시작 전에 두 서비스의 설정을 검사합니다.

## 대화 기록 선택

1. 제목·파일 경로·세션 ID로 검색합니다. `.pi/sessions` 아래의 **모든 하위 폴더에 있는 JSONL**을 목록에 포함합니다.
2. **대화 보기**에서 사용자와 assistant의 텍스트 기록을 확인합니다. 미리보기에는 파일에 있는 여러 분기의 대화가 함께 표시됩니다.
3. 적재할 세션을 체크하고 분기 범위를 선택합니다.
4. **선택 저장**을 누르면 선택 목록만 저장합니다. 모델 호출·임베딩·DB 업로드는 시작하지 않습니다.
5. **선택한 세션 요약·적재**를 누르면 현재 선택을 저장하고 처리를 시작합니다.

**보이는 목록 선택**은 현재 검색 결과의 선택 가능한 세션을 모두 체크합니다. 읽기 오류가 있거나 요약할 사용자 발화가 없는 파일은 오류를 표시하고 선택을 막습니다. 현재 로더는 **Pi version 3 JSONL**을 지원합니다.

| 분기 범위 | 처리 대상 |
|---|---|
| 각 세션의 최신 분기, 기본값 | Pi 로더가 판단한 최신 leaf까지의 대화 경로 하나 |
| 선택한 세션의 모든 분기 | 사용자 발화가 있는 각 마지막 leaf의 대화 경로를 각각 처리 |

모든 분기를 선택하면 공통된 앞부분의 대화가 여러 분기의 요약에 포함될 수 있습니다. 분기는 저장된 entry의 부모 관계로 해석합니다.

## 처리 흐름

```mermaid
flowchart TD
    A[하위 폴더까지 JSONL 목록 읽기] --> B[사용자가 세션과 분기 범위 선택]
    B --> C[선택 목록과 원본 파일 해시 저장]
    C --> D[선택한 세션의 분기를 하나씩 처리]
    D --> E[사용자 발화별 턴 묶기]
    E --> F[턴별 답변 요약 후 세션 개요 생성]
    F --> G[Q&A Markdown과 요약 실행 기록 저장]
    G --> H[Markdown 청킹과 BGE-M3 임베딩]
    H --> I[벡터 JSON 저장]
    I --> J[MongoDB 업로드와 저장 검증]
    J --> K{남은 분기}
    K -->|있음| D
    K -->|없음| L[전체 실행 결과 JSON 저장]
```

세션·분기·턴·임베딩 청크는 **순차 처리**합니다. 요약은 사용자 질문 하나와 다음 사용자 질문 전까지의 완료된 assistant 텍스트를 한 턴으로 묶습니다.

- 질문은 원문으로 보존하고 답변을 요약합니다. 도구 호출·도구 결과·사고·이미지의 비텍스트 내용과 실패·중단된 답변은 요약 대상에서 제외합니다.
- 각 답변 요약에는 현재 질문과 직전 턴의 질문·요약 답변을 문맥으로 제공합니다. 모든 턴을 처리한 뒤 전체 Q&A로 세션 개요를 생성합니다.
- 답변 없는 턴도 남깁니다. 새 요약의 모델 호출 수는 완료된 텍스트 답변이 있는 턴 수에 개요 생성 **1회**를 더한 값입니다.
- 결과를 자르거나 더 짧게 재요약하지 않습니다. 프로그램이 지정하는 요약 글자 수·출력 토큰·모델 호출 횟수 상한은 없으며, 모델 서비스의 입력·출력 한계는 적용됩니다.
- 모델 응답은 `submit_summary` 호출의 비어 있지 않은 `text` 하나를 검사합니다. 임베딩은 BGE-M3의 **1,024차원 벡터**를 사용하며, **8,192토큰** 입력 경계에 맞춰 본문 전체를 무손실로 나눕니다.

원문 질문이 포함된 Markdown은 임베딩을 위해 Cloudflare로 전송됩니다. 청크 본문·벡터·출처는 설정한 MongoDB에 저장됩니다.

## 결과 저장 위치

```text
.pi/
  rag-batch/
    selection.json                    # 마지막으로 저장한 선택 목록
    <run-id>.json                     # 전체 실행 결과
  rag-summaries/
    <session-hash>/
      <snapshot-hash>.md              # Q&A Markdown
      metrics/<snapshot>-<run>.json   # 요약 시간·토큰·재사용량
      embeddings/<snapshot>-<key>.json
      uploads/<snapshot>-<key>-<run>.json
```

`selection.json`에는 세션 경로·ID·선택 당시 파일 해시·처리할 leaf ID를 저장합니다. 선택 저장 시 갱신하며, 다음 실행에서 선택 화면에 복원합니다. 전체 실행 기록은 실행마다 새 파일로 저장하고, 분기별 완료·실패·취소 상태, 실패 단계, 경과 시간, 결과 파일 경로와 DB 문서 ID를 포함합니다.

임베딩 JSON에는 청크의 전체 텍스트·Markdown 위치·토큰 수·벡터와 모델 정책을 저장합니다. MongoDB에는 `rag_documents`에 부모 문서·출처·상태를, `rag_chunks`에 청크 본문·벡터·출처를 저장합니다. 큰 청크 본문은 기존 확장의 GridFS 저장 규칙을 따릅니다.

DB 저장 구조와 검색 방식은 [기존 확장 README](../extensions/pi-session-rag/README.md#mongodb-저장)를 참고하세요. 이 프로그램은 업로드를 수행하고, 검색 인덱스 준비와 검색은 Pi의 `/rag-search-setup`, `/rag-search`로 실행합니다. 업로드 직후에는 검색 색인 반영까지 시간이 걸릴 수 있습니다.

## 진행 상태·취소·재실행

화면에서 전체 분기 수, 현재 파일, 현재 요약 턴·전체 턴, 개요 생성, 임베딩·DB 청크 진행 상태와 분기별 결과를 확인합니다.

**브라우저를 닫거나 Pi 세션을 옮겨도 프로그램 프로세스가 실행 중이면 계속 처리합니다.** 터미널에서 실행한 Node 프로세스를 유지해야 합니다. 프로세스가 종료되거나 컴퓨터가 잠들면 진행을 보장하지 않으며, 다음 실행에서 진행 중이던 작업을 자동 복원하지 않습니다.

화면의 **처리 취소**는 현재 요청과 남은 분기 처리를 취소합니다. 터미널의 **Ctrl+C**는 취소를 요청하고 서버를 종료합니다. 이미 완료한 로컬 결과와 DB 저장 내용은 보존합니다.

한 분기가 실패하면 실패 단계와 오류를 기록하고 다음 분기를 계속 처리합니다. 필수 설정 오류는 실행 시작을 막습니다. JSON 형식 오류·빈 모델 응답·원본 변경·외부 서비스 오류는 실패할 수 있습니다.

다시 실행할 때는 화면에서 세션을 선택해 **선택한 세션 요약·적재**를 누릅니다.

- 같은 스냅샷의 완성 Markdown과 일치하는 벡터 캐시는 재사용합니다.
- DB에 같은 문서·청크가 있으면 내용을 검증하고 누락된 청크와 게시 상태를 복구합니다. 충돌하는 기존 내용은 덮어쓰지 않습니다.
- 임베딩 실패 시 완성 Markdown을, 업로드 실패 시 Markdown과 벡터를 보존합니다. 완성 벡터 파일이 없으면 임베딩 청크를 처음부터 다시 생성합니다.
- **새 턴이 추가되면 전체 턴과 개요를 새 스냅샷으로 다시 요약합니다. 증분 요약은 구현하지 않았습니다.**

원본 JSONL은 메모리 전용 Pi 로더로 읽으며 수정하거나 마이그레이션하지 않습니다. 선택 후 원본이 변경되면 처리를 막으므로 **목록 새로고침 후 선택을 다시 저장·실행**하세요. `--named` 방식은 다시 실행할 때 선택 목록을 새로 만듭니다. 검사는 분기 처리 전, 새 요약 게시 전, DB 업로드 전에 수행합니다.

다른 분기의 부모 entry가 누락되어도 정상적인 최신 분기는 처리하고 경고를 기록합니다. 처리할 분기 자체의 부모가 누락되면 불완전한 경로를 정상 대화로 간주하지 않고 해당 분기를 실패로 기록합니다.

같은 서버에서 중복 실행과 처리 중 선택 변경을 막습니다. 별도 프로세스나 Pi 확장과의 실행 잠금은 공유하지 않으므로, 같은 기록을 여러 실행에서 동시에 처리하지 마세요. 결과 파일 게시는 기존 확장의 hard link 저장 방식을 사용하므로 이를 지원하는 파일 시스템이 필요합니다.

## 코드와 검증

| 파일 | 역할 |
|---|---|
| [`session-rag-batch.mjs`](./session-rag-batch.mjs) | JSONL 목록·분기 읽기, 선택 저장, 순차 처리, 로컬 서버 |
| [`session-rag-batch.html`](./session-rag-batch.html) | 체크박스·검색·미리보기·진행 상태·취소 화면 |
| [`session-rag-batch.test.mjs`](./session-rag-batch.test.mjs) | 선택 범위, 원본 보존, 긴 결과, 재사용, 실패·취소와 로컬 API 검증 |
| [`pi-session-rag`](../extensions/pi-session-rag/README.md#코드-구조와-읽는-순서) | 실제 요약·임베딩·DB 저장 로직 |

흐름을 읽으려면 `scanSessions` → `readSession` → `selectSessions` → `processSelection` 순서로 확인하세요. 서버 진입점은 `startServer`입니다.

프로젝트 루트에서 테스트합니다.

```sh
node --experimental-strip-types --test .pi/scripts/session-rag-batch.test.mjs
npm --prefix .pi/extensions/pi-session-rag test
npm --prefix .pi/extensions/pi-session-rag run typecheck
```

일괄 처리 테스트는 모델·Cloudflare·MongoDB 응답을 대체합니다. 임시 파일, 실제 Pi 분기 로더·토크나이저와 로컬 HTTP 서버를 사용하며 원본 세션에 쓰지 않습니다. 테스트 환경에는 로컬 서버를 여는 권한이 필요합니다. 실제 서비스 인증·응답·DB 적재와 Windows 실행은 별도 실환경 검증이 필요합니다.
