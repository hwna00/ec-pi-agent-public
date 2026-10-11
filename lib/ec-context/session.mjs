import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export function sessionDirectory(ctx) {
  const file=ctx.sessionManager.getSessionFile();if(!file)throw new Error('저장된 Pi 세션이 필요합니다.');
  return join(basename(file)==='session.jsonl'?dirname(file):join(dirname(file),basename(file,'.jsonl')),'context-graph');
}
export function readJSON(path,fallback=null){return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):fallback;}
export function privateJSON(path,data){mkdirSync(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});renameSync(tmp,path);chmodSync(path,0o600);}
export function activeDirectory(root){const active=readJSON(join(root,'active.json'));if(active){if(!/^[a-zA-Z0-9-]+$/.test(active.snapshot))throw new Error('Invalid context snapshot');return join(root,'snapshots',active.snapshot);}return root;}
export function parseReference(args){const v=args.trim().replace(/\s+(\d+)$/,':$1').toLowerCase();const aliases={'작업':'job','개발':'dev','테스트오류수정':'tp','test progress':'tp','테스트/배포':'dp','개발본부 hub':'hub','방향결정':'decision','회의':'meeting'};const m=v.match(/^(.+):(\d+)$/);if(!m||Number(m[2])<1)throw new Error('/load-context tp:12345 또는 /load-context tp 12345');const type=aliases[m[1]]||m[1];if(!['tp','hub','dev','dp','job','decision','meeting'].includes(type))throw new Error('지원하지 않는 게시판 종류');return `${type}:${m[2]}`;}
export function testURL(server){const host=server.trim().toLowerCase().replace(/\.ecount\.com$/,'');if(!/^(?:test|zeus|stage)[a-z0-9-]*$/.test(host))throw new Error('test / zeus / stage 계열 서버 이름을 입력하세요.');return `https://${host}.ecount.com/`;}
export async function completeTarget(candidate,ui){const result={...candidate};for(const [key,label] of [['server','테스트 서버 (예: zeus07lxba1, stage, test)'],['company','테스트 회사코드'],['user','테스트 사용자 ID'],['password','테스트 계정 비밀번호']]) {if(!result[key]){const value=await ui.input(label);if(value===undefined||!value.trim())throw new Error('테스트 서버 입력이 취소되었습니다.');result[key]=key==='password'?value:value.trim();}}testURL(result.server);return result;}

export function askSecret(ui, label='테스트 계정 비밀번호') {
  return ui.custom((_tui,_theme,_keys,done)=>{
    let value='';
    return {render:width=>[label, '•'.repeat([...value].length).slice(-Math.max(1,width)), 'Enter: 확인 · Esc: 취소'],invalidate(){},handleInput(data){
      if(data==='\r'||data==='\n')return done(value);
      if(data==='\x1b'||data==='\x03')return done(undefined);
      if(data==='\x7f'||data==='\b'){value=[...value].slice(0,-1).join('');_tui?.requestRender();return;}
      const pasted=data.replace(/\x1b\[200~|\x1b\[201~/g,'');
      if(!/[\x00-\x1f\x7f]/.test(pasted))value+=pasted;
      _tui?.requestRender();
    }};
  });
}
