---
name: html-report
description: HTML 형식의 기술 보고서를 작성할 때 사용한다. 사용자가 "HTML 보고서", "보고서 HTML로", "기술 보고서 문서화해줘" 등을 요청하면 이 스킬로 레이아웃/색상/코드 하이라이트 규칙을 적용해 단일 HTML 파일을 만든다.
---

# HTML 보고서 작성 규칙

caveman 플러그인이 활성 상태여도 이 스킬로 작성하는 HTML 문서 본문·설명에는
압축 말투를 적용하지 않는다. 이 문서의 문체·구조 규칙이 우선한다.

본문 한국어는 `@.claude/rules/report-style.md`의 "번역투 · AI 티 제거" 항을 따른다.
번역투가 눈에 띄면 `humanize-korean` 스킬로 윤문한 뒤 HTML에 넣는다 (문체만, 숫자·근거는 불변).

## 0. 보고서 메타 — 필수 선언 (없으면 기본값 적용)

보고서 생성 요청 시 아래 세 항목을 함께 명시한다.
명시하지 않으면 괄호 안의 기본값을 적용한다.

```
독자:  팀 내 개발자 / 외부 공유  (기본: 팀 내 개발자)
용도:  내부 기술 공유 / 외부 배포  (기본: 내부 기술 공유)
밀도:  간결 요약 / 표준 / 상세 전수  (기본: 표준)
```

이 세 항목이 모든 시각화·레이아웃 선택의 기준이 된다.

**메타 → 시각화 매핑 가이드:**

| 메타 항목 | 값 | 시각화 영향 |
|---|---|---|
| **독자** | 팀장·부문장 등 상급자 | 수치 카드 허용, 파이차트 적극 사용 |
| **독자** | 팀 내 개발자 | 수치 카드 금지(표로 전달), 코드 블록·표 우선 |
| **밀도** | 간결 요약 | 파이차트·비교 카드 등 시각 요약 우선. 상세 텍스트 최소화 |
| **밀도** | 상세 전수 | 코드 블록·표 중심. 시각화는 보조 |
| **용도** | 외부 배포 | 사내 전용 용어에 주석 추가, 수치 카드 허용 |

---

## 1. 모드 선택 (기본: 라이트)

- 명시하지 않으면 **라이트 모드** 적용
- 다크 모드는 `[다크 모드로]` 지시 시에만
- 두 모드 동시 구현 금지

---

## 2. 구조 규칙

### 2-1. HTML 구조

- 단일 `.html` 파일로 출력
- 외부 CSS, CDN 라이브러리 금지. **예외 1개 — 웹폰트 Pretendard.** 아래 `<link>` 한 줄만 허용한다. 폰트는 못 받아도 fallback 스택으로 정상 표시되므로 오프라인에서도 안 깨진다.
  ```html
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  ```
- **mermaid 금지** — CDN 스크립트가 필요해서 사내망·오프라인에서 안 그려진다. 흐름도는 §9-2 인라인 SVG로 직접 그린다. mermaid는 md 산출물에서만 쓴다.
- **`<header>` · 본문 · `<footer>` 전부 `<main>` 안**에 넣는다. 문서 한 장으로 보여야 한다.
- 목차는 기본적으로 넣지 않는다 (§3).
- `<main>` 은 **흰 종이 한 장**이다. 페이지 배경 위에 얹힌 형태.
  ```html
  <body style="margin:0;padding:0;background:#EDEEF0;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;color:#14161A;-webkit-font-smoothing:antialiased;">
  <main style="max-width:1000px;margin:0 auto;background:#FFFFFF;padding:0 0 80px 0;box-shadow:0 0 0 1px #E1E4E8;">
  ```
- **둥근 모서리 금지.** `border-radius` 를 쓰지 않는다. 각진 편집물 느낌이 이 보고서의 정체성이다.
- **섹션 카드 금지.** 섹션마다 `box-shadow`·배경으로 나누지 않는다. 구분은 여백(`padding-top` 52~60px)으로만 한다.

### 2-1b. 문서 골격 (이 순서 그대로)

```html
<main>
  <header>   배지 + 제목 + 에러 원문 + 메타 표          ← border-bottom: 2px solid #14161A
  <section>  결론 (번호 없음) [+ 핵심 수치 4칸 — 선택]
  <section>  01 / 제목
  <section>  02 / 제목
  ...
  <footer>   문서명 · 날짜                              ← border-top: 1px solid #E1E4E8
</main>
```

좌우 여백은 전 구간 `64px` 로 통일한다. 헤더·섹션·푸터가 같은 세로선에 정렬돼야 한다.

### 2-1c. 스타일 전략 — inline 우선

> **목적**: `<main>` 태그만 추출해도 스타일이 유지되어야 한다.

**inline `style` 속성을 기본으로 쓴다.** 짝수행 줄무늬를 버리면서 `nth-child` 가 필요 없어졌고, hover도 안 쓴다. 그래서 `<style>` 블록 없이 전부 inline으로 끝난다. `<main>` 을 통째로 복사해 메일·위키에 붙여도 그대로 살아난다.

```html
<body style="margin:0;padding:0;background:#EDEEF0;font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;color:#14161A;-webkit-font-smoothing:antialiased;">
<main style="max-width:1000px;margin:0 auto;background:#FFFFFF;padding:0 0 80px 0;box-shadow:0 0 0 1px #E1E4E8;">
  <header style="padding:52px 64px 30px 64px;border-bottom:2px solid #14161A;"> ... </header>
  <section style="padding:44px 64px 0 64px;"> ... </section>
  <footer style="margin:64px 64px 0 64px;padding-top:20px;border-top:1px solid #E1E4E8;"> ... </footer>
</main>
```

- `<style>` 블록이 꼭 필요하면(§8 코드 토큰 색 등) `<main>` 의 **첫 번째 자식**으로 넣고, 셀렉터에 `.ec-report` 접두사를 붙인다. `<main>` 밖의 `<style>` 은 금지.
- 같은 inline 스타일 문자열이 10회 넘게 반복되면 그때만 `<style>` 로 뺀다. 그 전에는 반복이 낫다 — 이식성이 우선이다.

### 2-2. 콘텐츠 구조화 — 읽는 사람이 빠르게 판단할 수 있도록

> 보고서의 독자는 대부분 바쁜 사람이다. **첫 30초 안에 결론을 파악**할 수 있어야 한다.

- **결론 선행**: 각 섹션의 핵심 결론 또는 판단을 해당 섹션 서두에 배치한다. 근거·과정은 그 아래에 둔다.
- **정보 계층**: `h2`(대분류) → `h3`(소분류) → 본문(설명) → 코드/표(근거) 순서를 일관되게 유지한다. 같은 레벨의 정보가 들쭉날쭉 섞이면 읽기 어렵다.
- **숫자와 결론은 표로**: 여러 항목을 비교하거나 수치를 나열할 때는 산문 대신 **표**를 쓴다.
- **한 섹션 = 한 가지 주제**: 섹션 하나에 두 가지 이상의 주제를 섞지 않는다.
- **용어 통일**: 같은 개념을 다른 단어로 부르지 않는다 (예: "웹뷰 재생성"과 "Clean Load"를 혼용하지 말고 하나로 정의 후 일관 사용).

### 2-2b. 본문 문체

