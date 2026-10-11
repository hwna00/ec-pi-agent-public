const fs = require('node:fs');
const path = require('node:path');
const prettier = require(require.resolve('prettier', { paths: ['./@dev/@config-eslint'] }));
const config = require('../@dev/@config-eslint/.prettierrc.base.js');
const dir = '@source/browser/modules/common/src/@user_action/bank_account_inquiry';
const files = fs.readdirSync(dir).filter((file) => file.endsWith('.ts')).map((file) => path.join(dir, file)).concat([
	'@source/browser/modules/common/src/feature/BankAccountInquiryUtilFeature.ts',
	'@source/browser/modules/common.abstraction/src/@type/types/feature/IBankAccountInquiryUtilFeature.ts',
	'@source/browser/modules/common.abstraction/src/@type/types/page/IBankAccountInquiryPage.ts',
	'@source/browser/modules/common.abstraction/src/@type/types/user_action/IBankAccountInquiryUserActions.ts',
	'@source/browser/ecount/@applications/v56app/src/feature/ui/v3_popup_converter/BankAccountInquiryPages.ts',
	'@dev/@test/browser/modules/common/bank_account_inquiry.test.cjs',
]);
for (const file of files) fs.writeFileSync(file, prettier.format(fs.readFileSync(file, 'utf8'), { ...config, filepath: file }));
console.log(`Formatted ${files.length} task files.`);
