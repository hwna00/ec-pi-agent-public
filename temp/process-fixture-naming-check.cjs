const fs = require('fs'), ts = require('typescript'), assert = require('assert'), cp = require('child_process');
const file = '@source/server/@test-modules/modules/definition.@test/src/model_customizer/process_definition.spec.ts';
const before = fs.readFileSync('.pi/temp/process-fixture-naming.before.ts','utf8');
const after = fs.readFileSync(file,'utf8');
let normalized = after.replace(/\r\n/g,'\n');
normalized = normalized.replace('withBankContext((fixture) => {\n\t\t\tconst { context, lookup, assembledResults, reads } = fixture;', 'withBankContext(({ context, lookup, assembledResults, reads }) => {');
normalized = normalized.replace('withBankContext((fixture) => {\n\t\t\tconst { context, lookup, assembledResults } = fixture;', 'withBankContext(({ context, lookup, assembledResults }) => {');
normalized = normalized.replace(/\bassembledResultsBefore\b/g,'cache_before').replace(/\bassembledResultsKey\b/g,'cache_key').replace(/\bassembledResults\b/g,'cache').replace(/조립 결과/g,'조립 캐시');
function printed(s) { const sf = ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true); return ts.createPrinter({removeComments:true}).printFile(sf); }
assert.strictEqual(printed(normalized), printed(before));
console.log('PASS: reverse naming/fixture-destructuring normalization yields identical full-file AST printing (comments/format excluded).');
const sf = ts.createSourceFile(file,after,ts.ScriptTarget.Latest,true);
let sites=0, fixtureCallbacks=0;
function visit(n) {
 if(ts.isIdentifier(n)) assert(!['cache','cache_before','cache_key'].includes(n.text),'old identifier '+n.text);
 if(ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
  if(n.expression.text==='test') sites++;
  if(n.expression.text==='withBankContext') { fixtureCallbacks++; assert.strictEqual(n.arguments[0].parameters[0].name.getText(sf),'fixture'); }
 }
 ts.forEachChild(n,visit);
}
visit(sf); assert.strictEqual(sites,2); assert.strictEqual(fixtureCallbacks,2);
assert(after.includes("const MODEL_IDS = ['bankXprocess', 'bankXprocess_search']"));
assert(after.includes('운영 cache/resolver 통합 테스트는 아니다'));
console.log('PASS: 2 registration sites / 3 tests unchanged; both callbacks use fixture; no legacy Map identifiers; production cache explanation retained.');
const otherDiff = s => s.split(/(?=^diff --git )/m).filter(block => !block.startsWith('diff --git a/ecount.solution/'+file+' ')).join('');
const current = cp.execFileSync('git',['diff','--binary'],{encoding:'utf8'});
assert.strictEqual(otherDiff(current),otherDiff(fs.readFileSync('.pi/temp/process-fixture-naming.worktree.before.diff','utf8')));
console.log('PASS: all unrelated unstaged diffs byte-for-byte preserved.');
assert(before.includes('\r\n') && after.includes('\r\n'));
console.log('PASS: baseline CRLF retained.');
