# Pi session RAG

현재 Pi 대화 분기를 Q&A Markdown으로 요약하고, Cloudflare BGE-M3로 임베딩한 뒤 MongoDB에 저장하는 확장입니다. 저장한 요약은 벡터 검색과 BM25 키워드 검색을 함께 사용해 찾습니다.

여러 세션을 선택해 처리하려면 [일괄 적재 도구](src/batch/session-rag-batch.README.md)를 사용합니다. 별도 확장 등록은 필요하지 않습니다.

## 빠른 시작

Node.js **22.19 이상**, Pi **1.0의 `modelRegistry.complete` API**, Pi에서 사용 가능한 **`openai-codex/gpt-6-luna`** 모델이 필요합니다.

이 프로젝트에는 `.pi/settings.json`의 `+extensions/pi-session-rag/index.ts`로 이미 등록되어 있습니다. 기존 등록을 사용하고, 확장을 수정한 뒤 Pi에서 `/reload`를 실행합니다.

Pi SDK·TypeScript·Node.js 타입은 `.pi`에서 공통으로 관리하고, 이 확장은 토크나이저·MongoDB 의존성만 별도로 관리합니다. 처음 준비할 때는 프로젝트 루트에서 순서대로 실행합니다.

```powershell
npm --prefix .\.pi ci
npm --prefix .\.pi\extensions\pi-session-rag ci
```

프로젝트 루트의 `.env` 또는 `.pi/.env`에 설정을 넣습니다. 항목 예시는 `.env.example`에도 있습니다.

```dotenv
# 임베딩 생성 및 검색어 임베딩
CLOUDFLARE_ACCOUNT_ID=YOUR_32_HEX_CHARACTER_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_WORKERS_AI_TOKEN

# 선택: 두 값을 함께 설정하면 요약의 마지막 단계에서 업로드
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/
MONGODB_DB=pi_rag

# 선택: 생략하면 프로젝트 폴더 이름
MONGODB_PROJECT_ID=ec-pi-agent
```

Cloudflare Account ID는 32자리 16진수이며 API Token에는 Workers AI 권한이 필요합니다. 요약 모델 인증은 Pi의 모델 설정을 사용합니다.

TUI에서 다음 순서로 실행합니다.

```text
/reload
/rag-summary
/rag-search-setup
/rag-search MongoDB 인증 오류
```

MongoDB 미설정이면 로컬 요약·임베딩을 보관하고 업로드를 건너뜁니다. 검색에는 MongoDB Search와 Vector Search를 지원하는 환경, MongoDB와 Cloudflare 설정이 모두 필요합니다. `/rag-search-setup`은 MongoDB 설정만 사용합니다.

DB 업로드에는 쓰기·일반 인덱스 생성 권한, 검색에는 읽기 권한, `/rag-search-setup`에는 검색 인덱스 생성 권한이 필요합니다.

## 명령과 모델 도구

| 진입점 | 동작 |
|---|---|
| `/rag-summary` | 현재 분기 요약 → 실행 기록 → 임베딩 → 설정된 MongoDB 업로드 |
| `/rag-search-setup` | 없는 검색 인덱스 생성, 기존 정의와 준비 상태 확인 |
| `/rag-search [--limit N] [--session ID] 검색어` | 현재 프로젝트의 저장된 요약 검색 |
| `rag_search` | Pi 모델 도구로 같은 검색 실행. `query`, 선택적 `limit`, `sessionId` 사용 |

```text
/rag-search JSON 파싱 오류
/rag-search --limit 3 --session SESSION_ID 검색어
/rag-search -- --limit라는 표현을 검색
```

검색 결과는 기본 **10청크**입니다. `--limit`는 1 이상의 정수이며 반환할 청크 개수를 지정합니다. 각 청크의 본문은 전체를 반환합니다. 옵션은 검색어 앞에 쓰고, 검색어 자체가 `--`로 시작하면 옵션 종료 표시 `--`를 먼저 씁니다.

세 명령은 Pi가 응답 중이 아닌 TUI에서 실행합니다. `rag_search` 모델 도구는 RPC에서도 사용할 수 있습니다. 모든 진입점이 실행 상태를 공유하므로 이 확장 인스턴스에서 RAG 작업을 동시에 시작할 수 없습니다.

