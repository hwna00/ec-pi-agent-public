import { erpURL } from './browser.mjs';

export async function loginAccount(cached, ui) {
  const account={...cached};
  for(const [key,label] of [['company','이카운트 회사코드'],['user','이카운트 사용자 ID'],['password','이카운트 비밀번호']]) {
    if(account[key])continue;
    const value=await ui.input(label,key==='password');
    if(value===undefined || !value.trim())return null;
    account[key]=key==='password'?value:value.trim();
  }
  return account;
}

// Credentials travel directly to the selected MCP, never through agent messages.
export async function loginERP(browser, account, {signal, attempts=60, interval=500}={}) {
  signal?.throwIfAborted();
  const current=await browser.evaluate('() => ({url:location.href})');
  const pages=await browser.pages();
  const matching=pages.filter(page=>page.url===current.url);
  const selected=matching.find(page=>page.selected) || (matching.length===1?matching[0]:undefined);
  if(!selected)throw new Error('로그인 대상 탭을 확인하지 못했습니다. /ec-connect를 다시 실행하세요.');
  const submitted=await browser.evaluate(`() => {
    if(location.protocol!=='https:' || !['login.ecount.com','logine.ecount.com'].includes(location.hostname))return {state:'unexpected_origin'};
    const visible=e=>e.getClientRects().length&&!e.disabled;
    const inputs=[...document.querySelectorAll('input')].filter(visible);
    const find=names=>inputs.find(e=>names.includes((e.id||'').toLowerCase())||names.includes((e.name||'').toLowerCase()));
    const company=find(['com_code','comcode','company','company_code','companycode','txtcomcode']);
    const user=find(['id','user_id','userid','username','txtuserid']);
    const password=inputs.find(e=>e.type==='password');
    if(!company||!user||!password)return {state:'form_missing'};
    const buttons=[...document.querySelectorAll('button,input[type=submit],a')].filter(visible);
    const submit=buttons.find(e=>/^(로그인|log\\s*in|sign\\s*in)$/i.test((e.innerText||e.value||'').trim()))||buttons.find(e=>e.type==='submit');
    if(!submit)return {state:'submit_missing'};
    const account=${JSON.stringify(account)};
    const set=(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    set(company,account.company);set(user,account.user);set(password,account.password);
    submit.click();return {state:'submitted'};
  }`);
  if(submitted.state!=='submitted')throw new Error(`자동 로그인 폼을 확인하지 못했습니다 (${submitted.state}). 열린 탭에서 로그인 후 /ec-connect를 실행하세요.`);
  // Submit once only: retries could lock an account or repeat MFA requests.
  for(let i=0;i<attempts;i++) {
    signal?.throwIfAborted();
    for(const page of await browser.pages())if(page.id===selected.id && erpURL(page.url))return page;
    await new Promise(resolve=>setTimeout(resolve,interval));
  }
  throw new Error('로그인 완료를 확인하지 못했습니다. 열린 탭에서 오류 또는 추가 인증을 확인한 뒤 /ec-connect를 실행하세요. 계정을 다시 입력하려면 /ec-connect --edit를 사용하세요.');
}
