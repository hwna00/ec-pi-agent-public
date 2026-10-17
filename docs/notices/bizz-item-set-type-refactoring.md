# 조회/현황 리팩토링으로 인한 item_set_type 등록 위치 변경 안내

## 1. 변경 개요

업무 기본 필드 계산에 사용하는 모델 매핑의 관리 위치가 변경되었습니다.

기존에는 공통 코드의 `bizz_model_map`에서 업무 유형별 매핑을 관리했으나, 리팩터링 이후에는 **각 업무의 `xxx_bizz_definition.ts`에서 관리합니다.**

이에 따라 `root_model_into_list`에 모델을 등록할 때 **각 root 항목에 `item_set_type`을 지정해 주시기 바랍니다.**

- 관련 커밋: `[A26_03987] 5.6 Refactoring List & Status`
- 변경 항목: root 및 부속 array 모델의 매핑 정보 관리 위치
- 본 안내의 `item_set_type`은 메뉴의 `section_type`과 별도 정보입니다.

## 2. 변경 전후 비교

| 구분 | 변경 전 | 변경 후 |
|---|---|---|
| 관리 위치 | 공통 `Util.ts`의 `bizz_model_map` | 업무별 `xxx_bizz_definition.ts` |
| 관리 단위 | 업무 유형(`bizz_type`)별 매핑 | 각 업무 정의의 모델 구성 |
| root 모델 매핑 | 공통 상수에 항목세트 종류별 모델 지정 | `root_model_into_list`의 `item_set_type`과 `source_model_id` 사용 |
| 부속 array 모델 매핑 | 공통 상수에 affiliation별 모델 지정 | `array_model_info_list`의 `affiliation_id`와 `source_model_id` 사용 |
| 매핑 조회 | `bizz_model_map[bizz_type]` | `resolveBizzModelMap(bizz_definition)` |

### 기존 관리 위치

```text
@source/server/ecount/@infra/common/src/pmodule/global_pexecutor/Util.ts
```

예를 들어 Inventory 유형의 모델 매핑은 공통 상수에 다음과 같이 지정되어 있었습니다.

| 항목세트 종류 | source model |
|---|---|
| `SingleInput` | `static∬InventoryMasterModel` |
| `MultiInput` | `static∬InventoryDetailModel` |

### 변경 후 관리 위치

```text
@source/server/modules/<업무 모듈>/src/definition/xxx_bizz_definition.ts
```

이제 모델 매핑은 업무 정의에서 구성합니다. 기존 공통 `bizz_model_map`에 항목을 추가하는 방식은 사용하지 않습니다.

## 3. 적용 대상 및 사용 시점

### 업무 정의 작성·수정 시

현재 `IRootModelInfo` 타입은 `item_set_type`을 필수 필드로 선언합니다. 신규 업무를 작성하거나 기존 업무에 root 모델을 추가하는 경우, 각 항목에 해당 모델의 역할에 맞는 값을 지정해야 합니다.

### 업무 기본 필드 계산 시

`BizzBaseFieldPExecutor`의 `EN_FIELD_REQUEST_TYPE.Bizz` 요청에서 이 매핑을 사용합니다. 대표적인 호출 경로는 다음과 같습니다.

```text
StaticModelFactory의 업무 기본 필드 요청
  → BizzBaseFieldPExecutor (Bizz 요청)
  → resolveBizzModelMap(bizz_definition)
  → root 및 array 모델의 기본 필드 계산
```

업무설정 모델 등 등록된 static 모델의 초기화 과정에서도 위 경로가 실행될 수 있으므로, **값이 누락되면 화면 진입 전 Velox 시작 단계에서 오류가 발생할 수 있습니다.**

| 정의 상태 | 해당 resolver 호출 시 동작 |
|---|---|
| 업무 정의 없음 | 예외 발생 |
| root 목록이 비어 있거나 모든 root에 `item_set_type` 없음 | 예외 발생 |
| 일부 root에만 `item_set_type` 없음 | 값이 없는 항목을 매핑에서 제외 |

일부 항목만 누락된 경우에는 예외가 발생하지 않더라도 필요한 모델 매핑이 제외될 수 있습니다. 각 root 항목에 값을 지정해 주시기 바랍니다.