## 환경 설정

동일 항목의 우선순위는 **Pi 프로세스의 환경 변수 > 프로젝트 루트 `.env` > `.pi/.env`**입니다. 전역 환경 변수는 변경하지 않습니다. 환경 변수에 명시한 빈 문자열도 파일의 값을 덮습니다.

환경 파일과 결과 경로는 Pi의 현재 작업 경로 `ctx.cwd`를 기준으로 합니다. 설정은 각 단계에서 읽습니다. 이미 읽은 설정으로 진행 중인 요청에는 파일 변경이 적용되지 않으며, 아직 시작하지 않은 임베딩·업로드 단계는 변경된 값을 읽을 수 있습니다. 새 터미널 환경 변수를 사용하려면 Pi를 다시 실행해야 합니다.

`MONGODB_PROJECT_ID`를 고정하면 프로젝트 폴더 이름이 바뀌어도 동일한 검색 범위를 사용할 수 있습니다. 서로 다른 프로젝트가 같은 ID를 쓰면 같은 검색 범위로 묶입니다.

## 전체 흐름

```mermaid
flowchart TD
  A[현재 Pi 분기 획득] --> B[사용자 발화별 턴 묶기]
  B --> C[답변을 턴 순서대로 요약]
  C --> D[전체 Q&A로 세션 개요 생성]
  D --> E[Q&A Markdown과 실행 기록 저장]
  E --> F[저장된 Markdown 청킹 및 임베딩]
  F --> G[벡터 JSON 저장]
  G --> H{MongoDB 설정}
  H -->|있음| I[업로드 및 저장 검증]
  H -->|없음| J[로컬 결과 보관]
```

### 분기 수집과 턴별 요약

1. `sessionManager.getBranch()`에서 현재 활성 분기의 entry를 받습니다. 이전 분기의 요약 메타데이터는 제외합니다.
2. 사용자 발화 하나와 다음 사용자 발화 전까지의 완료된 assistant 텍스트를 한 턴으로 묶습니다. 도구 결과·도구 호출·사고·이미지의 비텍스트 내용과 실패·중단된 답변은 제외합니다.
3. 질문은 원문으로 보존합니다. 답변을 순차 요약할 때 현재 질문과 직전 턴의 질문·요약 답변을 문맥으로 제공합니다. 답변 없는 턴도 남기되 모델 호출 없이 그 상태를 기록합니다.
4. 모든 턴의 질문·요약 답변으로 개요를 한 번 생성합니다. 새 요약의 모델 호출 수는 완료된 텍스트 답변이 있는 턴 수에 개요 호출 1회를 더한 값입니다.
5. 세션·분기·원본 entry ID와 해시를 포함한 Markdown을 저장합니다. 저장 직전에 현재 분기가 처음의 스냅샷과 같은지 확인합니다.

요약 모델은 **`openai-codex/gpt-6-luna`**, reasoning effort는 **`medium`**입니다. Pi의 구조화된 `submit_summary` 도구 호출에서 비어 있지 않은 `text` 하나를 받아 검사합니다. 실행 전에 사용자에게 추가 질문을 하지 않습니다.

확장 자체의 글자 수·출력 토큰·모델 호출 횟수 상한은 없습니다. 이전의 **4,096 출력 토큰·200회 호출 제한도 현재 코드에 지정하지 않습니다.** 결과를 자르거나 더 짧게 재요약하지 않으며, 중간 요약이 원문보다 길다는 이유로 거부하지 않습니다. 모델·제공자의 실제 컨텍스트 및 출력 한도와 API 오류는 별도로 적용될 수 있습니다.

TUI는 `턴 N / 총 M — Q&A 요약 중`과 `턴 M / 총 M 완료 — 세션 개요 요약 중`을 표시합니다. 임베딩·업로드 단계에서는 현재 청크와 총 청크 수를 표시합니다.

### 임베딩

저장된 Markdown 전체를 **`@cf/baai/bge-m3`**로 임베딩합니다. 벡터는 **1,024차원**입니다. `assets/tokenizer/`의 고정 자산으로 특수 토큰을 포함한 입력 토큰 수를 세고, 청크마다 **8,192토큰** 이내로 무손실 분할합니다. 이 자산에는 모델 가중치가 없습니다.

