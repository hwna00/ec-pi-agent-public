const fs = require('fs');
const ts = require('typescript');
const assert = require('assert');
const file = '@source/server/@test-modules/modules/definition.@test/src/model_customizer/process_definition.spec.ts';
const before = fs.readFileSync('.pi/temp/process-test-readability.before.ts', 'utf8');
let after = fs.readFileSync(file, 'utf8');
if (before.includes('\r\n')) { after = after.replace(/\r?\n/g, '\r\n'); fs.writeFileSync(file, after); }
const parse = s => ts.createSourceFile(file, s, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter({removeComments: true});
const b = parse(before), a = parse(after);
const print = (n, sf) => printer.printNode(ts.EmitHint.Unspecified, n, sf);
const functions = sf => sf.statements.filter(ts.isFunctionDeclaration).map(n => print(n, sf));
const nonFunctions = sf => sf.statements.filter(n => !ts.isFunctionDeclaration(n)).map(n => print(n, sf));
assert.deepStrictEqual(functions(a), functions(b));
assert.deepStrictEqual(nonFunctions(a), nonFunctions(b));
console.log('PASS: all function declarations and ordered executable/type/import statements match baseline after removing comments/formatting.');
const beforeTests = [], afterTests = [];
function collect(sf, target) { function visit(n) { if (ts.isCallExpression(n) && n.expression.getText(sf) === 'test') target.push(print(n, sf)); ts.forEachChild(n, visit); } visit(sf); }
collect(b, beforeTests); collect(a, afterTests);
assert.deepStrictEqual(afterTests, beforeTests);
assert.strictEqual(afterTests.length, 2);
assert(after.includes("const MODEL_IDS = ['bankXprocess', 'bankXprocess_search']"));
console.log('PASS: 2 identical registration sites; MODEL_IDS(2) + independent test(1) = 3 tests, unchanged labels/assertions/controls/fixture paths.');
assert(a.statements.findIndex(ts.isForStatement) < a.statements.findIndex(ts.isFunctionDeclaration));
console.log('PASS: tests precede helpers; constants initialized first, all helpers remain hoisted function declarations.');
console.log('Baseline CRLF:', before.includes('\r\n'), 'Updated CRLF:', after.includes('\r\n'));