모든 업무가 위 실행 경로를 사용하는 것은 아닙니다. 실행 경로에 따른 오류 발생 여부와 별개로, root 항목은 타입 정의에 맞게 작성해야 합니다. 단, root 목록이 비어 있는 업무는 실제 모델 구성을 먼저 확인해야 하며, 예외를 피하기 위해 임의의 모델을 추가해서는 안 됩니다.

## 4. 수정 방법

### 4.1. enum import 추가

해당 업무의 `xxx_bizz_definition.ts`에서 기존 `@infra/common@` named import에 `EN_ITEM_SET_TYPE`을 추가합니다.

```ts
import {
    EN_ITEM_SET_TYPE,
    IBizzDefinition,
    // 기존 import 유지
} from '@infra/common@';
```

### 4.2. root 항목에 item_set_type 지정

기존 업무 정의 객체의 `root_model_into_list`에 값을 추가합니다. 아래는 어음 업무의 Master/Detail 설정 예시입니다.

```ts
root_model_into_list: [
    {
        source_model_id: 'static∬AccountOtherInoutMasterModel',
        model_id: 'account_iss_noteXmaster',
        item_set_type: EN_ITEM_SET_TYPE.SingleInput,
    },
    {
        source_model_id: 'static∬AccountOtherInoutDetailModel',
        model_id: 'account_iss_noteXdetail',
        item_set_type: EN_ITEM_SET_TYPE.MultiInput,
    },
],
```

| 모델 역할 | 설정 값 |
|---|---|
| 단일 입력 | `EN_ITEM_SET_TYPE.SingleInput` |
| 다중 입력 | `EN_ITEM_SET_TYPE.MultiInput` |
| 본문 항목세트 | `EN_ITEM_SET_TYPE.Content` |

모델 이름이 아니라 실제 항목세트 역할을 기준으로 값을 지정합니다. 단일 입력 root만 사용하는 업무는 `SingleInput`만 지정하면 되며, 불필요한 Detail 또는 Content 모델을 추가할 필요는 없습니다.

### 4.3. 부속 array 및 메뉴 설정과의 구분

- **부속 array 모델:** 기존 `array_model_info_list`에서 관리합니다. `item_set_type` 추가 대상이 아니며, `affiliation_id`, `source_model_id`, `item_set_group`, `item_set`을 유지합니다.
- **메뉴 섹션:** `menus[...].model_info_list`의 `section_type`으로 관리합니다. 이번 모델 매핑 변경을 위해 메뉴의 `section_type`을 추가할 필요는 없습니다. 메뉴 섹션은 별도 요구사항에 따라 설정합니다.

## 5. 반영 시 유의사항

1. 해당 업무 정의의 각 root 항목에 `item_set_type`을 지정합니다.
2. 소스 수정 후 프로젝트의 `pnpm build` / `module_build` 절차에 따라 해당 모듈을 빌드합니다.
3. 필요한 경우 Velox를 재시작하여 변경된 정의를 반영합니다.

**소스만 수정하고 런타임 산출물에 반영하지 않으면 동일한 누락 오류가 계속 발생할 수 있습니다.** 산출물을 직접 수정하지 않고 모듈 빌드로 반영해 주시기 바랍니다.

## 참고 코드

| 구분 | 경로 및 항목 |
|---|---|
| 기존 중앙 매핑 | 리팩터링 커밋의 부모 버전 `@source/server/ecount/@infra/common/src/pmodule/global_pexecutor/Util.ts`의 `bizz_model_map` |
| 현재 매핑 구성 | `@source/server/ecount/@infra/common/src/pmodule/global_pexecutor/definition_field_resolver.ts`의 `resolveBizzModelMap()` |
| 매핑 사용 | `@source/server/ecount/@infra/common/src/pmodule/global_pexecutor/p_executor/bizz_base_field/BizzBaseFieldPExecutor.ts` |
| 업무 기본 필드 요청 | `@source/server/modules/common/src/@model_factory/StaticModelFactory.ts` |
| root/array 타입 | `@source/@shared/ecount/@infra/common@/src/@type/types/bizz/IBizzDefinition.ts` |
| 설정 예시 | `@source/server/modules/account_other_inout.account_iss_note/src/definition/account_iss_note_bizz_definition.ts` |