요청은 `truncate_inputs: false`를 지정하며, 청크 텍스트를 이어 붙이면 저장된 Markdown과 같습니다. HTTP 413 또는 명확한 입력 길이 오류가 나면 실패한 청크만 더 나누어 재시도합니다. 인증·할당량·일반 오류에서는 분할 재시도를 하지 않습니다.

청크는 순차 처리하고, 모두 완료된 뒤 본문 변경 여부를 확인하여 벡터 JSON을 저장합니다. 8,192토큰은 요약 글자 수 제한과 별개인 임베딩 입력 경계입니다.

원문 질문을 포함한 완성 Markdown은 임베딩을 위해 Cloudflare로 전송됩니다. MongoDB를 설정하면 청크 본문·벡터·출처도 해당 DB에 저장합니다. 요약 프롬프트의 비밀값 생략 지시는 모든 민감정보의 탐지·제거를 보장하지 않습니다.

## 결과 저장과 재사용

```text
<프로젝트>/.pi/rag-summaries/<session-hash>/
  <snapshot-hash>.md
  metrics/<snapshot-hash>-<run-id>.json
  embeddings/<snapshot-hash>-<embedding-key>.json
  uploads/<snapshot-hash>-<embedding-key>-<run-id>.json
```

| 결과 | 내용 |
|---|---|
| Markdown | 세션 개요, 원문 질문, 요약 답변, 세션·분기·entry 출처 |
| `metrics/` | 요약 시간, 호출별 시간·상태·토큰, 턴·개요 재사용량 |
| `embeddings/` | 본문 해시, 모델·토크나이저 정책, 청크 전체 텍스트·위치·토큰·벡터, 생성 시간·API 호출 수 |
| `uploads/` | 업로드 시간·상태, DB 문서 ID, 신규·재사용 청크 수, 실패 정보 |

`session-hash`는 세션 ID의 SHA-256 앞 16자리입니다. `snapshot-hash`는 발화·분기 식별 정보·형식·프롬프트 버전으로 계산합니다. `embedding-key`는 실제 저장된 Markdown 본문 해시와 임베딩 정책으로 계산합니다. 청크의 `start`와 `end`는 Markdown의 UTF-16 위치이며 `end`는 포함하지 않습니다.

같은 스냅샷의 완성 요약은 모델 호출 없이 재사용합니다. **새 턴이 추가되면 새로운 스냅샷의 전체 턴과 개요를 다시 요약합니다. 현재는 증분 요약을 하지 않습니다.** 기존 Markdown을 편집하면 편집한 본문 기준으로 새 임베딩을 만들고 이전 벡터 파일은 보존합니다.

일치하는 벡터 캐시가 있으면 임베딩 API 호출 없이 재사용합니다. 검색어 임베딩은 검색할 때마다 생성하며 문서 벡터 캐시와 별개입니다.

원본 JSONL과 기존 완성 파일은 덮어쓰지 않습니다. 임시 파일을 완전히 기록한 뒤 같은 디렉터리에 hard link로 게시하므로 이를 지원하는 파일 시스템이 필요합니다. 보고되지 않은 모델 사용량은 `0`으로 추측하지 않고 `null`로 기록합니다. 실행 기록 저장 실패는 앞 단계의 완성본을 제거하지 않습니다.

## MongoDB 저장

| 저장소 | 주요 내용 |
|---|---|
| `rag_documents` | 프로젝트·세션·분기, 스냅샷·본문 해시, 임베딩 정책, 청크 수, 생성 기록, `staging`/`ready` 상태 |
| `rag_chunks` | 부모 문서 ID, 순번, 본문·벡터·해시, Markdown 위치, 원본 entry 참조, `searchable` 상태 |
| GridFS `rag_chunk_text` | 청크 문서의 실제 BSON 크기가 16 MiB를 넘을 때 전체 본문 저장 |

문서·청크 ID는 내용과 출처로 결정합니다. 같은 결과는 기존 내용을 검증해 재사용하고, 중단된 업로드는 누락된 청크와 검색 활성화를 복구합니다. 기존 본문·벡터·출처가 충돌하면 덮어쓰지 않습니다.

