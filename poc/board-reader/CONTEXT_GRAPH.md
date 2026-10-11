# Reader → ContextGraph

게시글을 공용 루트에 Markdown으로 수집한다. 수집과 세션 적용은 별도 동작이다. 새 세션에서 저장한 게시글을 선택하거나 `/apply-context`를 실행하면 현재 게시글의 `유형:번호`를 세션에 기록한다. 적용 후 첫 모델 요청부터 게시글 정보, 작업 디렉터리 기준 상대 경로, 선택한 작업의 폴더 구조, Markdown 스키마와 읽는 순서를 자동 주입한다. 본문과 계정 값은 자동 주입하지 않는다.

Node 22.19 이상에서 TypeScript를 직접 실행한다. [브라우저 연결 안내](../../lib/ec-context/README.md)를 참조한다.

## 독립 CLI

프로젝트 루트에서 실행한다. 수집과 조회에 Pi 세션 파일은 필요하지 않다.

```sh
# 새로 조회하고 같은 게시글 파일을 덮어쓴다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context collect dev:12345

# 인증과 서버 조회 없이 경로, 파일 트리, 무결성을 확인한다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context --entry dev:12345 describe

# 이미 저장한 모든 게시글의 프로젝트·유형·제목을 조회한다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context list-contexts

# 브라우저 없이 지정 글의 저장 자료를 확인한다. Pi 세션은 변경하지 않는다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context apply dev:12345

# 선택한 맥락을 시작 글부터 다시 수집한다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context --entry dev:12345 refresh

# 특정 저장 글의 관련 맥락을 다시 수집해 선택한 맥락에 합친다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context --entry dev:12345 refresh tp:23456

# 다른 글의 관련 맥락을 추가한다. 현재 선택은 유지한다.
node .pi/lib/ec-context/context-cli.ts \
  --store-dir .pi/context --entry dev:12345 add hub:34567
```

번호는 예시다. 실제 번호로 바꾼다. 수집 시 로그인된 Chrome의 ERP 탭이 하나여야 한다. 특정 Chrome은 `--cdp http://127.0.0.1:9222`로 지정한다. 인증은 브라우저가 전송한다.

공용 모드의 `load`, `context`, `describe`는 경로 안내 JSON을 반환한다. `--entry`로 조회할 게시글을 명시한다. `list-contexts`는 수집한 모든 게시글 목록을 반환하며 관련 글도 선택할 수 있다. `apply <유형:번호>`는 해당 글의 저장 자료를 검증하고 경로·트리·라벨용 메타데이터를 반환한다. 독립 CLI는 Pi 세션에 선택을 기록하지 않는다. `test-accounts`는 선택한 TP 파일의 계정 정보를 반환한다. 조회 명령은 네트워크를 사용하지 않는다.

TypeScript CLI는 `--store-dir` 공용 저장소를 사용한다. 기존 공용 catalog·posts·entries 형식은 유지한다. 이전 세션별 `--session-dir` CLI는 제거했다.

## 저장 규칙

```text
<저장 루트>/
├── <프로젝트 코드>/
│   └── job_<작업 번호>/
│       ├── job_<작업 번호>.md
│       ├── index.md
│       ├── 개발_스프린트/dev_<번호>.md
│       ├── 회의록/meeting_<번호>.md
│       ├── 방향결정/decision_<번호>.md
│       ├── 오류_수정/tp_<번호>.md
│       ├── 오류_수정/dp_<번호>.md
│       ├── 개발본부_Hub/hub_<번호>.md
│       └── attachments/<유형_번호>/<파일 ID>/<원본 이름>
├── hub_<작업 정보 없는 번호>/
│   ├── hub_<번호>.md
│   ├── index.md
│   └── attachments/<파일 ID>/<원본 이름>
└── .context/
    ├── catalog.json
    ├── posts/
    ├── entries/
    └── captures/
```

작업 글은 자체 프로젝트 코드·번호·제목을 사용한다. 다른 글은 표시된 연결 작업 FORM 위젯에서만 추출한다. `board_s$pjt_cd`, 연결 작업 별칭, TP의 `pjt$pjt$pjt_cd` 변형을 지원한다. 위젯 없음·빈 값과 조회·파싱 오류를 구분한다. 첨부 관계나 제목으로 작업 정보를 추정하지 않는다.

폴더와 Markdown 파일명의 공백은 `_`로 바꾼다. 프로젝트 코드가 없고 작업 번호가 있으면 루트의 `job_<번호>/`를 사용한다. 작업 번호가 없으면 자신의 `<유형>_<번호>/`를 사용한다. `프로젝트 미지정` 폴더는 만들지 않는다. 고유 키와 색인으로 위치를 찾으며 위치 변경 시 관련 파일 링크도 갱신한다.

기존 공백 경로는 수집 결과를 저장하기 전에 자동으로 변환한다. 읽기·적용만으로는 경로를 변경하지 않는다. 변환은 관리하는 파일을 이동하고 색인·Markdown 링크를 갱신하며 이전 관리 경로를 제거한다. 관리하지 않는 파일은 유지한다.

