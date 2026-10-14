const fs = require('fs'), ts = require('typescript'), assert = require('assert'), cp = require('child_process');
const file = '@source/server/@test-modules/modules/definition.@test/src/model_customizer/process_definition.spec.ts';
const before = fs.readFileSync('.pi/temp/process-test-scope.before.ts','utf8');
const after = fs.readFileSync(file,'utf8');
const parse = s => ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true);
const b = parse(before), a = parse(after), printer = ts.createPrinter({removeComments:true});
const print = (n,sf) => printer.printNode(ts.EmitHint.Unspecified,n,sf);
function find(sf,pred) { const matches=[]; function visit(n) { if(pred(n,sf)) matches.push(n); ts.forEachChild(n,visit); } visit(sf); return matches; }
function initializer(sf,name) { return find(sf,n=>ts.isVariableDeclaration(n)&&n.name.getText(sf)===name)[0].initializer; }
for(const name of ['MODEL_IDS','REPRESENTATIVES','source_data','definition']) assert.strictEqual(print(initializer(a,name),a),print(initializer(b,name),b));
const dataGet = sf => initializer(sf,'data').properties.find(n=>n.name.getText(sf)==='get');
assert.strictEqual(print(dataGet(a),a),print(dataGet(b),b));
const contextAssignment = sf => find(sf,n=>ts.isBinaryExpression(n)&&n.left.getText(sf)==='context'&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken)[0];
assert.strictEqual(print(contextAssignment(a),a),print(contextAssignment(b),b));
const featureCall = sf => find(sf,n=>ts.isCallExpression(n)&&n.expression.getText(sf)==='scope_context.setFeatureG')[0];
assert.strictEqual(print(featureCall(a),a),print(featureCall(b),b));
console.log('PASS: representative expectations, strict Value P get/undefined, source proxy, factory/static model reuse, context/session/bind proxy and scope feature unchanged.');
const tests = find(a,n=>ts.isCallExpression(n)&&n.expression.getText(a)==='test');
assert.strictEqual(tests.length,1);
assert.strictEqual(initializer(a,'MODEL_IDS').expression.elements.length,2);
console.log('PASS: 1 loop registration site x 2 model IDs = 2 tests, bankXprocess then bankXprocess_search.');
for(const text of ['signature','sameDefinitionInstance','WeakMap','clone_a','clone_b','assembledResults','reads','resolveModelCustomizeContext','SOURCE_ID']) assert(!new RegExp('\b'+text+'\b').test(after),text+' remains');
for(const text of ['if (!def) throw new Error','if (!prop) throw new Error','ENUM_PROP_TYPE.Data : ENUM_PROP_TYPE.Abstract','Assert.equal(prop.data_type','Assert.equal(prop.item_meaning_id','is_full_definition: true','template_set_sid: TEMPLATE_SID',"ModuleManager.get('scraping.bank')",'$ModelFactory.resolveDefinition(context, identifier, key)','return ProgramBuilder.create<IAssembledDefinitionKey, IModelCustomizeResult>','EN_PROGRAM_ID.GetAssembledDefinitionProgram','using(scope_context.enterScope()']) assert(after.includes(text),'required shape missing '+text);
assert.strictEqual(find(a,n=>ts.isNewExpression(n)&&n.expression.getText(a)==='Map').length,1);
assert.strictEqual(find(a,n=>ts.isFunctionDeclaration(n)).length,1);
console.log('PASS: full/template/actual factory and direct ProgramBuilder path, presence guards and fixed type/data_type/meaning assertions retained; only static model Map/helper remains.');
const otherDiff = s => s.split(/(?=^diff --git )/m).filter(block=>!block.startsWith('diff --git a/ecount.solution/'+file+' ')).join('');
assert.strictEqual(otherDiff(cp.execFileSync('git',['diff','--binary'],{encoding:'utf8'})),otherDiff(fs.readFileSync('.pi/temp/process-test-scope.worktree.before.diff','utf8')));
console.log('PASS: unrelated user unstaged diffs byte-for-byte preserved.');