모든 청크와 로컬 원본을 검증한 뒤 부모를 `ready`, 청크를 `searchable: true`로 게시합니다. **DB 저장 완료와 검색 인덱스 반영 완료는 다릅니다.** 색인 반영은 비동기이므로 업로드 직후 검색에 나타나지 않을 수 있습니다.

## 하이브리드 검색

```mermaid
flowchart TD
  A[검색어 전체] --> B[BGE-M3 질의 임베딩]
  B --> C[Cosine 벡터 검색]
  B --> D[BM25 키워드 검색]
  C --> E[RRF 순위 결합]
  D --> E
  E --> F[현재 DB 본문·출처·상태 검증]
  F --> G[청크 전체 텍스트와 원본 entry 참조 반환]
```

현재 프로젝트·동일 임베딩 정책·검색 활성 청크를 대상으로 검색합니다. 세션 지정 시 해당 세션의 완료된 문서로 범위를 제한합니다. 한 세션의 여러 청크·스냅샷이 각각 결과로 나올 수 있습니다.

### 두 검색의 역할

- **벡터 검색:** 질문을 같은 BGE-M3로 임베딩하고 cosine 유사도, `exact: true`로 검색합니다. 긴 질문은 전체를 무손실로 나누어 각 벡터로 검색합니다.
- **키워드 검색:** `lucene.standard`로 분석한 `text` 필드를 MongoDB Search의 기본 BM25로 검색합니다. 문서 내 등장 횟수·색인에서의 희귀도·필드 길이를 반영하며 확장에서 공식을 직접 계산하지 않습니다.

키워드 검색의 `matchCriteria: "any"`는 분석된 검색어 중 하나라도 일치하면 검색 목록에 포함된다는 뜻입니다. 아래 유사도 기준도 통과해야 최종 후보가 됩니다. 한국어 전용 분석기·동의어·오타 보정·구절 검색은 설정하지 않습니다. 프로젝트 필터는 반환 범위를 제한하며 프로젝트별 IDF를 별도로 재계산하지 않습니다.

명확한 검색 절 개수 초과 오류가 날 때만 질문을 무손실 분할하고, 각 조각의 상위 후보에서 받은 BM25 점수를 청크별로 합칩니다. 이 경우 전체 질문을 한 번 검색했을 때와 같은 순위를 보장하지 않습니다.

### 순위 결합과 반환

현재 DB의 청크 벡터와 질의 벡터로 **실제 코사인 유사도 ≥ 0.65**인 항목만 후보로 남긴 뒤, 각 목록의 순위를 RRF로 합칩니다. **0.65는 포함**하고 미만은 제외합니다. 키워드 목록도 동일한 기준을 적용합니다.

