---
name: apm-log-analyzer
description: 성능 측정을 위한 apm log 설정하는 skill
---


APM 로그 분석기
프로그램의 품질을 높이기 위해 속도가 느린 부분을 찾거나 불필요한 호출 구조를 파악 하거나 할 때 APM 로그를 활용하여 도움을 줄 수 있는 자료를 만들어 주는 프로그램 입니다.
본 문서에서는

로그 분석에 필요한 APM로그를 로컬 환경에서 수집하는 방법
분석기를 실행하는 방법

에 대하여 설명하겠습니다.
(뒤에 분석과정에서 필요한 팁들도 있으니 참고 하세요.)

1. APM 로그 수집

1.1. APM 사용 설정
APM Analyzer는 APM 로그를 기반으로 하기 때문에 테스트 환경에서 APM일 실행 될 수 있도록 해야합니다.
다음 3개의 파일에 대해서 설명한 작업을 해야 합니다.


deployInfo.conf (D:\ecountv5\Runtime\vshared\deployinfo.conf)

EnableAPM: true



apm.conf (D:\ecountv5\Runtime\vshared\apm.conf)

enable: true
minDetailSec 조정:
detail을 추적할 최소 수행시간 입니다.
이 설정값 이상인 request만 상세 정보를 남기게 됩니다.
기본이 5이기 때문에 적절히 조정 해야 합니다.
속도 측정시에는 0으로 추천 드립니다.(모든 요청에 대해 상세 남김)
enableTraceDto: true (추적시 program, svc, dac등의 input dto를 함께 추적 하는 option, 기본: false)
분석을 위해서는 반드시 true로 설정해 주세요.
설정이 적용되지 않을 경우 D:\ecountv5\Runtime\vapps\erp\apm.conf 가 있는지 확인 후 삭제해 주세요.



apm.start 파일
D:\ecountv5\Runtime\vshared에 apm.start라는 빈파일 생성
(빈 텍스트 파일 만들고 이름을 apm.start로 바꾸면 됨)



1.2. APM LOG 확인
위와 같이 설정이 완료 되면 서버를 실행하고, 페이지를 띄워 APM 로그가 남는지 확인해 봅니다.
APM 로그 위치는 다음과 같습니다.
로그는 계속 쌓이기 때문에 본인이 알아서 삭제해 주세요.

TRACE 로그

위치 : D:\ecountv5\Runtime\temp\apm\UPLOADING\TRACE
*.INFO 이름의 파일이 생성됩니다.


DETAIL 로그

위치 : D:\ecountv5\Runtime\temp\apm\UPLOADING\DETAIL
*.DETAIL 이름의 파일이 생성됩니다.


ERROR 로그

위치 : D:\ecountv5\Runtime\temp\apm\UPLOADING\ERROR
*.INFO 이름의 파일이 생성됩니다. (오류 발생 시만 생성 됩니다.)



(D:\ecountv5\Runtime\temp\apm\UPLOADING 즐겨찾기해두면 편함. 탐색기 상단 [홈] > [즐겨찾기에 고정])

1.3. APM LOG 수집
각자 로컬에서 시나리오를 잘 세워서 APM로그를 수집합니다.

2. 분석기 실행

2.1.  프로그램 위치
D:\ecountv5\Applications\apm_analyzer\main
(D:\ecountv5\Applications\apm_analyzer\main 즐겨찾기해두면 편함. 탐색기 상단 [홈] > [즐겨찾기에 고정])

2.2.  프로그램 실행방법

아래 설정파일 설명을 참고 하여 프로그램 위치에 있는 apm_analysis_target.json 값을 변경 합니다.
(2.4절)
프로그램 위치로 이동하여 run.bat를 실행 합니다.


2.3. 분석 report 파일
현재 다음 3종의 파일이 생성됩니다.
아래 파일 명의 * 은 report_[timestamp(ISO string)] 이름 규칙에 따라 자동으로 생성 됩니다.

1. *.multicall.csv


중복 호출 method를 나열한 파일 입니다.


함수 별 input dto별 2회 이상 중복 호출된 리스트 입니다.


다음은 csv 헤더 정보 입니다.



csv 헤더 정보

* set_id: apm_analysis_target.json의 set_id

* req_id: APM request id

* owner: method owner 

* method: method name

* count: 중복호출 수

* total ptaken: 전체 순수 소비 실행 합 
	=> 중복 호출 된 모든 호출의 순수 실행 시간 합

* percent(current): 지분율(현재request기준) 
	=> 현재 요청 전체 실행 시간(taken(curr)) 대비 중복 호출 된 모든 호출의 순수 실행 시간 합(total ptaken)의 비율

* percent(set): 지분율(set평균기준) 
	=> set평균실행시간(taken(set avg)) 대비 중복 호출 된 모든 호출의 순수 실행 시간 합(total ptaken)의 비율