- `<main>` 안 한국어 텍스트는 팀 내 개발자 대상 슬랙·PR 말투로 쓴다 (상세: `@.claude/rules/report-style.md`).
- 결론 먼저, 짧은 문장. 숫자·비교는 표로.
- 금지: 논문체, 감사보고서체, 영어 직번역체, 보도자료체.
- 확인 안 된 건 단정하지 않는다.
- 피할 표현: "본 섹션에서는 ~를 기술한다", "상기 분석에 의하면", "경량 플래그"
- 쓸 표현: "로그 보면 ~", "아직 확인 안 됨", "다음에 볼 것"
- 코드·API명·파일 경로만 원문 유지한다.

---

## 3. 목차 (TOC) — 기본 미사용

- **넣지 않는 게 기본이다.** 섹션 7~8개짜리 보고서에 목차를 달면 첫 화면이 링크 목록으로 낭비된다. 결론이 먼저 보여야 한다.
- 예외: 섹션 12개 이상이거나 사용자가 "목차 넣어줘"라고 명시할 때만. 이때도 `<header>` 아래·결론 **뒤**에 둔다.
- 목차를 넣든 안 넣든 `<section>` 에는 `id` 를 부여한다. 외부에서 특정 섹션을 링크할 수 있어야 한다.

---

## 4. 색상 원칙 ★★ (핵심)

### 4-1. 7 : 2 : 1 법칙

보고서 전체 면적 대비 색상 비율을 아래와 같이 유지한다.

| 비율 | 역할 | 라이트 모드 기본값 | 다크 모드 기본값 |
|---|---|---|---|
| **70% — 주조색** | 페이지 배경, 지면, 여백 | `#EDEEF0`(페이지), `#FFFFFF`(지면), `#F2F3F5`·`#F7F8FA`·`#FBFCFD`(블록) | `#0f1115`, `#1a1d26` |
| **20% — 보조색** | 제목, 본문, 테두리, 메타 | `#14161A`(잉크) · `#3A4048`(본문) · `#5A6068`(보조) · `#8A9099`(메타) · `#E1E4E8`(선) | `#e6e9ef`, `#2a2f3a` |
| **10% — 강조색** | 포인트 컬러 1개 + 시맨틱 | 포인트 `#2B3A55`(네이비) + `#B42318`(위험) 최소 사용 | 포인트 컬러 1개 선택 |

**핵심 규칙:**
- 보고서 전체에서 **포인트 컬러는 1개만** 선택한다. 주제에 따라 §6/§7에서 정의된 포인트 컬러 중 택 1.
- **시맨틱 색상**(위험 red, 성공 green)은 의미가 있을 때만, 최소 면적으로 사용한다 (배지, 텍스트, 좌측 보더 등).
- **배경 전체에 색을 입히는 것**은 70% 주조색(흰색/회색 계열)만 허용. 컬러 배경 카드(초록 배경, 파랑 배경 등)는 금지.
  - **예외 2개**: ①§10 AS-IS/TO-BE 비교 카드의 저채도 틴트 ②헤더 에러 원문 박스의 `#FDF3F2`.

### 4-2. 색상 수 상한

- 보고서 본문에서 사용하는 **고유 색상(hue) 수: 최대 4개** (주조 무채색 + 보조 무채색 + 포인트 1 + 시맨틱 1~2)
- **수직으로 연속 배치되는 박스**: 배경은 전부 동일하게 둔다. 차이는 사각 배지 또는 좌측 보더로만 표현.
- 초록 → 파랑 → 노랑처럼 **3가지 이상 색상 계열이 연달아 나오는 배치는 금지** (무지개 효과).
- 해결 방안·로드맵·단계별 카드 등 **순서가 있는 N개 항목**은 특히 이 규칙을 엄격히 적용한다.
- **예외 — 파이차트·플로우차트 등 시각화 내부**: 세그먼트 간 시각적 구분이 필수이므로 4개 hue 상한을 적용하지 않는다. 단, **포인트 컬러를 최대(dominant) 세그먼트에 사용**하고, 나머지는 무채색 계열(`#5A6068`, `#8A9099`, `#C9CED6`, `#E8EBEF`)을 우선한다. 무채색으로 구분이 어려운 6개 이상 세그먼트는 유채색을 허용하되 범례를 반드시 병기한다.

---

## 5. 절제 원칙

> 시각 요소는 **정보를 전달하는 경우에만** 사용한다.
> 분위기를 만들거나 보고서를 "풍성하게" 보이려는 목적으로는 쓰지 않는다.

### 5-1. 시각 요소 사용 기준표

| 요소 | 사용 조건 | 금지 조건 |
|---|---|---|
| **핵심 수치** (결론 끝 4칸) | 셀 수 있는 규모가 결론의 근거일 때만 (건수·기간·존 수 등) | **근거가 수치가 아니면 넣지 않는다.** 코드 구조·설계 이력 분석은 대개 불필요 |
| **파이차트** | 비율 데이터 3개 이상, 합산 100% → **조건 충족 시 사용 검토** | 단순 건수 나열, 2개 항목 비교 |
| **흐름도** | 3단계 이상 프로세스·의사결정 흐름 | 단순 전후 비교, 2단계 이하 |
| **라인차트** | 날짜·시간 축 10개 이상 + 추세·변곡점 전달 | 5개 이하, 순서 없는 데이터 |
| **막대차트** | 카테고리 5개 이상 + 크기 비교가 핵심 | 3개 이하(표로 충분) |
| **강조 박스** | 문서 전체에서 **최대 3개** | 모든 단락을 강조하려는 목적 |
| **섹션 카드** (box-shadow 분리) | 쓰지 않는다 | 항상 금지 (§6-5). 섹션 구분은 여백으로 |
| **AS-IS / TO-BE 2단 카드** | 명시적 변경 전후 비교가 있을 때 | 단순 설명, 원인 분석 |
| **체크리스트** | 작업 절차·확인 항목·가이드라인처럼 독자가 하나씩 점검할 내용이 있을 때 | 단순 나열(글머리 기호로 충분한 경우) |

### 5-2. 핵심 수치 — 넣을지부터 판단한다

**기본은 생략이다.** 넣을 이유가 분명할 때만 넣는다.

넣는다: 장애 규모 보고(발생 건수·영향 존·기간), 개선 전후 비교(처리 시간·오류율), 상급자가 규모를 먼저 물어볼 사안.

넣지 않는다: 코드 구조·설계 이력 분석처럼 **결론의 근거가 수치가 아닌 경우**. 억지로 "커밋 4개 / 파일 2개" 같은 걸 크게 띄우면 정보가 아니라 장식이다. 이럴 땐 결론 문단만 두고 바로 `01` 섹션으로 넘어간다.

칸 수가 2개밖에 안 나오면 그것도 안 넣는 게 낫다. 4칸이 자연스럽게 채워질 때만 쓴다.

허용될 때 지킬 것 (마크업은 §6-4 「핵심 수치」):

- **배경색 없음.** 위아래 `border` 와 칸 사이 `border-right` 로만 묶는다.
- **숫자 색상**: 기본 잉크(`#14161A`). 강조할 **한 칸만** 위험색(`#B42318`).
- 칸마다 다른 배경색을 쓰는 것은 금지 — 보고서를 가장 촌스럽게 만드는 패턴.
- 자리는 **결론 섹션 끝** 한 곳. 문서 중간에 또 깔지 않는다.
- 숫자 아래 설명은 두 줄: 무엇인지 + 부연(`#8A9099`).

