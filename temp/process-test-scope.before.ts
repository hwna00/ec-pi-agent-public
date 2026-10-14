import { IExecutionContext, ModuleManager, ProgramBuilder } from '@infra/common';
import {
	EN_DATA_ID as SHARED_DATA_ID,
	EN_DATA_TYPE_ID_OLD,
	EN_FEATURE_ID as SHARED_FEATURE_ID,
	EN_META_MENU_TYPE,
	EN_MENU_TYPE,
	EN_MODEL_REFER_TYPE,
	EN_VALUE_P_ID,
	ProgramContextFeature,
} from '@infra/common@';
import { EN_DATA_ID as BIZZ_DATA_ID } from 'bizz@.abstraction';
import {
	EN_DATA_ID,
	EN_DEFINITION_PURPOSE,
	EN_PROGRAM_ID,
	IAssembledDefinitionKey,
	IModelCustomizeResult,
} from 'common.abstraction';
import { resolveModelCustomizeContext } from 'common';
import { Assert, test } from '@test';
import { getTestContext } from '../_helper/context';

const BIZZ_SID = 'B_000000E010205';
const MENU_SID = 'M_000000E010205';
const TENANT_SID = '300000';
const TEMPLATE_SID = 'process_definition_test';
const SOURCE_ID = 'static∬ScrapingMasterModel';
const MODEL_IDS = ['bankXprocess', 'bankXprocess_search'] as const;
type ProcessModelId = (typeof MODEL_IDS)[number];

const REPRESENTATIVES = [
	['scraping_s$data_dt', 'data_dt', EN_DATA_TYPE_ID_OLD.$$date, EN_DATA_TYPE_ID_OLD.$$date_range_condition],
	['scraping_s$scraping_amt', 'scraping_amt', EN_DATA_TYPE_ID_OLD.$$decimal, EN_DATA_TYPE_ID_OLD.$$decimal_condition],
	[
		'scraping_s$increase_decrease_type',
		'increase_decrease_type',
		EN_DATA_TYPE_ID_OLD.$$txt,
		EN_DATA_TYPE_ID_OLD.$$txt_condition,
	],
] as const;

// 테스트: 모델별 계약과 반복 조회의 원본/조립 결과 보존을 확인한다.
for (const model_id of MODEL_IDS) {
	test(`model_customizer > process definition > ${model_id} full definition과 source/Master 계약`, () => {
		withBankContext((fixture) => {
			const { context, lookup, assembledResults, reads } = fixture;
			const source = context.definition.get<$ModelDefinition<any>>(SOURCE_ID);
			if (!source) throw new Error('process_definition test: 정적 원본이 필요합니다');
			const before = signature(source);

			// 참조 비교가 alias와 내용이 같은 별도 clone을 구분하는지 확인한다.
			const alias = source;
			const clone_a = $ModelDefiner.customize(source).invoke();
			const clone_b = $ModelDefiner.customize(source).invoke();
			Assert.isTrue(sameDefinitionInstance(source, alias));
			Assert.isFalse(sameDefinitionInstance(source, clone_a));
			Assert.equal(signature(clone_a), signature(clone_b));
			Assert.isFalse(sameDefinitionInstance(clone_a, clone_b));

			// 등록된 source/Master 계약과 실제 full definition 조회를 확인한다.
			const resolved = resolveModelCustomizeContext(context, model_id);
			Assert.equal(resolved.source_model_id, SOURCE_ID);
			Assert.equal(resolved.source_model_refer_type, EN_MODEL_REFER_TYPE.Master);
			Assert.equal(
				resolved.customize_model_refer_type,
				model_id === 'bankXprocess' ? EN_MENU_TYPE.Process : EN_MODEL_REFER_TYPE.ProcessSearch
			);
			const def = lookup(model_id);
			Assert.isTrue(Array.from(def.getProps()).length > 0);
			Assert.equal(
				signature(def),
				signature(Array.from(assembledResults.values())[0].def),
				'full 반환값은 조립 모집단 전체를 보존한다'
			);

			// 대표 항목의 타입, 의미, 참조 계약을 확인한다.
			for (const [prop_id, meaning, original_type, condition_type] of REPRESENTATIVES) {
				const original = source.getProp(context, prop_id);
				const prop = def.getProp(context, prop_id);
				Assert.equal(original?.data_type, original_type);
				Assert.equal(prop?.data_type, model_id === 'bankXprocess' ? original_type : condition_type);
				Assert.equal(prop?.item_meaning_id, meaning);
				Assert.equal(prop?.refer_type, original?.refer_type);
				Assert.equal(prop?.type, model_id === 'bankXprocess' ? original?.type : ENUM_PROP_TYPE.Abstract);
			}

			// 반환 인스턴스는 분리되고 조립 결과와 원본 내용은 보존되어야 한다.
			Assert.equal(assembledResults.size, 1);
			Assert.isFalse(
				sameDefinitionInstance(def, Array.from(assembledResults.values())[0].def),
				'full 반환값도 조립 결과와 별도 인스턴스다'
			);
			Assert.equal(signature(source), before);
			Assert.isTrue(reads.includes(BIZZ_DATA_ID.ctx_bizz_definition));
		});
	});
}

