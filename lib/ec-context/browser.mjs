import { MCP, serverSpec, resultText, resultJSON } from './mcp.mjs';
export function withDisableMin(value) {
  const url=new URL(value);
  const loginPage=url.pathname==='/' || /(?:^|\/)(?:login|signin)(?:[./_]|$)|\/app\.login(?:\/|$)/i.test(url.pathname);
  if(loginPage)url.searchParams.delete('__disableMin');
  else url.searchParams.set('__disableMin','Y');
  return url.href;
}
export const LOGIN_URL=withDisableMin('https://login.ecount.com/');
export function erpURL(value) {
  try {const u=new URL(value);return u.protocol==='https:' && /^[a-z0-9-]+\.ecount\.com$/i.test(u.hostname) && /^\/ec(?:5|56)\/view\//.test(u.pathname) && !!u.searchParams.get('ec_req_sid');} catch{return false;}
}
export function parsePages(provider,text) {
  if(provider==='chrome')return text.split('\n').flatMap(line=>{const m=line.match(/^(\d+):\s+(.*)/);if(!m)return [];const url=m[2].match(/(?:https?:\/\/[^\s)]+|about:blank)/)?.[0];return url?[{id:Number(m[1]),url,...(/\[selected\]/.test(line)?{selected:true}:{})}]:[];});
  return text.split('\n').flatMap(line=>{const m=line.match(/^-\s*(\d+):\s*(?:\(current\)\s*)?\[(.*?)\]\((https?:\/\/[^\s]+|about:blank)\)\s*$/);return m?[{id:Number(m[1]),title:m[2],url:m[3],...(/\(current\)/.test(line)?{selected:true}:{})}]:[];});
}
export class Browser {
  constructor(mcp) {this.mcp=mcp;this.provider=mcp.spec.provider;this.id=mcp.spec.id;}
  async pages() {
    if(this.mcp.spec.reuseExisting && !this.bound) {
      const result=await this.mcp.use();
      this.savedPageId=result.savedPageFound ? result.pages.find(p=>p.selected)?.pageId : undefined;
      this.bound=true;
    }
    const result=await this.mcp.call(this.provider==='chrome'?'list_pages':'browser_tabs',this.provider==='chrome'?{}:{action:'list'});
    return result.structuredContent?.pages?.map(p=>({id:p.id,url:p.url,title:p.title,selected:p.selected ?? p.isSelected})) || parsePages(this.provider,resultText(result));}
  async select(id) {await this.mcp.call(this.provider==='chrome'?'select_page':'browser_tabs',this.provider==='chrome'?{pageId:id}:{action:'select',index:id});}
  async evaluate(fn) {return resultJSON(await this.mcp.call(this.provider==='chrome'?'evaluate_script':'browser_evaluate',{function:fn}));}
  async ensureDisableMin(state) {
    state ||= await this.evaluate('() => ({url:location.href})');
    for(let attempt=0;attempt<3;attempt++) {
      const url=new URL(state.url);
      if(url.protocol!=='https:' || !/^[a-z0-9-]+\.ecount\.com$/i.test(url.hostname))throw new Error('이카운트 페이지가 아닌 주소로 이동했습니다.');
      const target=withDisableMin(url.href);
      if(target===url.href)return state;
      await this.mcp.call(this.provider==='chrome'?'navigate_page':'browser_navigate',this.provider==='chrome'?{type:'url',url:target}:{url:target});
      state=await this.evaluate('() => ({url:location.href})');
    }
    throw new Error('리다이렉트 후 로그인/ERP URL 설정을 유지하지 못했습니다.');
  }
  async open(url) {
    url=withDisableMin(url);
    if(this.provider==='chrome')await this.mcp.call('new_page',{url});
    else {await this.mcp.call('browser_tabs',{action:'new'});await this.mcp.call('browser_navigate',{url});}
    return this.ensureDisableMin();
  }
  async connect(page) {
    await this.select(page.id);
    let state=await this.evaluate('() => ({url:location.href,title:document.title})');
    if(!erpURL(state.url))throw new Error('로그인된 ERP 탭이 아닙니다. 로그인 후 /ec-connect를 다시 실행하세요.');
    state=await this.ensureDisableMin(state);
    if(!erpURL(state.url))throw new Error('페이지를 다시 연 뒤 로그인이 필요합니다.');
    if(this.mcp.spec.reuseExisting)await this.mcp.remember(page.id);
    this.pageId=page.id;this.origin=new URL(state.url).origin;this.sid=new URL(state.url).searchParams.get('ec_req_sid');
    return {host:new URL(this.origin).hostname};
  }
  async fetch(path,payload) {
    if(!/^\/ec5\/api(?:\.bulk)?\/[A-Za-z0-9_./:-]+$/.test(path))throw new Error('허용되지 않은 API 경로');
    await this.select(this.pageId);
    // ECOUNT overrides Array.prototype.toJSON; serialize outside the page realm.
    const request={origin:this.origin,sid:this.sid,path,body:JSON.stringify(payload)};
    return this.evaluate(`async () => {
      const r=${JSON.stringify(request)};const u=new URL(location.href);
      if(u.origin!==r.origin || u.searchParams.get('ec_req_sid')!==r.sid) return {error:'session_changed'};
      const endpoint=new URL(r.path,u.origin);endpoint.searchParams.set('ec_req_sid',r.sid);endpoint.searchParams.set('__disableMin','Y');
      try {const response=await fetch(endpoint,{method:'POST',credentials:'include',redirect:'error',headers:{'Content-Type':'application/json','Accept':'application/json','Accept-Language':'ko'},body:r.body,signal:AbortSignal.timeout(60000)});
        return {status:response.status,body:await response.text()};
      }catch{return {error:'browser_request_failed'};}
    }`);
  }
  async resend(reqid){if(!this.pageId)throw new Error('Connect a page first');await this.select(this.pageId);return this.mcp.call('resend_network_request',{reqid});}
  async close(){await this.mcp.close();}
}
export class BrowserPool {
  constructor(specs=[serverSpec('chrome',{sessionId:'default'})],factory=async spec=>new Browser(await new MCP(spec).start())) {this.specs=specs;this.factory=factory;this.browsers=[];this.closed=false;}
  async discover() {
    if(this.closed)throw new Error('브라우저 연결이 종료되었습니다.');
    const candidates=[];this.failures=[];
    for(const spec of this.specs) {
      let browser=this.browsers.find(b=>b.id===spec.id);
      try {
        if(!browser){browser=await this.factory(spec);if(this.closed){await browser.close();return [];}this.browsers.push(browser);}
        for(const page of await browser.pages())if(erpURL(page.url))candidates.push({browser,page,label:`${spec.id} · 탭 ${page.id} · ${new URL(page.url).hostname}${page.title?' · '+page.title:''}`});
      }catch {this.failures.push(spec.id);if(browser){await browser.close();this.browsers=this.browsers.filter(b=>b!==browser);}}
    }
    return candidates;
  }
  async openLogin() {
    if(this.closed)throw new Error('브라우저 연결이 종료되었습니다.');
    let b=this.browsers[0];
    if(!b && this.specs.some(s=>s.reuseExisting))throw new Error('기존 Chrome에 연결할 수 없습니다. 원격 디버깅 연결을 허용하거나 resend_poc_browser_session create로 브라우저를 명시적으로 생성하세요.');
    if(!b){b=await this.factory(serverSpec('playwright'));if(this.closed){await b.close();throw new Error('브라우저 연결이 종료되었습니다.');}this.browsers.push(b);this.specs.push(b.mcp.spec);}
    await b.open(LOGIN_URL);return b;
  }
  async close(){this.closed=true;await Promise.allSettled(this.browsers.map(b=>b.close()));this.browsers=[];}
}