### 5-3. 강조 박스 사용 상한

- **문서 전체에서 최대 3개**
- 위험 `#B42318` / 정보 `#2B3A55` / 성공 `#0B6E4F` / 경고 `#E9A23B` 혼용 가능하나 총 3개 초과 금지
- 헤더의 에러 원문 박스와 결론의 형광펜은 이 3개 정원에 포함하지 않는다 (골격 구성 요소)
- 강조 박스가 3개를 초과하는 순간, 독자는 어디도 읽지 않는다

### 5-4. 코드와 표 우선

개발자 대상 보고서에서 가장 신뢰도 높은 시각 요소는 **코드 블록과 표**다.
다른 시각 요소를 추가하기 전에, 코드/표로 충분히 전달되는지 먼저 판단한다.

### 5-5. 시각화 최소 보장

> 절제 원칙이 **시각화를 완전히 제거하라는 뜻은 아니다.**
> 표와 텍스트만으로 이루어진 보고서는 벽돌처럼 읽힌다.

- 보고서 전체에서 **시각화 요소(흐름도, 파이·라인·막대차트, AS-IS/TO-BE 비교 등)가 최소 1개**는 포함되어야 한다.
- **원인 분석·장애 보고서라면 흐름도(§9-2)를 기본으로 넣는다.** 원인이 여러 단계를 거쳐 증상으로 이어지는 구조는 산문으로 못 전달한다.
- 판단 기준: **한 화면(뷰포트)에 1개 정도의 시각 요소**는 가독성을 높여준다.
- 시각화가 들어갈 후보 위치: 비율 데이터가 있는 섹션, 프로세스 흐름 설명, 전후 비교.
- §4(색상 원칙)을 준수하되, 시각화 자체를 두려워하지 말 것.

---

## 6. 디자인 — 라이트 모드 (기본)

> 기준 인상: **편집 디자인이 된 인쇄물.** 각지고, 여백이 넓고, 색을 아낀다.
> 웹 대시보드처럼 보이면 실패다. 둥근 카드·그라디언트·알약 배지를 쓰지 않는다.

### 6-1. 색 토큰

| 이름 | 값 | 쓰는 곳 |
|---|---|---|
| 페이지 | `#EDEEF0` | `<body>` 배경 |
| 지면 | `#FFFFFF` | `<main>` 배경 |
| 잉크 | `#14161A` | 제목, `<body>` 기본 글자 |
| 본문 | `#3A4048` | 문단 |
| 보조 | `#5A6068` | 표 헤더, 캡션 설명 |
| 메타 | `#8A9099` | 라벨, 축 눈금, 각주 |
| 선 | `#E1E4E8` | 모든 테두리·구분선 |
| 옅은 선 | `#E8EBEF` · `#C9CED6` | 차트 눈금선 |
| 블록 배경 | `#F2F3F5` · `#F7F8FA` · `#FBFCFD` | 인라인 코드 / 인용 / 코드블록 |
| **포인트(네이비)** | `#2B3A55` | 강조, 차트 주계열, 인용 보더, 링크 |
| **위험** | `#B42318` (배경 `#FDF3F2`) | 에러, 실패, 감소 |
| 성공 | `#0B6E4F` | 정상, 통과 |
| 경고 | `#E9A23B` | 주의 단계 |
| 형광펜 | `#FFF1B8` | 결론 문장의 핵심 어구 |

### 6-2. 타이포

- 본문 폰트: `'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif`
- 고정폭: `ui-monospace, SFMono-Regular, Menlo, monospace` — 라벨·수치·경로·코드에 전부 이걸 쓴다
- `h1` (문서 제목): `34px / 800 / letter-spacing:-.02em / line-height:1.25`
- **섹션 번호** `h2`: `13px / mono / color:#8A9099 / letter-spacing:.14em / 600`, 값은 `01` `02` 두 자리
- **섹션 제목** `h3`: `24px / 700 / letter-spacing:-.02em`, 번호 바로 아래 `margin:0 0 8px`
- 소제목 `h4`: `17px / 700 / letter-spacing:-.01em`, 본문에서는 `2-1.` 처럼 번호를 붙여도 된다
- 본문 `p`: `14.5px / line-height:1.8 / color:#3A4048`
- 섹션 도입문(제목 바로 아래 한 문단): `14.5px / line-height:1.75 / color:#5A6068`
- 각주·출처: `13.5px / line-height:1.7 / color:#8A9099`

### 6-3. 여백

| 요소 | 값 |
|---|---|
| 좌우 여백 (헤더·섹션·푸터 전부) | `64px` |
| 헤더 | `padding:52px 64px 30px` + `border-bottom:2px solid #14161A` |
| 결론 섹션 | `padding:44px 64px 0` |
| 이후 섹션 | `padding:52~60px 64px 0` |
| `<main>` 하단 | `padding-bottom:80px` |
| 푸터 | `margin:64px 64px 0` + `padding-top:20px` + `border-top:1px solid #E1E4E8` |

### 6-4. 컴포넌트

**배지 (헤더 상단)** — 각진 사각형. `border-radius` 없음.
```html
<span style="display:inline-block;background:#B42318;color:#fff;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:.06em;padding:4px 9px;">SEV-2 / 진행 중</span>
<span style="font-family:ui-monospace,monospace;font-size:11px;color:#8A9099;letter-spacing:.06em;">INCIDENT REPORT · 2026-08-21</span>
```

**에러 원문 (헤더)** — 제목 아래. 위험색 좌측 보더 + 옅은 배경.
```html
<p style="margin:0 0 26px 0;font-family:ui-monospace,monospace;font-size:12.5px;line-height:1.6;color:#B42318;background:#FDF3F2;border-left:3px solid #B42318;padding:11px 14px;">...</p>
```

**메타 표 (헤더)** — 테두리 없는 2열 × N행. 라벨은 mono `11.5px #8A9099`, 값은 `13px #14161A`.

**결론 섹션** — 섹션 번호를 쓰지 않는다. 번호 자리에 위험색 라벨을 넣는다.
```html
<div style="font-family:ui-monospace,monospace;font-size:11px;color:#B42318;letter-spacing:.14em;font-weight:700;margin-bottom:14px;">결론</div>
<p style="margin:0 0 18px 0;font-size:19px;line-height:1.65;font-weight:600;letter-spacing:-.01em;">
  ... <span style="background:#FFF1B8;padding:1px 4px;">핵심 어구</span> ...
</p>
```
형광펜은 **결론 문단에서만**, 한 문단에 2군데까지.

**핵심 수치 (결론 끝, 선택)** — 넣을지는 §5-2에서 먼저 판단한다. 넣기로 했으면 배경색 없이 위아래 선으로만 묶고 4칸을 채운다.
```html
<div style="display:flex;flex-wrap:wrap;gap:0;margin-top:34px;border-top:1px solid #E1E4E8;border-bottom:1px solid #E1E4E8;">
  <div style="flex:1 1 150px;padding:22px 20px 20px 0;border-right:1px solid #E1E4E8;">
    <div style="font-size:32px;font-weight:800;letter-spacing:-.03em;line-height:1;">182<span style="font-size:15px;font-weight:600;color:#8A9099;margin-left:3px;">건</span></div>
    <div style="font-size:12.5px;color:#5A6068;margin-top:8px;line-height:1.5;">로그인 화면 발생<br><span style="color:#8A9099;">9개 존 전부</span></div>
  </div>
  <!-- 첫 칸만 padding-left:0, 마지막 칸만 padding-right:0 + border-right 제거 -->
</div>
```
숫자는 기본 잉크색. **강조할 한 칸만** `#B42318`.