수집 없이 로컬 경로만 변환하려면 `.pi/lib/ec-context/`에서 다음을 실행한다. 이 명령은 브라우저를 연결하지 않는다.

```sh
node context-cli.ts --store-dir ../../context migrate-paths
```

## 파일 내용

모든 게시글 파일의 공통 프론트매터는 자신의 `type`, 문자열 `number`, `title`이다. `project_code`는 `job` 작업 글에만 저장한다. `job_number`, `job_title`은 저장하지 않는다. 연결 작업은 관계와 Markdown 링크로 표현한다. `index.md`는 `type: index`, `number: null`, 목록의 `title`로 구분한다.

TP에는 후보별 테스트 계정을 추가한다. 값이 없으면 `null`, 후보가 없으면 `test_accounts: []`를 기록한다.

```yaml
---
type: "tp"
number: "23456"
title: "현재 게시글의 원본 제목"
test_accounts:
  - server: "<서버>"
    company_code: "<회사코드>"
    account_id: "<계정 ID>"
    password: "<비밀번호>"
---
```

문자열은 따옴표로 저장해 앞자리 0과 특수문자를 보존한다. TP 서버·계정은 명시적 필드와 본문 영역에서 읽는다. 답글의 임의 문자열을 계정으로 추정하지 않는다.

본문에는 원문에서 뽑은 짧은 요약, 본문 전체, 추가 본문, 답글, 관련 게시글, 첨부 파일을 넣는다. 내용2의 표시 이름, 답글 순서와 중첩, 코드 공백, 표, 링크, 이미지 참조를 보존한다. 원본 API 응답과 HTML은 `captures/`에 남긴다.

## 수집과 갱신

- 지원 유형: `job`, `dev`, `meeting`, `decision`, `tp`, `dp`, `hub`.
- 시작 글의 첨부 게시글, 명시적 연결 작업, 작업 팝업의 지원 유형별 관련 LIST_GRID를 재귀 수집한다.
- 전체 페이지를 조회한다. 반복 페이지, 잘못된 개수, 콘텐츠·답글 누락은 오류로 처리한다.
- 실행당 같은 고유 키는 한 번 조회한다. 순환은 관계로 남긴다. 다른 유형의 같은 번호는 서로 다른 글이다.
- 관계는 `belongs_to`, `attach_to`, `related_to`로 구분한다.
- `collect`와 전체 `refresh`는 현재 관계를 새로 구성하고 파일을 다시 쓴다. 같은 내용도 덮어쓴다.
- `add`와 특정 글의 `refresh`는 해당 글의 관련 맥락을 재수집해 기존 선택에 합친다. 특정 갱신은 저장된 글만 지정할 수 있다.
- 사라진 관계는 갱신한 원본에서 제거한다. 다른 맥락이 사용할 공용 파일은 자동 삭제하지 않는다.
- 기본 노드 제한은 100개이며 `--max-nodes`로 바꾼다. 한도 초과나 조회 실패를 전체 성공으로 처리하지 않는다.

공용 쓰기는 파일 락으로 직렬화한다. 성공한 조회·파싱 결과만 반영한다. 일반 쓰기 오류가 발생하면 기존 파일을 복원한다. 조회 시 게시글, 목록, 다운로드 파일의 해시를 확인한다. 파일이 없거나 변했으면 재로드가 필요하다.

## 일반 첨부 파일

파일은 게시글 노드로 만들지 않는다. 본문과 답글의 첨부에서 파일 ID·이름·크기·다운로드 식별 정보를 추출한다. Pi 브라우저 전송 연결에서는 바이너리를 임시 파일로 받고, 완료한 파일만 저장하고 Markdown에 링크한다. 같은 이름은 게시글 키와 파일 ID로 구분한다. ZIP은 자동 압축 해제하지 않는다.

명시적 다운로드 URL이 있으면 로그인 브라우저 인증으로 받는다. URL이 없는 ECOUNT 파일은 현재 Chrome에 정확한 게시글 팝업이 열려 있고, 같은 원본 파일명이 하나일 때 화면의 다운로드 동작을 사용한다. 다른 게시글의 팝업을 자동으로 여는 기능은 없다. 현재 팝업에 없는 파일이나 모호한 파일은 실패로 기록한다.

실패 시 본문은 저장하고 첨부를 `download_failed`로 표시한다. 불완전 파일의 링크는 만들지 않는다. 재로드하면 현재 목록으로 다시 다운로드하며 사라진 첨부의 링크를 제거한다. 기존 바이너리는 자동 삭제하지 않는다.

`--no-downloads` 또는 Pi 설정의 `downloadAttachments: false`로 다운로드를 끌 수 있다. 독립 CLI도 같은 브라우저 다운로드 경로를 사용한다. `--no-downloads`이면 메타데이터만 저장한다.

## Pi 연결

```text
/ec-connect
/load-context dev:12345
/collect-context dev:12345
/apply-context
/apply-context dev:12345
/apply-context default
/add-context tp:23456
/update-context
/update-context tp:23456
/test-server
```

