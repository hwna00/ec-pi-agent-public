const fs = require('fs');
const path = require('path');
const root = process.cwd();
const base = path.join(root, '@dev/@test/application/browser_test');
const puppeteer = require(require.resolve('puppeteer', {paths:[base]}));
const services = require(path.join(base,'bin/services'));
const tag = process.argv[2] || 'run';
const out = path.join(root,'.pi/artifacts/collect-source-notice');
const clean = text => String(text).replace(/https?:\/\/[^\s"')]+/g, value => {try {const u=new URL(value); return u.origin+u.pathname;}catch{return '[URL]';}});
(async()=>{
 const events=[]; let browser;
 const log=(type,data)=>events.push({type,data:clean(data)});
 try {
  const file = new services.FileService();
  const scanner = new services.TestScannerService(file);
  await scanner.scanTestDirectoies();
  const selected = scanner.targetTests.filter(x=>x.moduleName==='v56app.@test');
  fs.writeFileSync(path.join(out,tag+'-scope.json'),JSON.stringify({selected,excluded:scanner.targetTests.filter(x=>x.moduleName!=='v56app.@test').map(x=>x.moduleName)},null,2));
  if(selected.length!==1) throw Error('Target module missing');
  const config=JSON.parse(fs.readFileSync('@dev/@test/test.config.json','utf8'));
  browser=await puppeteer.launch({headless:true,executablePath:config.application_config.browser.puppeteer.executablePath,args:['--ignore-certificate-errors'],defaultViewport:{width:1400,height:1000}});
  const page=await browser.newPage();
  page.on('console',m=>{if (!['log','info','debug'].includes(m.type()) || /Test|test|모듈|로드|Loaded|RESULT|Passed|Failed/.test(m.text())) log('console:'+m.type(),m.text());});
  page.on('pageerror',e=>log('pageerror',e.stack));
  page.on('requestfailed',r=>log('requestfailed',r.url()+' '+r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)log('response',r.status()+' '+r.url());});
  const network=new services.NetworkMockService(file,new services.SourceMapService(file),selected,config);
  await network.setupRequestInterception(page);
  await page.goto('https://test.ecount.com:5001/ec5/static/ecountv56/modules/test/test-launcher.html?modules=v56app.@test',{waitUntil:'domcontentloaded',timeout:60000});
  try {await page.waitForFunction(()=>window.$TestApplication?.uiManager?.testCases?.length>0,{timeout:30000});}catch(e){log('wait',e.message);}
  const state=await page.evaluate(()=>({ready:!!window.$TestApplication?.uiManager,tests:window.$TestApplication?.uiManager?.testCases?.map(t=>({testId:t.testId,title:t.title,executionStatus:t.executionStatus})),text:document.getElementById('test-container')?.innerText?.slice(0,12000),app:!!window.__test_app}));
  fs.writeFileSync(path.join(out,tag+'-ui.json'),JSON.stringify(state,null,2));
  if(state.tests?.length){
   const targets=state.tests.filter(t=>/ICollectSourceNoticePage converter parameters|OpenCollectSourceNoticeUserAction opens the notice popup/.test(t.title));
   if(targets.length!==2)throw Error('Expected two target tests, got '+targets.length);
   for(const t of targets)await page.evaluate(async id=>{await window.$TestApplication.runTests({testId:id});},t.testId);
   const results=await page.evaluate(ids=>ids.map(id=>window.$TestApplication.uiManager.getTestCase(id)),targets.map(t=>t.testId));
   fs.writeFileSync(path.join(out,tag+'-results.json'),JSON.stringify(results,null,2));
   if(results.some(t=>t.executionStatus!=='passed')) process.exitCode=1;
  }else process.exitCode=1;
  await page.screenshot({path:path.join(out,tag+'.png'),fullPage:true});
 }catch(e){log('fatal',e.stack);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,tag+'-events.json'),JSON.stringify(events,null,2));if(browser)await browser.close();}
})();