**인용 (외부 문서·릴리스 노트)**
```html
<blockquote style="margin:0 0 16px 0;padding:14px 20px;border-left:3px solid #2B3A55;background:#F7F8FA;font-family:ui-monospace,monospace;font-size:13.5px;color:#2B3A55;">Added support for class static initialization blocks.</blockquote>
```

**인라인 코드**: `font-family:ui-monospace,monospace; font-size:13px; background:#F2F3F5; padding:1px 5px` — 테두리·라운드 없음.

**코드 블록**: 파일 경로 라벨을 `<pre>` 위에 **붙여서** 한 덩어리로 만든다.
```html
<div style="margin-bottom:18px;">
  <div style="font-family:ui-monospace,monospace;font-size:11.5px;color:#8A9099;background:#F2F3F5;padding:7px 14px;border:1px solid #E1E4E8;border-bottom:none;">@lib/lazy_loader/src/EcLazyLoader.ts : 235-252</div>
  <pre style="margin:0;padding:16px 18px;background:#FBFCFD;border:1px solid #E1E4E8;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.75;color:#14161A;">...</pre>
</div>
```
라벨과 `<pre>` 사이에 `margin` 을 두지 않는다. `border-bottom:none` 으로 이어 붙인다.

**표** — 세로 테두리 없음. 헤더 배경 없음. 행 구분선만.
```html
<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:26px;">
  <thead><tr style="border-bottom:1px solid #14161A;">
    <th style="text-align:left;padding:9px 0 9px 8px;font-weight:600;font-size:12px;color:#5A6068;">항목</th>
  </tr></thead>
  <tbody><tr style="border-bottom:1px solid #E1E4E8;">
    <td style="padding:10px 0 10px 8px;">값</td>
  </tr></tbody>
</table>
```
- `thead` 아래는 **잉크색 1px**, 본문 행 사이는 **선색 1px**
- 짝수행 배경 줄무늬를 쓰지 않는다 (구 규칙 폐기)
- 수치·경로·코드 셀은 mono `12px #8A9099`, 강조 셀만 `#B42318 / font-weight:700`

**푸터**
```html
<footer style="margin:64px 64px 0 64px;padding-top:20px;border-top:1px solid #E1E4E8;display:flex;justify-content:space-between;font-family:ui-monospace,monospace;font-size:11px;color:#8A9099;">
  <span>문서 제목</span><span>2026-08-21</span>
</footer>
```

### 6-5. 하지 않는 것

| 금지 | 이유 |
|---|---|
| `border-radius` 전부 | 각진 편집물 인상이 깨진다 |
| 섹션마다 `box-shadow` 카드 | 여백으로 나누면 충분하다. 카드가 겹치면 대시보드처럼 보인다 |
| 헤더 그라디언트 | 지면과 이질적이다. 헤더도 흰 바탕 + 아래 굵은 선으로 구분한다 |
| 알약(pill) 배지 | 각진 사각 배지를 쓴다 |
| 표 짝수행 줄무늬 | 행 구분선만으로 읽힌다 |
| 수치 카드 배경색 | 위아래 선 + 세로 구분선만 |
| 색 배경 강조 박스 남발 | 형광펜(결론)·위험 좌측 보더(에러 원문) 두 가지로 충분하다 |

**포인트 컬러 — 주제에 맞게 1개 선택 (강조색 10%)**

| 선택 | 값 | 적합한 주제 |
|---|---|---|
| 네이비 | `#2B3A55` | **기본값.** 장애 분석, 기술 보고 전반 |
| 딥그린 | `#1F4D3A` | 개선 완료 보고, 성과 정리 |
| 인디고 | `#3B3A6B` | 아키텍처 설계, 제안서 |

채도 낮은 어두운 색만 쓴다. 밝고 쨍한 파랑(`#2563eb` 류)은 웹 UI 느낌이라 쓰지 않는다.

**시맨틱 색상 — 의미가 있을 때만, 최소 면적으로**

| 용도 | 색상 | 사용 허용 범위 |
|---|---|---|
| 위험/에러 | `#B42318` | 텍스트, 좌측 보더, 배지, 차트 대비 계열. 배경은 `#FDF3F2` 만 예외 허용 |
| 성공/정상 | `#0B6E4F` | 텍스트, 표 셀. **배경색으로 사용 금지.** |
| 경고/주의 | `#E9A23B` | 차트 중간 단계, 흐름도 노드. **본문 글자색으로는 쓰지 않는다**(대비 부족) |
| 형광펜 | `#FFF1B8` | 결론 문단의 핵심 어구 배경. 한 문단에 2군데까지 |

**코드 내 색상 강조 (라이트 모드)**

> 아래 팔레트는 **§8 하이라이트 스크립트가 자동 적용**한다. CSS만 넣고 스크립트를 빼면 색이 안 나온다.

| 종류 | 색상 | CSS 클래스 |
|---|---|---|
| 키워드 | `#0B6E4F` | `.tk-kw` |
| 함수명 | `#2B3A55` | `.tk-fn` |
| 문자열 | `#1F4D3A` | `.tk-str` |
| 주석 | `#8A9099` | `.tk-cm` |
| 숫자 | `#8A5A00` | `.tk-num` |
| 속성명 | `#8A5A00` | `.tk-prop` |
| 값 | `#2B3A55` | `.tk-val` |
| (수동) 문제 지점·연산자 | `#B42318` | inline `<span>` |

---

## 7. 디자인 — 다크 모드 (`[다크 모드로]` 지시 시에만)

- 페이지 배경: `#0f1115`
- 섹션 구분: 카드(box-shadow) 대신 `border-top: 1px solid #2a2f3a` + `padding-top: 32px` 권장
  (섹션 5개 이상이면 카드 허용: `background: #1a1d26; border: 1px solid #2a2f3a; border-radius: 12px; padding: 20px 22px; margin-bottom: 20px`)
- 헤더: `background: linear-gradient(135deg, #1a1f2b, #13161d); border: 1px solid #2a2f3a; border-radius: 16px`
- 섹션 제목 `h2`: `font-size: 20px; color: #e6e9ef; border-bottom: 1px solid #2a2f3a; padding-bottom: 8px`
  - 번호 `<span>`: `color: [포인트 컬러]; font-weight: 700; margin-right: 8px`
- 소제목 `h3`: `font-size: 16px; color: #cdd5e3`
- 본문: `font-size: 15px; color: #9aa3b2; line-height: 1.7`
- 폰트: `-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`
- 코드 폰트: `'SF Mono', Consolas, D2Coding, monospace`
- 인라인 코드: `background: #0b0d11; border: 1px solid #2a2f3a; border-radius: 5px; padding: 1px 6px; color: #d7e3ff; font-size: 13px`
- 코드 블록: `background: #0b0d11; border: 1px solid #2a2f3a; border-radius: 12px; padding: 16px 18px`
- 메타 텍스트: `color: #546e7a; font-size: 11px`
- 배지: `font-size: 11px; letter-spacing: 0.06em; border: 1px solid [포인트 컬러]; border-radius: 999px; padding: 3px 12px`