`/collect-context`는 `/load-context` 별칭이다. 두 명령은 재수집·덮어쓰기만 하며 세션의 선택·이름·라벨을 변경하지 않는다. `/apply-context`는 프로젝트 코드 → 유형 → 게시글을 선택해 이미 저장한 맥락을 적용한다. 번호를 주면 직접 적용하고, `default` 또는 기본 선택은 적용과 라벨을 해제한다. 적용에는 브라우저가 필요 없다. 취소·조회 실패·적용 중 세션 전환은 기존 선택을 유지한다. 추가·갱신은 현재 선택을 유지한다. `/test-server`는 적용한 TP 프론트매터에서 계정을 읽는다.

새 세션 생성도 같은 선택 순서를 사용한다. 선택을 마치면 맥락이 바로 적용되며 추가 명령 없이 첫 모델 요청부터 안내를 주입한다. 기본 선택은 라벨과 맥락 안내가 없는 세션을 만든다. 이후 `/apply-context`로 적용할 수 있다. `/add-context`는 관련 저장 자료를 추가 수집하는 호환 명령이며 세션 주입의 필수 단계가 아니다.

세션과 `/resume` 목록에 저장하는 이름은 `[A25_09780] DEV 23047 | 게시글 제목`이다. 프로젝트 코드가 없으면 `DEV 23047 | 게시글 제목`으로 저장한다. 입력창 위 테두리에는 `─ DEV 23047 | 게시글 제목 ───`를 한 줄로 표시한다.

하단 footer의 `[프로젝트 코드] 연결 작업 제목`은 현재 분기의 `session-label`에서 읽어 별도로 표시한다. `setFooter`는 기본 footer의 첫 경로·제목 줄만 바꾸며 사용량·모델·상태 줄은 기본 렌더러를 유지한다. 입력창 위에 프로젝트 정보나 별도 행을 추가하지 않는다. 프로젝트 코드 없는 글도 선택할 수 있으며 별도 저장 폴더는 만들지 않는다.

기존 세션을 재개하거나 `/reload`해도 저장된 이름은 자동으로 바꾸지 않는다. 맥락을 `/apply-context`로 다시 적용하면 새 이름 형식을 저장한다.

저장 루트는 `ECOUNT_CONTEXT_DIR`, `ec-context.json`의 `contextDir`, 현재 작업 디렉터리의 `.pi/context/` 순서로 결정한다. 세션별 선택은 세션 기록에서 복원하며 공용 `active.json`을 사용하지 않는다. 프롬프트에서는 진행 중인 유형·번호·제목을 한 줄, 프로젝트 코드·연결 작업 제목을 한 줄에 표시한다. `컨텍스트 저장 루트`는 현재 작업 디렉터리 기준 상대 경로다. 선택한 프로젝트·작업의 `index.md`, 작업 파일과 실제 유형 폴더만 트리에 넣고 개별 유형 게시글은 나열하지 않는다.

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

프롬프트의 파일 설명에서 `job_<번호>.md`는 작업·프로젝트 정보, `index.md`는 게시글 목록과 링크임을 안내한다. 개발은 `개발_스프린트/dev_<번호>.md`, 회의는 `회의록/meeting_<번호>.md`, 방향결정은 `방향결정/decision_<번호>.md`, 오류 수정·테스트/배포는 `오류_수정/tp_<번호>.md`·`dp_<번호>.md`, Hub는 `개발본부_Hub/hub_<번호>.md`로 찾는다. 다른 작업·독립 게시글과 첨부 파일은 Markdown 링크로 확인한다.

스키마는 공통 `type`·`number`·`title`, 작업 글만의 `project_code`, TP의 `test_accounts`와 후보별 `server`·`company_code`·`account_id`·`password`, `index.md`의 `type: index`·`number: null`을 설명한다. 작업이 없는 글은 `<유형>_<번호>/<유형>_<번호>.md`를 읽는다. 훅에서 서버 조회와 다운로드는 수행하지 않는다.

저장과 CLI 수집은 세션과 독립적이다. Pi에서 시작한 브라우저 수집은 현재 프로세스가 연결을 관리한다. Pi 종료 후에도 계속 실행하는 별도 수집 데몬은 없다.

## 검증 범위

```sh
npm run check --prefix .pi/lib/ec-context
npm test --prefix .pi/lib/ec-context
npm run test:mcp --prefix .pi/lib/ec-context
```

제공된 HTML 5개에서 자체·연결 작업, 현재 번호·제목, 프로젝트 코드 변형, 작업 위젯 없는 Hub를 확인했다. 이전 job/dev/TP/방향결정 실서버 캡처는 원문과 기존 API 동작의 증거다.

새 FORM·LIST 조회, 다중 페이지, 공용 경로와 프론트매터, 재로드, 관계 변경, 실패 복원, 동시 쓰기, 계정 조회, 첨부 저장은 자동 테스트와 모의 응답으로 검증했다. 새 API 호출과 전체 첨부 다운로드를 현재 로그인된 실서버에서 검증한 것은 아니다.