test('model_customizer > process definition > grid/search 순서 변경과 반복 조회는 원본/조립 결과를 오염시키지 않는다', () => {
	for (const order of [MODEL_IDS, [MODEL_IDS[1], MODEL_IDS[0]]]) {
		withBankContext((fixture) => {
			const { context, lookup, assembledResults } = fixture;
			const source = context.definition.get<$ModelDefinition<any>>(SOURCE_ID);
			if (!source) throw new Error('process_definition test: 정적 원본이 필요합니다');
			const source_before = signature(source);

			// 지정 순서로 최초 조회 결과와 내용을 저장한다.
			const first = new Map<ProcessModelId, $ModelDefinition<any>>();
			const snapshots = new Map<ProcessModelId, string>();
			for (const model_id of order) {
				const def = lookup(model_id);
				first.set(model_id, def);
				snapshots.set(model_id, signature(def));
			}
			const assembledResultsBefore = Array.from(assembledResults.values(), (assembled) =>
				signature(assembled.def)
			);

			// 역순 재조회도 별도 인스턴스를 반환하고 최초 내용을 유지해야 한다.
			for (const model_id of [...order].reverse()) {
				const def = lookup(model_id);
				const first_def = first.get(model_id);
				if (!first_def) throw new Error(`process_definition test: 최초 조회 결과가 필요합니다: ${model_id}`);
				Assert.isFalse(sameDefinitionInstance(def, first_def));
				Assert.equal(signature(def), snapshots.get(model_id));
				Assert.equal(signature(first_def), snapshots.get(model_id));
			}

			// 조회 순서와 반복 횟수가 조립 결과와 원본을 바꾸지 않아야 한다.
			Assert.equal(assembledResults.size, 2);
			Assert.equal(
				Array.from(assembledResults.values(), (assembled) => signature(assembled.def)),
				assembledResultsBefore
			);
			Assert.equal(signature(source), source_before);
		});
	}
});

// 공통 helper: 참조/내용 비교와 실제 조립 경로를 사용하는 fixture.
function sameDefinitionInstance(a: $ModelDefinition<any>, b: $ModelDefinition<any>): boolean {
	if (!a || !b) throw new Error('process_definition test: 비교할 definition 인스턴스가 필요합니다');
	const seen = new WeakMap<$ModelDefinition<any>, boolean>();
	seen.set(a, true);
	return seen.has(b);
}

// 참조 비교와 별개로 prop 내용을 정렬하여 비교한다.
function signature(def: $ModelDefinition<any>): string {
	return JSON.stringify(
		Array.from(def.getProps(), (prop) => ({
			prop_id: prop.prop_id,
			type: prop.type,
			data_type: prop.data_type,
			item_meaning_id: prop.item_meaning_id,
			refer_type: prop.refer_type,
		})).sort((a, b) => a.prop_id.localeCompare(b.prop_id))
	);
}