**표(table) 스타일:**

- `width: 100%; border-collapse: collapse; font-size: 13px`
- `thead tr`: `background: #1e2230` — 헤더 행에 반드시 배경색
- `th`: `padding: 8px 12px; border: 1px solid #2a2f3a; text-align: left; font-weight: 600; color: #e6e9ef`
- `tbody tr`: `background: #1a1d26` — 본문 행에도 반드시 배경색
- `tbody tr:nth-child(even)` (짝수행): `background: #151820` — 줄무늬로 가독성 확보
- `td`: `padding: 8px 12px; border: 1px solid #2a2f3a; color: #9aa3b2`
- **배경이 없는 표는 금지** — 다크 모드에서 배경 없으면 행이 완전히 구분 불가

**포인트 컬러 — 주제에 맞게 1개 선택**

| 선택 | 값 | 적합한 주제 |
|---|---|---|
| 파랑 | `#5b9dff` | 아키텍처, 기술 분석 |
| 주황 | `#ff6b35` | 경고, 성능, 마이그레이션 |
| 민트 | `#4fc3f7` | AI, 자동화, 워크플로우 |

**시맨틱 색상 — 의미가 있을 때만, 최소 면적으로**

| 용도 | 색상 | 사용 허용 범위 |
|---|---|---|
| 위험/에러 | `#f87171` | 텍스트, 좌측 보더, 배지. **배경색으로 사용 금지.** |
| 성공/정상 | `#4ade80` | 텍스트, 좌측 보더, 배지. **배경색으로 사용 금지.** |
| 경고/주의 | `#fbbf24` | 텍스트, 좌측 보더, 배지. **배경색으로 사용 금지.** |

**코드 내 색상 강조 (다크 모드)**

> §8 하이라이트 스크립트 + 아래 `.tk-*` CSS를 함께 넣는다.

| 종류 | 색상 | CSS 클래스 |
|---|---|---|
| 키워드 | `#c792ea` | `.tk-kw` |
| 함수명 | `#82aaff` | `.tk-fn` |
| 문자열 | `#c3e88d` | `.tk-str` |
| 주석 | `#546e7a` | `.tk-cm` |
| 숫자 | `#f78c6c` | `.tk-num` |
| 속성명 | `#ffcb6b` | `.tk-prop` |
| 값 | `#a8ff78` | `.tk-val` |

---

## 8. 코드 블록 ★★ (syntax highlighting 필수)

> **`pre` 블록에 색이 없으면 미완성 산출물이다.** 사용자가 따로 말하지 않아도 반드시 적용한다.

### 8-0. 적용 대상

| 대상 | 처리 |
|---|---|
| `<pre>` (일반 코드·JSON·TypeScript) | **필수** — 하이라이트 스크립트 적용 |
| `<pre>` + §8-3a 라인 강조 | **필수** — 강조 라인은 단색 유지, 나머지 줄은 토큰 색상. `layer-pre` 붙이지 않는다 |
| `<pre class="layer-pre">` | **예외** — ASCII·층 구조 다이어그램만. 토큰 색상 생략 |
| 인라인 `<code>` | 모드별 스타일만 (§6). 토큰 분리 불필요 |

> `layer-pre` 를 남발하면 정작 제일 많이 읽히는 "문제 지점" 코드가 통째로 검정으로 나온다.
> ASCII 다이어그램이 아니면 붙이지 않는다.

### 8-1. 토큰 CSS — `<main>` 내부 `<style>`에 반드시 포함

라이트 모드(§6) / 다크 모드(§7) 각각 아래 블록을 **그대로** 넣는다. 색상 값은 §6·§7 팔레트와 일치해야 한다.

**라이트 모드 (기본):**

```css
.ec-report pre .tk-kw { color: #0B6E4F; }
.ec-report pre .tk-fn { color: #2B3A55; }
.ec-report pre .tk-str { color: #1F4D3A; }
.ec-report pre .tk-cm { color: #8A9099; }
.ec-report pre .tk-num { color: #8A5A00; }
.ec-report pre .tk-prop { color: #8A5A00; }
.ec-report pre .tk-val { color: #2B3A55; }
```

연산자·화살표(`=>`)나 "여기가 문제" 주석처럼 **눈에 걸려야 하는 조각**은 `#B42318` 을 inline `<span>` 으로 직접 준다. 자동 하이라이트가 잡는 범주가 아니다.

**다크 모드:**

```css
.ec-report pre .tk-kw { color: #c792ea; }
.ec-report pre .tk-fn { color: #82aaff; }
.ec-report pre .tk-str { color: #c3e88d; }
.ec-report pre .tk-cm { color: #546e7a; }
.ec-report pre .tk-num { color: #f78c6c; }
.ec-report pre .tk-prop { color: #ffcb6b; }
.ec-report pre .tk-val { color: #a8ff78; }
```

### 8-2. 하이라이트 스크립트 — `</body>` 직전에 반드시 포함

- CDN·외부 라이브러리 금지. 아래 인라인 `<script>`를 **복사해 그대로** 넣는다.
- `pre` 원문은 plain text로 작성한다. `<span class="tk-*">`를 수동으로 감쌀 필요 없음.
- 스크립트는 **`//` 한 줄 주석 + `/** */` 블록 주석(JSDoc)** 모두 `.tk-cm`(회색) 처리한다.
- **텍스트 노드만 골라 치환한다.** `pre.innerHTML = highlight(pre.textContent)` 방식은 §8-3a 라인 강조 `<span>` 을 통째로 날려버린다. 아래 스크립트는 `TreeWalker` 로 텍스트 노드만 바꾸므로 강조 span이 살아남고, 강조 라인 안쪽은 단색을 유지한다.
- 치환 대상 변수명·정규식·순서를 임의로 바꾸지 않는다. 순서를 바꾸면 이미 삽입한 `<span>` 태그 자체가 다시 매칭된다.

```html
<script>
(function () {
  var KW =
    'import|from|const|let|async|function|for|of|if|continue|return|' +
    'interface|export|new|await|Partial|Record|string|type|' +
    'public|private|protected|override|var|else|case|switch|any|true|false|as|null';
  var kwRe = new RegExp('\\b(' + KW + ')\\b', 'g');

  function esc(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlight(src) {
    var slots = [];
    var text = src;

    function slot(html) {
      slots.push(html);
      return '\x00' + (slots.length - 1) + '\x00';
    }

    // 1. 블록 주석 (/** */ · /* */) — JSDoc 포함
    text = text.replace(/\/\*[\s\S]*?\*\//g, function (m) {
      return slot('<span class="tk-cm">' + esc(m) + '</span>');
    });
    // 2. 문자열
    text = text.replace(/('(?:\\'|[^'])*'|"(?:\\"|[^"])*")/g, function (m) {
      return slot('<span class="tk-str">' + esc(m) + '</span>');
    });
    // 3. 한 줄 주석
    text = text.replace(/(\/\/[^\n]*)/g, function (m) {
      return slot('<span class="tk-cm">' + esc(m) + '</span>');
    });

    text = esc(text);
    text = text.replace(kwRe, '<span class="tk-kw">$1</span>');
    text = text.replace(
      /\b([a-zA-Z_][\w]*)\s*(?=\()/g,
      '<span class="tk-fn">$1</span>'
    );
    // 타입·클래스·상수 (PascalCase, UPPER_CASE). 뒤에 '(' 가 오면 함수이므로 제외
    text = text.replace(
      /\b([A-Z][A-Za-z0-9_]*)\b(?!\s*\()/g,
      '<span class="tk-val">$1</span>'
    );
    text = text.replace(
      /(\b[a-zA-Z_][\w]*)\s*\??:/g,
      '<span class="tk-prop">$1</span>:'
    );
    text = text.replace(/\x00(\d+)\x00/g, function (_, i) {
      return slots[Number(i)];
    });
    return text;
  }

  document
    .querySelectorAll('.ec-report pre:not(.layer-pre)')
    .forEach(function (pre) {
      if (pre.dataset.highlighted) return;
      // 텍스트 노드만 교체한다. innerHTML 통째 교체는 라인 강조 span을 날린다
      var walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, null);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        // 강조 라인 내부는 단색 유지
        if (node.parentElement.closest('.hl-bad, .hl-good')) return;
        var holder = document.createElement('span');
        holder.innerHTML = highlight(node.nodeValue);
        node.parentNode.replaceChild(holder, node);
      });
      pre.dataset.highlighted = '1';
    });
})();
</script>
```

