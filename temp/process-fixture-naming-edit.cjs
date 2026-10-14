const fs = require('fs');
const file = '@source/server/@test-modules/modules/definition.@test/src/model_customizer/process_definition.spec.ts';
let text = fs.readFileSync(file, 'utf8');
text = text.replace(/\bcache_before\b/g, 'assembledResultsBefore').replace(/\bcache_key\b/g, 'assembledResultsKey').replace(/\bcache\b/g, 'assembledResults');
// 운영 cache/resolver는 fixture Map의 이름이 아니다.
text = text.replace('운영 assembledResults/resolver', '운영 cache/resolver');
text = text.replace('withBankContext(({ context, lookup, assembledResults, reads }) => {', 'withBankContext((fixture) => {\r\n\t\t\tconst { context, lookup, assembledResults, reads } = fixture;');
text = text.replace('withBankContext(({ context, lookup, assembledResults }) => {', 'withBankContext((fixture) => {\r\n\t\t\tconst { context, lookup, assembledResults } = fixture;');
text = text.replace('원본/캐시 보존', '원본/조립 결과 보존').replace(/조립 캐시/g, '조립 결과');
text = text.replace('설정과 메모리 캐시를 격리하며', '설정과 조립 결과 저장소를 격리하며');
text = text.replace('fixture별 캐시와 조회 기록을 격리한다.', 'fixture별 조립 결과 저장소와 정적 원본, 조회 기록을 격리한다.');
fs.writeFileSync(file, text);