* ptaken(avg): 평균순수실행시간(호출당)
	=> 호출 당 평균 순수 실행 시간

* ptaken(min): 최소순수실행시간
	=> 호출 중 최소 순수 실행 시간

* ptaken(max): 최대순수실행시간
	=> 호출 중 최대 순수 실행 시간

* taken(curr): 현재 request 전체실행시간

* taken(set avg): set평균실행시간 
	=> set내 모든 request의 평균 실행 시간

* data: method input dto



2. *.slow.csv

아래 slow_method_option 기준에 만족하는 호출 정보를 나열한 파일입니다.
다음은 csv 헤더 정보 입니다.


csv 헤더 정보
* set_id: apm_analysis_target.json의 set_id

* req_id: APM request id

* idx: method 고유 index

* pidx: 부모 method 고유 index

* taken: 실행시간 
	=> method 전체 실행 시간
* ptaken: 순수실행시간
	=> method child의 실행 시간을 제외한 순수한 실행 시간

* percent(current): 지분율(현재request기준) 
	=> 현재 요청 전체 실행 시간(taken(curr)) 대비 순수 실행 시간(ptaken)의 비율

* percent(set): 지분율(set평균기준) 
	=> set평균실행시간(taken(set avg)) 대비 순수 실행 시간(ptaken)의 비율

* ccount: 하위호출수  
	=>  하위 method 수
	
* multicalled: 중복호출포함여부  
	=>  위 multicall.csv에 포함된 method인지 여부 (Y:포함, N:미포함)
	
* total ptaken: 전체 순수 소비 실행 합 
	=> 중복 호출 된 모든 호출의 순수 실행 시간 합

* taken(curr): 현재 request 전체실행시간

* taken(set avg): set평균실행시간 
	=> set내 모든 request의 평균 실행 시간
	
* owner: method owner 

* method: method name

* data: method input dto



3. *.raw.json

APM LOG를 json화 한 raw data입니다.
분석 소스로 활용할 수 있습니다.
APM 분석 library에서 소스로 활용할 수 있습니다.


2.4.  apm_analysis_target.json(설정파일)
분석 대상을 정하고 분석 기준을 정하는 설정 파일입니다.

{
	"rootPath": "D:\\ecountv5\\Runtime\\temp\\apm\\UPLOADING\\DETAIL",
	"set": {
		"debug1": {
			"files": ["20240625082007.0bc77f8154a24b0195ad9e5c78bd4b71.DETAIL"]
		}
	},
	"slow_method_option": {
		"min_taken_time_percent": 5,
		"min_taken_time_sec": 0.5
	}
}




[속성 설명]


rootPath

아래 set에서 지정하는 분석 대상 file(files)의 directory 입니다.
또한 출력되는 분석 결과 report의 directory입니다.



set



{
[set_id: string]: {files:[]}
}



set_id: 임의로 정하는 값입니다. files의 그룹 이름이라고 생각하면 됩니다. 모든 report에 기록 됩니다.
files: 분석 대상 APM LOG 파일 입니다. rootPath아래 존재하는 파일이름을 나열하면 됩니다.
윈도우즈 명령 프롬프트를 아무 경로에서나 켜서 아래 커맨드를 실행하면
콘솔창에서 JSON 파일 리스트 획득 가능. 복사해서 files에 넣으면 됨.


dir D:\ecountv5\Runtime\temp\apm\UPLOADING\DETAIL\*.DETAIL | findstr /v "<DIR>" | powershell -Command "$input | ForEach-Object { if ($_ -match '\s+(\S+\.DETAIL)$') { $matches[1] } } | ConvertTo-Json"




slow_method_option
느린 method인지 판단하는 기준을 설정하는 option입니다. 아래 2개의 속성을 어느 하나라도 만족하면


min_taken_time_percent (기본값: 5)
method 순수 수행 시간과 전체 실행 시간의 percent비율 최소 값 입니다.
이 값을 초과하는 method는 slow.csv에 수집 됩니다.


min_taken_time_sec (기본값: 0.5)
순수 실행 시간의 최소 값 입니다. 순수 실행 시간이 이 값을 초과하는 method는 slow.csv에 수집 됩니다.

## 3. 반복 측정 운영 절차

### 3.1. 실제 로그 경로와 rootPath 확인

위 본문의 `D:\ecountv5\Runtime\temp\apm`은 기존 경로 예시입니다. 이번 환경에서 확인한 실제 로그 기준 경로는 다음과 같습니다.

```text
D:\ecountv5\Runtime\data\ecountv5\temp\apm
```

- TRACE: `UPLOADING\TRACE\*.INFO`
- DETAIL: `UPLOADING\DETAIL\*.DETAIL`
- ERROR: `UPLOADING\ERROR\*.INFO`

환경마다 실제 경로를 먼저 확인합니다. `apm_analysis_target.json`의 `rootPath`에는 확인한 DETAIL 폴더를 지정합니다.