### 8-3. 기타 코드 블록 규칙

- 인라인 코드: 모드별 스타일, `font-size: 13px`, monospace
- 블록 코드: 언어명 레이블 우상단 `position: absolute` (선택)
- **파일 경로 레이블**: `<pre>` 바로 위에 `파일명:라인 · 전체경로` 를 mono 11.5px `#8A9099` + 배경 `#F2F3F5` + `border-bottom:none` 으로 `<pre>` 에 붙여 쓴다 (§6-4). 코드 안 첫 줄 주석으로 넣는 것보다 읽기 쉽다.
- **30줄 초과 코드 (소스 기준)**: `<details>` 로 접고 `<summary>` 에 파일명/용도 표시. 내부 `<pre>`도 하이라이트 대상

### 8-3a. 문제 라인 강조 ★

문제 지점·변경 라인은 **그 줄만 배경색**을 깔아 눈에 띄게 한다. 산문으로 "★ 여기가 문제" 라고 쓰는 것보다 훨씬 빠르게 읽힌다.

`<pre>` 의 padding 때문에 `display:block` 만으로는 좌우 여백이 비어 배경이 잘려 보인다. `box-shadow` 로 좌우를 채운다.

**강조 클래스는 `<style>` 에 정의한다.** 인라인 style로 매번 쓰면 §8-2 스크립트의 제외 판정(`closest('.hl-bad, .hl-good')`)이 걸리지 않아 강조 라인 안까지 토큰 색이 섞인다.

```css
/* 라이트 모드 */
.ec-report .hl-bad  { display:block; background:#fef2f2; box-shadow:-14px 0 0 #fef2f2,14px 0 0 #fef2f2; color:#7f1d1d; }
.ec-report .hl-good { display:block; background:#ecfdf5; box-shadow:-14px 0 0 #ecfdf5,14px 0 0 #ecfdf5; color:#065f46; }

/* 다크 모드 */
.ec-report .hl-bad  { display:block; background:#2a1416; box-shadow:-14px 0 0 #2a1416,14px 0 0 #2a1416; color:#fecaca; }
.ec-report .hl-good { display:block; background:#12251b; box-shadow:-14px 0 0 #12251b,14px 0 0 #12251b; color:#bbf7d0; }
```

```html
<pre>private async makeResultData(response: Response) {
    if (response.status === HttpStatusCodes.OK) {
        body = isJson ? JSON.parse(data) : data;
    } else if (isJson) {
<span class="hl-bad">        result = await response.json();   // ★ 해제 없이 직행</span>    }
}</pre>
```

- `box-shadow` 의 `14px` 는 `<pre>` 의 좌우 padding 값과 맞춘다.
- 강조 `<span>` 은 줄 전체를 감싸고, **닫는 `</span>` 뒤에 개행 없이 다음 줄 내용이 이어지게** 쓴다. 개행을 넣으면 빈 줄이 하나 더 생긴다.
- **한 코드 블록에 강조 라인은 최대 3줄.** 전부 강조하면 아무것도 강조가 안 된다.
- **`class="layer-pre"` 를 붙이지 않는다.** §8-2 스크립트는 텍스트 노드만 교체하므로 강조 span이 그대로 살아남는다. 토큰 색과 라인 강조가 같이 나온다.
- 강조 라인 안쪽은 스크립트가 건드리지 않아 단색으로 남는다. 그게 의도다 — 강조 줄은 색이 하나여야 눈에 띈다.

### 8-4. 출력 전 코드 블록 체크 (자가검증 — 생략 금지)

HTML 저장 전 아래를 반드시 확인한다.

- [ ] `<style>` 안에 `.tk-kw` ~ `.tk-val` 7개 클래스가 있는가
- [ ] `</body>` 직전에 §8-2 하이라이트 `<script>`가 있는가 (텍스트 노드 교체 버전인가 — `pre.innerHTML =` 통째 교체면 옛 버전이다)
- [ ] 일반 `<pre>`가 plain text로 작성돼 있는가 (수동 span 없어도 됨)
- [ ] **`class="layer-pre"` 가 붙은 `<pre>` 가 ASCII 다이어그램뿐인가** — 라인 강조를 썼다는 이유로 붙였으면 떼라. 색이 통째로 날아간다
- [ ] 라인 강조에 `.hl-bad` / `.hl-good` 클래스를 썼는가 (인라인 style 아님)
- [ ] 브라우저로 열어 **코드 블록 전부에 색이 실제로 보이는지** 눈으로 확인했는가

---

## 9. 시각화 — 조건 충족 + 절제 원칙 통과 시에만

### 9-0. 구현 수단 — 인라인 SVG가 기본

- 차트·흐름도는 **`<svg>` 를 HTML 안에 직접 작성**한다. 외부 라이브러리·CDN·canvas·`<img>` 는 금지지만 **인라인 SVG는 권장**이다.
- `viewBox` 를 반드시 넣고 `width="100%"` 로 둔다. 그래야 화면 폭에 맞춰 줄어든다. `height` 는 지정하지 않는다. `style="display:block;overflow:visible"`.
- `role="img"` + `aria-label` 을 붙인다.
- 컨테이너: `border:1px solid #E1E4E8; padding:20px 18px 12px` — **라운드·그림자 없음**.
- 컨테이너 안 맨 위에 제목 줄 + 범례를 한 행으로 놓는다.
  ```html
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;padding:0 6px;">
    <div style="font-size:13px;font-weight:700;">일별 발생 건수</div>
    <div style="font-family:ui-monospace,monospace;font-size:11px;color:#8A9099;">
      <span style="display:inline-block;width:9px;height:9px;background:#2B3A55;margin-right:5px;"></span>로그인 화면
      <span style="display:inline-block;width:9px;height:9px;background:#B42318;margin:0 5px 0 14px;"></span>ERP 내부
    </div>
  </div>
  ```
  범례 색 견본은 **사각형**(9×9px). 원형 금지.