/** 실제 등록 callback/ProgramBuilder/조립기/엔진 대상. 설정과 조립 결과 저장소를 격리하며 운영 cache/resolver 통합 테스트는 아니다. */
function withBankContext(
	body: (fixture: {
		context: IExecutionContext;
		assembledResults: Map<string, IModelCustomizeResult>;
		reads: string[];
		lookup: (model_id: ProcessModelId) => $ModelDefinition<any>;
	}) => void
): void {
	// 등록된 업무/메뉴를 준비한다.
	const base = getTestContext();
	const bank = ModuleManager.get('scraping.bank');
	if (!bank) throw new Error('process_definition test: scraping.bank 최신 배포본이 필요합니다');
	const bizz = bank.manifest.definitions?.bizz;
	const menu = bank.manifest.definitions?.menus?.find((entry) => entry.menu_type === EN_META_MENU_TYPE.Process);
	if (!bizz || !menu) throw new Error('process_definition test: bank 업무/Process 메뉴가 필요합니다');
	Assert.equal(bizz.bizz_sid, BIZZ_SID);

	const scope_context = base as IExecutionContext & {
		enterScope(): { dispose(): void };
		setFeatureG(id: string, feature: ProgramContextFeature): void;
	};

	// BaseProgram이 실제 scope 안에서 선언한 context를 읽게 한다. 고정 getProgramContext 대역은 쓰지 않는다.
	using(scope_context.enterScope(), () => {
		scope_context.setFeatureG(
			SHARED_FEATURE_ID.IProgramContextFeature,
			new ProgramContextFeature({
				data_type: 'process_definition_test',
				data: {
					bizz_id: bizz.bizz_id,
					bizz_type: bizz.type,
					bizz_sid: BIZZ_SID,
					tenant_sid: TENANT_SID,
					menu_sid: MENU_SID,
					menu_type: EN_META_MENU_TYPE.Process,
				},
			})
		);

		// fixture별 조립 결과 저장소와 정적 원본, 조회 기록을 격리한다.
		const assembledResults = new Map<string, IModelCustomizeResult>();
		const static_definitions = new Map<string, $ModelDefinition<any>>();
		const reads: string[] = [];

		// sourceData는 ProgramContextFeature 생성자 입력이 아니라 runtime context의 별도 source container다.
		// 메뉴 입력만 대역한다. 선언 data는 매 호출마다 실제 scope/feature에서 읽고 예상 밖 source 조회는 차단한다.
		const source_data = new Proxy(
			{ menu: { definition: menu } },
			{
				get(target, key) {
					if (key === 'menu') return target.menu;
					throw new Error(`process_definition test: 예상하지 않은 sourceData 조회: ${String(key)}`);
				},
			}
		);

		// 조립은 실제 ProgramBuilder로 수행하고 허용한 설정만 공급한다.
		let context: IExecutionContext;
		const data = {
			fetch(data_id: string, key: any) {
				reads.push(data_id);
				if (data_id === EN_DATA_ID.assembled_definitions) {
					Assert.equal(key, {
						tenant_sid: TENANT_SID,
						bizz_sid: BIZZ_SID,
						model_id: key.model_id,
						menu_type: EN_META_MENU_TYPE.Process,
						template_set_sid: TEMPLATE_SID,
						definition_purpose: EN_DEFINITION_PURPOSE.Setup,
					});
					Assert.isTrue(MODEL_IDS.some((id) => id === key.model_id));
					const assembledResultsKey = JSON.stringify(key);
					let assembled = assembledResults.get(assembledResultsKey);
					if (!assembled) {
						assembled = ProgramBuilder.create<IAssembledDefinitionKey, IModelCustomizeResult>(
							EN_PROGRAM_ID.GetAssembledDefinitionProgram,
							context
						).execute(key);
						assembledResults.set(assembledResultsKey, assembled);
					}
					return assembled;
				}
				if (data_id === BIZZ_DATA_ID.ctx_bizz_definition) {
					Assert.equal(key.bizz_sid, BIZZ_SID);
					return bizz;
				}
				if (data_id === BIZZ_DATA_ID.ctx_bizz_item_attribute || data_id === BIZZ_DATA_ID.ctx_bizz_attribute) {
					Assert.equal(key.bizz_sid, BIZZ_SID);
					return {};
				}
				if (data_id === EN_DATA_ID.bizz_conn_info) {
					Assert.equal(key.bizz_sid, BIZZ_SID);
					return { start_bizz: [], end_bizz: [] };
				}
				throw new Error(`process_definition test: 예상하지 않은 설정 fetch: ${data_id}`);
			},

			get(request?: { data_id: string; key?: { value_p_id: string; value_key: string } }) {
				const key = request?.key;
				if (
					request?.data_id === SHARED_DATA_ID.value_p &&
					key &&
					Object.keys(key).length === 2 &&
					(([EN_VALUE_P_ID.own_mandatory_p, EN_VALUE_P_ID.own_relation_p, EN_VALUE_P_ID.own_compose_p].some(
						(id) => id === key.value_p_id
					) &&
						[EN_MENU_TYPE.Process, EN_MODEL_REFER_TYPE.ProcessSearch].some(
							(role) => key.value_key === `${bizz.type}:${role}:${bizz.bizz_id}`
						)) ||
						(key.value_p_id === EN_VALUE_P_ID.bizz_repo_column_fixed_value_p &&
							key.value_key === `${bizz.type}:${bizz.bizz_id}`))
				) {
					// 미정 정책은 raw API의 미매칭(undefined)으로 반환하여 조립기의 기본 동작을 보존한다.
					return undefined;
				}
				throw new Error(
					`process_definition test: 예상하지 않은 data.get: ${request?.data_id}, key=${JSON.stringify(key)}`
				);
			},
		};

		// 실제 factory를 사용하고 정적 원본만 fixture 안에서 재사용한다.
		const definition = {
			get(identifier: string, key?: any): $ModelDefinition<any> {
				if (!identifier.startsWith('static∬') && !MODEL_IDS.some((id) => id === identifier)) {
					throw new Error(`process_definition test: 예상하지 않은 모델 조회: ${identifier}`);
				}
				const cached = static_definitions.get(identifier);
				if (cached) return cached;
				const def = $ModelFactory.resolveDefinition(context, identifier, key);
				if (!def) throw new Error(`process_definition test: 등록된 모델이 필요합니다: ${identifier}`);
				if (identifier.startsWith('static∬')) static_definitions.set(identifier, def);
				return def;
			},
		};

		// 실제 scope 조회와 메서드 bind를 유지하며 메뉴/설정/tenant 입력만 격리한다.
		context = new Proxy(base, {
			get(target, key) {
				if (key === 'data' || key === '$data') return data;
				if (key === 'getProgramContext')
					return (declared?: Parameters<IExecutionContext['getProgramContext']>[0]) =>
						new Proxy(target.getProgramContext(declared), {
							get(program_context, field) {
								if (field === 'sourceData') return source_data;
								if (field === 'getSourceData')
									return () => {
										throw new Error('process_definition test: 예상하지 않은 getSourceData');
									};
								const value = Reflect.get(program_context, field, program_context);
								return typeof value === 'function' ? value.bind(program_context) : value;
							},
						});
				if (key === 'sourceData') return source_data;
				if (key === 'getSourceData')
					return () => {
						throw new Error('process_definition test: 예상하지 않은 context.getSourceData');
					};
				if (key === 'definition' || key === '$definition') return definition;
				if (key === 'session')
					return new Proxy(target.session, {
						get(session, field) {
							return field === 'tenant_sid' ? TENANT_SID : Reflect.get(session, field, session);
						},
					});
				const value = Reflect.get(target, key, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as IExecutionContext;

		// 테스트 실행 뒤 scope 정리는 using에 맡긴다.
		body({
			context,
			assembledResults,
			reads,
			lookup: (model_id) =>
				definition.get(model_id, {
					bizz_sid: BIZZ_SID,
					menu_sid: MENU_SID,
					template_set_sid: TEMPLATE_SID,
					is_full_definition: true,
				}),
		});
	});
}
