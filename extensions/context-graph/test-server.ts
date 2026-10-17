import { testURL } from "./session.ts";
// Inspect the actual form on each navigation. Never interpolate values into selectors.
export async function openTestServer(
  browser,
  target,
  hooks: {
    onOpening?: () => Promise<void>;
    onOpened?: () => Promise<void>;
  } = {},
) {
  const url = testURL(target.server),
    environment = new URL(url).hostname
      .match(/^(test|zeus|stage)/i)![1]
      .toLowerCase();
  if (target.environment && target.environment !== environment)
    throw new Error(
      "선택한 환경과 상세 서버명이 일치하지 않습니다. --edit로 서버명을 수정하세요.",
    );
  await hooks.onOpening?.();
  await browser.open(url);
  await hooks.onOpened?.();
  const account = {
    company: target.company,
    user: target.user,
    password: target.password,
    server: target.server,
  };
  const status = await browser.evaluate(`() => {
    const account=${JSON.stringify(account)};
    if(location.hostname!==${JSON.stringify(new URL(url).hostname)})return {state:"unexpected_origin"};
    const visible=e=>e && e.getClientRects().length && !e.disabled;
    const fields=[...document.querySelectorAll('input,select')].filter(visible);
    const find=names=>fields.find(e=>names.includes((e.name||'').toLowerCase())||names.includes((e.id||'').toLowerCase()));
    const company=find(['com_code','comcode','company','company_code','companycode','txtcomcode']);
    const user=find(['id','user_id','userid','username','txtuserid']);
    const password=fields.find(e=>e.type==='password');
    if(!company||!user||!password)return {state:'form_missing'};
    const server=find(['server','server_name','servername','test_server','testserver']);
    const set=(e,value)=>{if(e.tagName==='SELECT' && ![...e.options].some(o=>o.value===value))return false;
      const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;};
    if(server&&!set(server,account.server))return {state:'server_option_missing'};
    set(company,account.company);set(user,account.user);set(password,account.password);
    const form=company.closest('form')||document;
    const buttons=[...form.querySelectorAll('button,input[type=submit],a')].filter(visible);
    const submit=buttons.find(e=>/^(로그인|log\\s*in|sign\\s*in)$/i.test((e.innerText||e.value||'').trim()))||buttons.find(e=>e.type==='submit');
    if(!submit)return {state:'submit_missing'};
    submit.click();return {state:'submitted'};
  }`);
  if (status.state !== "submitted")
    throw new Error(
      `테스트 페이지를 열었지만 로그인 폼 확인이 필요합니다 (${status.state}).`,
    );
  // Submission and successful authentication are different states.
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const state = await browser.evaluate(
        `() => ({ok:/^\\/ec(?:5|56)\\/view\\//.test(location.pathname)&&!!new URL(location.href).searchParams.get('ec_req_sid'),disabled:new URL(location.href).searchParams.get('__disableMin')==='Y'})`,
      );
      if (state.ok && state.disabled)
        return { state: "authenticated", environment, server: target.server };
      if (state.ok)
        await browser.evaluate(
          "() => {const u=new URL(location.href);u.searchParams.set('__disableMin','Y');location.replace(u);return true;}",
        );
    } catch {}
  }
  throw new Error(
    "로그인 제출 후 성공을 확인하지 못했습니다. 열린 탭의 오류 또는 추가 인증을 확인하세요.",
  );
}
