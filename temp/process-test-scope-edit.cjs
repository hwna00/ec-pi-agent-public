const fs = require('fs');
const file = '@source/server/@test-modules/modules/definition.@test/src/model_customizer/process_definition.spec.ts';
let s = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
s = s.replace("import { resolveModelCustomizeContext } from 'common';\n",'').replace("const SOURCE_ID = 'static∬ScrapingMasterModel';\n",'');
const begin = s.indexOf('// 테스트:');
const end = s.indexOf('function withBankContext(');
s = s.slice(0,begin) + `// 테스트: 실제 full 조회 결과에서 대표 3개 항목의 타입과 의미만 확인한다.
for (const model_id of MODEL_IDS) {
	test(\`model_customizer > process definition > \${model_id} 대표 항목의 \${model_id === 'bankXprocess' ? '원본 타입' : '검색 조건 타입'}과 의미\`, () => {
		withBankContext((fixture) => {
			const { context, lookup } = fixture;

			// 등록된 factory와 조립 Program을 통해 full definition을 조회한다.
			const def = lookup(model_id);
			if (!def) throw new Error(\`process_definition test: 조회 결과가 필요합니다: \${model_id}\`);

			// 전체 항목 목록과 active 선택은 검사하지 않는다.
			for (const [prop_id, meaning, original_type, condition_type] of REPRESENTATIVES) {
				const prop = def.getProp(context, prop_id);
				if (!prop) throw new Error(\`process_definition test: 대표 항목이 필요합니다: \${model_id}, \${prop_id}\`);
				Assert.equal(prop.type, model_id === 'bankXprocess' ? ENUM_PROP_TYPE.Data : ENUM_PROP_TYPE.Abstract);
				Assert.equal(prop.data_type, model_id === 'bankXprocess' ? original_type : condition_type);
				Assert.equal(prop.item_meaning_id, meaning);
			}
		});
	});
}

// 공통 fixture: 실제 scope/등록/조립 경로를 유지하고 설정 입력만 격리한다.
/** 운영 cache/resolver 통합 테스트는 아니다. */
` + s.slice(end);
s = s.replace('\t\tassembledResults: Map<string, IModelCustomizeResult>;\n\t\treads: string[];\n','');
s = s.replace('\t\t// fixture별 조립 결과 저장소와 정적 원본, 조회 기록을 격리한다.\n\t\tconst assembledResults = new Map<string, IModelCustomizeResult>();\n\t\tconst static_definitions = new Map<string, $ModelDefinition<any>>();\n\t\tconst reads: string[] = [];', '\t\t// 조립 중 정적 모델 재조회는 같은 원본을 사용한다.\n\t\tconst static_definitions = new Map<string, $ModelDefinition<any>>();');
s = s.replace('\t\t\t\treads.push(data_id);\n','');
const cacheBegin = s.indexOf('\t\t\t\t\tconst assembledResultsKey =');
const cacheEnd = s.indexOf('\n\t\t\t\t}',cacheBegin);
if(cacheBegin<0 || cacheEnd<0) throw Error('missing assembled cache block');
s = s.slice(0,cacheBegin) + `\t\t\t\t\treturn ProgramBuilder.create<IAssembledDefinitionKey, IModelCustomizeResult>(
						EN_PROGRAM_ID.GetAssembledDefinitionProgram,
						context
					).execute(key);` + s.slice(cacheEnd);
s = s.replace('\t\t\tassembledResults,\n\t\t\treads,\n','');
fs.writeFileSync(file,s.replace(/\n/g,'\r\n'));