- SVG 안 모든 텍스트는 mono. 축 눈금 `11px #8A9099`, x축 라벨 `10px #8A9099`, 값 라벨 `11px / 600 / 계열색`.
- 눈금선: 0선만 `#C9CED6`, 나머지는 `#E8EBEF`.
- 캡션이 필요하면 컨테이너 **아래**에 `font-size:12px; color:#8A9099` 한 줄. 차트 제목이 컨테이너 안에 있으면 캡션은 생략해도 된다.
- 계열 색: 주계열 `#2B3A55`, 대비 계열 `#B42318`, 그 외 `#8A9099` → `#C9CED6` 순.

### 9-1. 파이차트
**조건**: 비율/분포 항목 3개 이상 + 합산이 100% 구성 + 독자가 분포를 한눈에 봐야 할 때
- **조건을 충족하면 표 대신 파이차트를 우선 사용한다.** 비율의 시각적 대비는 표만으로 전달되지 않는다.
- 구현은 `conic-gradient` 또는 인라인 SVG 둘 다 가능. 세그먼트가 4개 이하면 `conic-gradient` 가 짧다.
- 범례: 색상 박스(14×14px) + 항목명 + 수치. **분모를 캡션이나 범례 제목에 반드시 적는다.**
- **색상 규칙**: 최대 세그먼트에 포인트 컬러, 나머지는 무채색 계열 우선. 6개 이상 세그먼트는 §4-2 예외 조항에 따라 유채색 허용.

### 9-2. 흐름도 (플로우차트) ★
**조건**: 3단계 이상 프로세스·의사결정 흐름 + 텍스트만으로 순서 파악이 어려울 때

**인라인 SVG로 그린다.** div + `▼` 조합은 단계가 4개를 넘거나 분기가 생기면 금방 지저분해진다. SVG는 분기·합류·곡선을 정확히 그릴 수 있다.

구성 요소는 네 가지뿐이다.

| 요소 | 마크업 |
|---|---|
| 화살촉 정의 | `<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#8D96A6"/></marker></defs>` |
| 노드 | `<rect x y width height rx="6" fill="..." stroke="..."/>` + `<text text-anchor="middle">` |
| 직선 연결 | `<line x1 y1 x2 y2 stroke="#8D96A6" stroke-width="1.5" marker-end="url(#ah)"/>` |
| 분기 곡선 | `<path d="M400,328 C400,370 170,352 170,388" fill="none" stroke="#8D96A6" stroke-width="1.5" marker-end="url(#ah)"/>` |

```html
<div style="border:1px solid #E1E4E8;padding:20px 18px 12px;">
<svg viewBox="0 0 900 500" width="100%" role="img" aria-label="에러 발생 흐름도"
     xmlns="http://www.w3.org/2000/svg" style="display:block">
  <defs>
    <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 z" fill="#8D96A6"/>
    </marker>
  </defs>

  <!-- 노드: 배경 rect + 텍스트. 두 줄이면 text 두 개를 20px 간격으로 -->
  <rect x="320" y="8" width="300" height="84" rx="6" fill="#2B3A55" stroke="#2B3A55"/>
  <text x="470" y="44" text-anchor="middle" font-size="13" fill="#fff">클라이언트: 요청 URL에</text>
  <text x="470" y="64" text-anchor="middle" font-size="13" fill="#fff">xce=none 부착</text>

  <!-- 직선 연결 -->
  <line x1="470" y1="92" x2="470" y2="124" stroke="#8D96A6" stroke-width="1.5" marker-end="url(#ah)"/>

  <!-- 분기: 한 노드에서 좌·우로 갈릴 때 -->
  <path d="M400,328 C400,370 170,352 170,388" fill="none" stroke="#8D96A6" stroke-width="1.5" marker-end="url(#ah)"/>
  <path d="M540,328 C540,370 720,352 720,388" fill="none" stroke="#8D96A6" stroke-width="1.5" marker-end="url(#ah)"/>
</svg>
</div>
<div style="font-size:12px;color:#8A9099;margin-top:8px;text-align:center;">[그림 1] 요청부터 로그 기록까지의 에러 전파 경로</div>
```

**작도 규칙**

- 노드 색: 정상 흐름 `#2B3A55`(포인트) / 성공 분기 `#0B6E4F` / 실패 분기 `#B42318` / 결과·부가 `#F2F3F5` + `stroke:#C9CED6`. 유채색 노드의 글자는 `#fff`, 회색 노드는 `#14161A`.
- 폰트 13px 고정. 한 줄에 22자를 넘기지 말고 `<text>` 를 나눈다. **SVG는 자동 줄바꿈이 없다.**
- 노드 높이는 한 줄 62px, 두 줄 84px, 세 줄 100px 정도.
- 세로 간격은 노드 사이 32~44px. 그 안에 화살표를 넣는다.
- 분기가 없으면 노드를 한 열로, 분기가 있으면 좌우로 벌린다. 좌우 열 중심은 `170` / `720` 처럼 멀리 둔다.
- 좌표는 직접 계산해서 쓴다. 마지막 노드의 `y + height` 가 `viewBox` 높이보다 작아야 잘리지 않는다.

### 9-3. 라인차트 (시계열 추세)
**조건**: 날짜·시간 축으로 10개 이상 데이터 포인트 + 추세나 변곡점을 보여줘야 할 때

표로는 "7/28부터 올라갔다" 같은 변화가 안 보인다. 이럴 때만 쓴다.

```html
<svg viewBox="0 0 960 300" width="100%" role="img" aria-label="일자별 발생 건수"
     xmlns="http://www.w3.org/2000/svg" style="display:block">
  <!-- 가로 눈금선 + 축 라벨 -->
  <line x1="44" y1="254" x2="944" y2="254" stroke="#E8EBEF" stroke-width="1"/>
  <text x="36" y="257" text-anchor="end" font-size="10" fill="#8D96A6">0</text>
  <!-- ... 10 / 20 / 30 반복 ... -->

  <!-- 구간 강조가 필요하면 반투명 rect + 점선 + 라벨 -->
  <rect x="381" y="18" width="563" height="236" fill="#2B3A55" opacity="0.05"/>
  <line x1="381" y1="18" x2="381" y2="254" stroke="#8A9099" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="386" y="30" font-size="10" fill="#5A6068">7/28 로깅 개편 배포</text>

  <!-- 꺾은선 -->
  <polyline points="44,222 72,238 100,206 ..." fill="none" stroke="#2B3A55" stroke-width="2" stroke-linejoin="round"/>

  <!-- 각 점 + 회전 라벨 -->
  <circle cx="44" cy="222" r="2.4" fill="#2B3A55"/>
  <text x="44" y="268" font-size="9" fill="#8D96A6" text-anchor="end"
        transform="rotate(-55 44 268)">07-14</text>
</svg>
```

- 눈금선은 4개면 충분하다(0 / 1/3 / 2/3 / 최대).
- x 라벨이 겹치면 `transform="rotate(-55 x y)"` + `text-anchor="end"`.
- 배포일·릴리즈처럼 **설명이 필요한 시점은 점선 + 라벨로 표시**한다. 이게 라인차트를 쓰는 가장 큰 이유다.
- 데이터가 빠진 날짜는 캡션에 "미표기 일자는 0건"처럼 밝힌다. 임의로 0을 찍어 선을 잇지 않는다.

### 9-4. 막대차트 (항목별 건수)
**조건**: 카테고리 5개 이상 + 크기 비교가 핵심일 때 (시간대별, 존별, 상태코드별 등)