```json
"rootPath": "D:\\ecountv5\\Runtime\\data\\ecountv5\\temp\\apm\\UPLOADING\\DETAIL"
```

`rootPath`는 입력 로그와 분석 결과의 저장 위치입니다. 이전 설정을 재사용하더라도 실행 전에 경로와 대상 파일의 존재 여부를 다시 확인합니다.

### 3.2. 여러 파일을 분석하는 방법

#### 실행별 비교: 파일마다 별도 set

반복 실행을 비교하려면 실행 시각 순서로 번호를 붙이고, set마다 파일 1개를 지정합니다.

```json
"set": {
  "CreateInventoryAction1": {
    "files": ["첫번째.DETAIL"]
  },
  "CreateInventoryAction2": {
    "files": ["두번째.DETAIL"]
  },
  "CreateInventoryAction3": {
    "files": ["세번째.DETAIL"]
  },
  "CreateInventoryAction4": {
    "files": ["네번째.DETAIL"]
  }
}
```

파일명은 실제 생성된 파일명으로 바꿉니다. 분석기를 한 번 실행하면 모든 set을 처리합니다. set마다 결과 파일을 따로 만들지 않고, 같은 결과 파일 안에서 `set_id`로 구분합니다.

#### 그룹 분석: 하나의 set에 여러 파일

여러 요청을 같은 그룹으로 분석하려면 하나의 set에 파일을 나열합니다.

```json
"set": {
  "CreateInventoryAction": {
    "files": ["첫번째.DETAIL", "두번째.DETAIL"]
  }
}
```

이 방식은 같은 set의 평균 요청 실행 시간을 계산합니다. 결과의 `taken(set avg)`와 `percent(set)`은 이 평균을 기준으로 합니다. 실행별 비교가 목적이면 파일마다 별도 set을 사용합니다.

### 3.3. API 요청과 상세 로그 연결

1. `UPLOADING\TRACE`의 INFO 파일에서 요청 경로에 대상 API 이름이 있는지 확인합니다.
2. TRACE와 파일명 본체가 같은 DETAIL 파일을 찾습니다. 예를 들어 `시각.요청ID.INFO`에 대응하는 파일은 `시각.요청ID.DETAIL`입니다.
3. 실행 시각, 실행 횟수, DETAIL 파일 존재 여부를 확인합니다.
4. 확인한 DETAIL 파일만 target에 등록합니다.

요청 수가 사용자가 알린 측정 횟수보다 많으면 예열 요청인지 확인합니다. 무조건 최신 N개를 선택하지 않습니다. 선택한 실행 시각과 제외한 요청을 사용자에게 알리고, 측정 구간이 불명확하면 확인을 요청합니다.

TRACE만 있고 대응하는 DETAIL이 없으면 target에 등록하지 않습니다. 먼저 수집 설정과 실제 로그 경로를 확인합니다.

### 3.4. 측정 전 수집 설정 재확인

작업 중 설정이 이전 값으로 돌아간 사례가 있었습니다. 원인은 확인하지 않았습니다. 이전에 설정했더라도 매 측정 전에 다음 항목을 확인합니다.

| 파일 | 확인 항목 |
| --- | --- |
| `D:\ecountv5\Runtime\vshared\deployinfo.conf` | `EnableAPM: true` |
| `D:\ecountv5\Runtime\vshared\apm.conf` | `enable: true`, `minDetailSec: 0`, `enableTraceDto: true` |
| `D:\ecountv5\Runtime\vshared\apm.start` | 확장자 없는 빈 파일 존재 |
| `D:\ecountv5\Runtime\vapps\erp\apm.conf` | 별도 설정 파일 존재 여부 |

기존 `apm.conf`는 문자열 값(`"true"`, `"0"`)을 사용했습니다. 기존 파일의 값 형식을 유지하며 필요한 항목만 변경합니다.

별도 `vapps\erp\apm.conf`가 있으면 본문의 삭제 안내를 바로 실행하지 않습니다. 먼저 내용과 영향 범위를 확인하고, 삭제가 필요하면 사용자에게 확인합니다.

### 3.5. Git Bash에서 분석기 실행

Windows의 Git Bash에서는 다음 명령으로 실행합니다.

```bash
cd /d/ecountv5/Applications/apm_analyzer/main
MSYS_NO_PATHCONV=1 cmd.exe /c run.bat
```

이번 환경에서 `MSYS_NO_PATHCONV=1` 없이 실행했을 때 분석기가 실행되지 않고 명령 프롬프트만 표시된 사례가 있었습니다. 이 옵션을 지정한 명령으로 정상 실행을 확인했습니다.

실행 전에 target의 `rootPath`, set 이름, 대상 파일을 확인합니다. 실행 후에는 실제 결과 파일 생성 여부를 확인합니다. 명령 출력이 없다는 이유만으로 성공으로 판단하지 않습니다.