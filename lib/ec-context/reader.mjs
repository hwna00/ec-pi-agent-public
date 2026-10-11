import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { piRoot } from './mcp.mjs';
export function runReader(dir,args,browser,options={}) {
  return new Promise((resolvePromise,reject)=>{
    const signal=options.signal;
    const cancelled=()=>Object.assign(new Error('컨텍스트 수집이 취소되었습니다.'),{name:'AbortError'});
    if(signal?.aborted){reject(cancelled());return;}
    const child=spawn(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),[resolve(piRoot,'poc/board-reader/context_cli.py'),'--session-dir',dir,...(browser?['--browser-stdio','--recursive']:[]),...args],{env:{...process.env,ECOUNT_SESSION_JSON:''},stdio:['pipe','pipe','pipe'],windowsHide:true});
    let result=[],chain=Promise.resolve(),failed=false;
    const onAbort=()=>{failed=true;child.kill();};
    signal?.addEventListener('abort',onAbort,{once:true});
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
    const timer=setTimeout(()=>{failed=true;child.kill();reject(new Error('컨텍스트 수집 제한 시간 초과. 기존 컨텍스트는 유지됩니다.'));},options.timeout||15*60*1000);
    child.stderr.resume();
    child.stdin.on("error",()=>{});
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      let obj;try{obj=JSON.parse(line);}catch{}
      if(obj?.rpc==='ec-api') {
        chain=chain.then(async()=>{
          if(failed||signal?.aborted)return;
          let response;try{response=await browser.fetch(obj.path,obj.payload);}catch{response={error:'browser_unavailable'};}
          if(!failed&&!signal?.aborted&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(response)+'\n');
        });
      }else result.push(line);
    });
    child.on('error',error=>{cleanup();reject(error);});
    child.on('close',code=>{cleanup();if(failed){if(signal?.aborted)reject(cancelled());return;}const output=result.join('\n');if(code===0)resolvePromise(output);else {let error;try{error=JSON.parse(output);}catch{}reject(new Error(error?`${error.code}: ${error.error}${error.post?' ('+error.post+')':''}`:`Reader exited ${code}`));}});
    if(browser)child.stdin.write(JSON.stringify({host:new URL(browser.origin).hostname})+'\n');else child.stdin.end();
  });
}