```html
<rect x="203" y="32" width="31" height="207" fill="#B42318" rx="2"/>
<text x="219" y="27" font-size="10" fill="#3A4048" text-anchor="middle">84</text>
<text x="219" y="256" font-size="10" fill="#8D96A6" text-anchor="middle">08</text>
```

- **강조할 구간만 시맨틱 색**, 나머지는 `#8A9099`. 전부 색칠하면 어디가 중요한지 사라진다.
- 값 라벨은 막대 위에 직접 적는다. 그러면 표를 따로 안 붙여도 된다.
- 막대 폭 30px 내외, 간격 19px 내외.

### 강조 박스 (전체 문서 최대 3개)
- 공통: `background: #F7F8FA; padding: 14px 20px` (라운드 없음)
- 위험: `border-left: 3px solid #B42318`
- 정보: `border-left: 3px solid #2B3A55`
- 성공: `border-left: 3px solid #0B6E4F`
- 경고: `border-left: 3px solid #E9A23B`
- **배경에 색상 틴트(rgba 컬러) 금지** — 중립 배경 + 좌측 보더 색상으로만 구분

### 체크리스트
**조건**: 작업 절차·확인 항목·마이그레이션 가이드 등 독자가 하나씩 점검할 내용이 있을 때

- `<input type="checkbox" disabled>` + `<label>` 조합
- 컨테이너: `border: 1px solid #E1E4E8; padding: 20px 24px`
- 각 항목: `display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #E1E4E8`  (마지막 항목은 border-bottom 없음)
- 체크박스: `width: 16px; height: 16px; margin-top: 2px; accent-color: #2B3A55; flex-shrink: 0`
- 라벨 텍스트: `font-size: 14px; color: #3A4048; line-height: 1.5`
- 라벨 내 인라인 코드: 본문 인라인 코드 스타일과 동일
- 소제목이 필요하면 `<strong>` + `color: #2B3A55; font-size: 15px; margin: 12px 0 6px` 으로 그룹 구분
- 상단에 강조 박스(§9)를 함께 사용 가능 (예: "마이그레이션 전 반드시 확인하세요")

### 접기/펼치기
**조건**: 부가 설명, 30줄 초과 코드, 10행 초과 표

**스타일 — 카드형 (둥근 박스):**
- `<details>`: `border: 1px solid #E1E4E8; margin-top: 8px`
- `<summary>`: `padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600; color: #2B3A55; background: #F7F8FA`
- summary 텍스트 앞에 `<span>` 배지(선택): `font-size: 11px; color: #8A9099; border: 1px solid #C9CED6; padding: 1px 6px; margin-right: 6px` (예: "상세", "코드")
- 내부 콘텐츠: `padding: 16px 18px`
- **링크처럼 보이는 밑줄 텍스트 스타일 금지** — 반드시 카드형 박스로 감싸서 클릭 영역을 명확히 한다

---

## 10. 변경사항 비교 레이아웃 (명시적 전후 비교가 있을 때만)

- AS-IS / TO-BE 2단 flex 카드
- §4 "컬러 배경 금지"의 **유일한 예외** — 전후 차이를 즉시 인지시키기 위해 **저채도 틴트 배경**을 허용한다.
- 단, 틴트 위의 **텍스트 색상을 반드시 명시**하여 대비(contrast)를 확보할 것.

**라이트 모드:**
- AS-IS: `background: #FDF3F2; border: 1px solid #F4CFCB; border-left: 3px solid #B42318; padding: 16px 20px`
- AS-IS 텍스트: `color: #5C120C` (진한 어두운 빨강 — 연한 빨강 배경 위에서 대비 확보)
- TO-BE: `background: #F1F7F4; border: 1px solid #C4DED3; border-left: 3px solid #0B6E4F; padding: 16px 20px`
- TO-BE 텍스트: `color: #0A3D2A` (진한 어두운 초록)
- 제목: AS-IS `color: #B42318; font-weight: 700`, TO-BE `color: #0B6E4F; font-weight: 700`

**다크 모드:**
- AS-IS: `background: rgba(127,29,29,0.15); border: 1px solid #7f1d1d; border-left: 4px solid #f87171; border-radius: 6px; padding: 16px 20px`
- AS-IS 텍스트: `color: #fecaca`
- TO-BE: `background: rgba(20,83,45,0.15); border: 1px solid #14532d; border-left: 4px solid #4ade80; border-radius: 6px; padding: 16px 20px`
- TO-BE 텍스트: `color: #bbf7d0`
- 제목: AS-IS `color: #f87171; font-weight: 600`, TO-BE `color: #4ade80; font-weight: 600`

**상태 배지 — 라이트 모드:**

| 배지 | background | color | border |
|---|---|---|---|
| `@gen` | `#F1F7F4` | `#0B6E4F` | `1px solid #C4DED3` |
| `@deprecated` | `#FDF3F2` | `#B42318` | `1px solid #F4CFCB` |
| `@breaking` | `#FDF7EC` | `#8A5A00` | `1px solid #EBD9B4` |

**상태 배지 — 다크 모드:**

| 배지 | background | color | border |
|---|---|---|---|
| `@gen` | `rgb(31,58,42)` | `rgb(126,224,168)` | `none` |
| `@deprecated` | `rgb(58,31,31)` | `rgb(255,138,138)` | `none` |
| `@breaking` | `rgb(58,40,20)` | `rgb(255,180,100)` | `none` |

---

## 11. 출력 전 전체 체크리스트 (생략 금지)

보고서 HTML을 넘기기 전 마지막에 한 번 더 본다.

1. **코드 색상** — §8-4 전항 통과 (가장 자주 누락됨)
2. **골격** — `<header>` · 본문 · `<footer>` 가 전부 `<main>` 안에 있는가. 좌우 여백이 전 구간 `64px` 로 같은가 (§2-1b)
3. **결론** — 첫 섹션이 결론인가. 번호 없이 `결론` 라벨을 썼는가. 목차를 넣지 않았는가 (§3)
4. **각짐** — `border-radius` 가 한 군데도 없는가. 섹션 카드(`box-shadow`)·헤더 그라디언트·알약 배지가 없는가 (§6-5)
5. **섹션 머리** — 번호가 제목 **위** 작은 mono 두 자리(`01`)인가 (§6-2)
6. **표** — 세로 테두리·thead 배경·짝수행 줄무늬가 없는가. thead 아래만 잉크색 선인가 (§6-4)
7. **핵심 수치** — 넣었다면 근거가 실제로 수치인가. 4칸이 채워졌는가. 배경 없이 선으로만 묶었는가 (§5-2)
8. **시각화** — 최소 1개 (§5-5). 원인 분석이면 흐름도 포함
9. **색** — 포인트 `#2B3A55` 1개 + 위험 `#B42318` 최소. 형광펜은 결론 문단에만 (§4·§6-1)
10. **외부 의존** — Pretendard `<link>` 외에 `<script src>`·`import(...)`·CDN·mermaid가 없는가 (§2-1)
11. **SVG** — `viewBox` 있는가 / `width="100%"` 인가 / `<text>` 가 노드 밖으로 안 삐져나가는가 / 마지막 노드가 `viewBox` 안에 들어오는가 (§9-0)
9. **번역투** — 무생물 주어 / 불필요한 피동 / `~들` 남발 / `가지다·수행하다` 직역체 / 균일한 문장 리듬이 남아있지 않은가