긴 질문은 어느 질의 청크와든 0.65 이상인 항목이 키워드 후보로 남으며, 벡터 목록은 해당 질의 청크와의 유사도가 0.65 이상이어야 순위 결합에 기여합니다. 반환하는 `similarity`는 질의 청크별 코사인 유사도의 최댓값이며, `minSimilarity`는 적용 기준 0.65입니다. MongoDB의 정규화된 `vectorSearchScore`나 RRF 점수에 0.65를 적용하지 않습니다. [MongoDB 코사인 유사도와 정규화 점수](https://www.mongodb.com/docs/manual/reference/operator/aggregation/similaritycosine/)도 참고하세요.

질의 벡터 수가 `m`일 때 다음 식을 사용합니다.

```text
RRF = 0.5 / (60 + 키워드 순위)
    + Σ [(0.5 / m) / (60 + 질의 벡터별 순위)]
```

순위는 유사도 기준을 통과한 각 목록에서 1부터 시작하고 목록에 없는 후보의 기여는 0입니다. 키워드 가중치는 **0.5**, 전체 벡터 가중치도 **0.5**입니다. 반환하는 `score`는 RRF 점수이며 사실성 확률이 아닙니다.

키워드 요청과 각 벡터 요청은 요청한 결과 개수까지 후보를 받습니다. 키워드를 분할한 경우에는 각 조각별로 그 개수를 적용한 뒤 합칩니다. 결합 뒤 실제 DB에서 본문·부모 완료 상태·출처·해시·위치를 검사하고, 반환 직전에 변경 여부를 다시 검사합니다. 후보가 제외되면 요청한 개수보다 적게 반환할 수 있습니다. 검색 단계 하나가 실패하면 다른 단계의 부분 결과로 대체하지 않습니다.

### 검색 인덱스

`/rag-search-setup`은 `rag_chunks`에 다음 인덱스를 준비합니다.

| 인덱스 | 설정 |
|---|---|
| `pi_rag_vector_v1` | 1,024차원 `vector`, cosine, 프로젝트·정책·검색 상태·문서 ID 필터 |
| `pi_rag_text_v1` | `lucene.standard`, `text` 문자열과 같은 범위 필터 |

없는 인덱스만 생성합니다. 기존 정의가 다르면 보존하고 오류를 알립니다. 생성 요청은 완료를 기다리지 않으므로 `building`이면 나중에 같은 명령으로 확인합니다. 검색은 두 인덱스 모두 **`READY`이고 `queryable: true`**일 때 수행합니다.

## 취소와 실패 시 재실행

TUI에서 **Esc**로 취소합니다. 독립 백그라운드 작업이 아니며, Pi의 `session_shutdown` 이벤트에서 진행 중인 작업을 취소합니다. 요약 중 현재 분기가 바뀌면 저장 직전 검사에서 새 요약의 게시를 막습니다.

| 중단·실패 지점 | 남는 결과와 재실행 동작 |
|---|---|
| 요약 완료 전 | 완성 Markdown을 게시하지 않음. 다시 실행하면 요약부터 시작 |
| 임베딩 | 완성 Markdown 보존. 같은 스냅샷이면 요약 재사용 후 임베딩 재시도 |
| DB 업로드 | 로컬 Markdown·벡터 보존. 다시 실행하면 DB 기존 청크 검증·누락 복구 |

재시도 명령은 모두 `/rag-summary`입니다. 미완성 임베딩 청크를 실행 간 이어서 처리하지 않으므로 완성 벡터 파일이 없으면 임베딩을 다시 생성합니다.

## 코드 구조와 읽는 순서

| 파일 | 먼저 볼 함수와 역할 |
|---|---|
| `index.ts` | 명령 등록 → `summarizeSession` → `uploadSummary`; `runSearch`와 진행·취소 관리 |
| `src/summary.ts` | `snapshot` → `summarize` → `renderMarkdown`; `RunMetrics`와 파일 게시 |
| `src/embedding.ts` | `prepareEmbedding` → `generateEmbedding`; `embedQuery`, 설정·청킹·캐시 |
| `src/db.ts` | `uploadEmbedding`, `ensureSearchIndexes`, `searchChunks`; DB 저장·검색·출처 검사 |

테스트는 `tests/summary.test.ts`, `tests/embedding.test.ts`, `tests/db.test.ts`, `tests/extension.test.ts`로 같은 네 영역을 검증합니다.

## 검증과 현재 범위

위 설치를 마친 뒤 프로젝트 루트에서 실행합니다.

```powershell
npm --prefix .\.pi\extensions\pi-session-rag test
npm --prefix .\.pi\extensions\pi-session-rag run typecheck
```

리팩토링 검증에서는 기존 265개 테스트와 최종 정리한 **78개 동작 테스트**, 타입 검사가 통과했습니다. Pi TUI와 실제 MongoDB 조회에서 확인한 범위는 `TEST-REPORT.md`에 구분해 기록되어 있습니다.

생성 요약과 검색 결과의 검증 상태는 **`unverified`**입니다. 출처·저장 상태의 검사는 사실 검증을 의미하지 않습니다. 원본 JSONL을 다시 읽는 사실 검증, 별도 사용자 ACL, 자동 답변 생성, 증분 요약, 독립 백그라운드 실행은 현재 포함하지 않습니다. GridFS 본문은 키워드 색인에 포함되지 않아 벡터 검색으로만 후보를 찾습니다. Windows 실행은 현재 검증 기록에서 확인하지 않았습니다.
