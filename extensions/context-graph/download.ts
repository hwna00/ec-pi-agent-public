import type { DownloadOptions } from "./types.ts";
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class DownloadError extends Error {
  code: string;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new DownloadError(code, message);
};
const querySecrets = new Set([
  "ec_req_sid",
  "__disablemin",
  "token",
  "access_token",
  "session",
  "sessionid",
  "session_id",
  "key",
  "timestamp",
  "v5q",
  "options",
  "xce",
]);

export function isECDriveAttachment(file) {
  return (
    file.storage === "ecdrive" ||
    String(file.link_type) === "98" ||
    String(file.provider_seq) === "98" ||
    file.bizz_sid === "B_000000E077100" ||
    file.to_bizz_sid === "B_000000E077100"
  );
}
export function ecDriveOID(file): string | undefined {
  const oid =
    file.oid ??
    file.oID ??
    file.attach_id ??
    (file.storage === "ecdrive" ? file.id : undefined);
  return typeof oid === "string" && oid.trim() ? oid : undefined;
}
export function attachmentIdentity(file) {
  if (isECDriveAttachment(file)) {
    const oid = ecDriveOID(file);
    return oid === undefined
      ? undefined
      : JSON.stringify([
          "ecdrive",
          oid,
          String(file.version ?? file.VERSION ?? ""),
        ]);
  }
  const id = file.file_id ?? file.id;
  return id == null
    ? undefined
    : JSON.stringify([
        String(id),
        String(file.owner_key || ""),
        String(file.account || ""),
      ]);
}

// Preserve observed download requests in memory; source captures contain clean URLs.
export function captureFileURLs(
  value,
  urls,
  base,
  file = false,
  inline = false,
) {
  if (Array.isArray(value))
    return value.map((item) => captureFileURLs(item, urls, base, file, inline));
  if (!value || typeof value !== "object") return value;
  if (
    file ||
    (inline &&
      (value.file_id || isECDriveAttachment(value)) &&
      !value.BOARD_NUM &&
      !value.data_no &&
      (value.name || value.attach_name || value.file_name))
  ) {
    const identity = attachmentIdentity(value);
    const fields = ["download_url", "downloadUrl", "url"].filter(
      (field) => typeof value[field] === "string" && value[field],
    );
    for (const [index, field] of fields.entries()) {
      try {
        const actual = new URL(value[field], base);
        if (identity && index === 0) urls.set(identity, actual.href);
        for (const key of [...actual.searchParams.keys()])
          if (querySecrets.has(key.toLowerCase()))
            actual.searchParams.delete(key);
        if (actual.hash.includes("=")) {
          const fragment = new URLSearchParams(actual.hash.slice(1));
          for (const key of [...fragment.keys()])
            if (querySecrets.has(key.toLowerCase())) fragment.delete(key);
          actual.hash = fragment.toString();
        }
        actual.username = "";
        actual.password = "";
        value[field] = actual.href;
      } catch {}
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const attachments =
      inline || key === "attached_list" || /(?:^|\$)slip_link$/.test(key);
    if (attachments && typeof child === "string" && /^[\s]*[\[{]/.test(child)) {
      try {
        value[key] = JSON.stringify(
          captureFileURLs(
            JSON.parse(child),
            urls,
            base,
            key === "file_info_list",
            true,
          ),
        );
      } catch {}
    } else
      value[key] = captureFileURLs(
        child,
        urls,
        base,
        key === "file_info_list",
        attachments,
      );
  }
  return value;
}

export async function atomicDownload(
  targetPath,
  receive,
  expectedSize,
  signal,
) {
  signal?.throwIfAborted();
  const target = resolve(targetPath);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(dirname(target), ".download-"));
  const temporary = join(directory, randomUUID());
  try {
    await receive(temporary, directory);
    signal?.throwIfAborted();
    const { size } = await fs.stat(temporary);
    if (expectedSize != null && Number(expectedSize) !== size)
      fail("download_size_mismatch", "첨부 파일 크기가 원본과 다릅니다.");
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, target);
    return { status: "downloaded", size };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

// Only an explicit URL from attachment metadata is accepted; no endpoint is guessed.
export async function downloadURL(
  browser,
  file,
  targetPath,
  { signal }: DownloadOptions = {},
) {
  signal?.throwIfAborted();
  let url;
  try {
    url = new URL(file.url, browser.origin);
  } catch {}
  if (
    !url ||
    url.protocol !== "https:" ||
    !/^(?:[a-z0-9-]+\.)?ecount\.com$/i.test(url.hostname) ||
    url.username ||
    url.password
  )
    fail("download_url_invalid", "확인된 이카운트 첨부 파일 URL이 필요합니다.");
  return streamDownload(
    browser,
    file,
    targetPath,
    { signal },
    { url: url.href },
  );
}

// Follow the ERP's ECDrive flow. Tokens and signed URLs stay in the page realm.
export async function downloadECDrive(
  browser,
  file,
  targetPath,
  options: DownloadOptions = {},
) {
  options.signal?.throwIfAborted();
  const oid = ecDriveOID(file);
  if (
    !isECDriveAttachment(file) ||
    !oid ||
    !file.name ||
    !file.sourceBizzSid ||
    !file.sourceMenuSid
  )
    fail(
      "ecdrive_metadata_invalid",
      "ECDrive 파일과 원본 게시글의 식별 정보가 필요합니다.",
    );
  return streamDownload(browser, file, targetPath, options, {
    ecdrive: {
      oid,
      name: file.name,
      size: file.size,
      version: file.version,
      dataSid: file.dataSid,
      bizzSid: file.sourceBizzSid,
      menuSid: file.sourceMenuSid,
    },
  });
}

async function streamDownload(
  browser,
  file,
  targetPath,
  { signal, timeout = 120000 }: DownloadOptions,
  source,
) {
  signal?.throwIfAborted();
  const marker = `ec-download-${randomUUID()}`;
  const request = {
    origin: browser.origin,
    sid: browser.sid,
    ...source,
    marker,
    timeout,
  };
  const started = await browser.evaluate(`async () => {
    const r=${JSON.stringify(request)},u=new URL(location.href);
    if(u.origin!==r.origin || u.searchParams.get('ec_req_sid')!==r.sid) return {error:'session_changed'};
    try {
      let url=r.url;
      if(r.ecdrive) {
        const f=r.ecdrive, runtime=globalThis.$ECount, common=globalThis.ecount?.common;
        if(typeof runtime?.apiAsync!=='function' || typeof common?.api!=='function') return {error:'ecdrive_api_unavailable'};
        const bounded=async (operation,code) => {
          let timer;
          try {return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),r.timeout);})]);}
          finally {clearTimeout(timer);}
        };
        try {
          await bounded(runtime.apiAsync({
            version:'V5', method:'POST', credentials:'include',
            url:'/api/app.common/action/CheckFileSecurityAction:board:view',
            data:{type:'download',file_info:[{name:f.name,size:f.size,owner_key:f.oid,ecdrive_file_yn:'Y',data_sid:f.dataSid}],ec_page_id:r.marker.slice('ec-download-'.length),max_file_size:0,bizz_sid:f.bizzSid,menu_sid:f.menuSid},
            onError:()=>{},
          }), 'ecdrive_security_timeout');
        } catch {return {error:'ecdrive_security_failed'};}
        const api=(path,data,code)=>bounded(new Promise((resolve,reject)=>{
          common.api({url:path,data,success:result=>{
            if(!result || (result.Status!==undefined && Number(result.Status)!==200)) reject(new Error(code));
            else resolve(result);
          },error:()=>reject(new Error(code))});
        }),code);
        let auth,descriptor;
        try {auth=await api('/SVC/Groupware/ECDrive/AuthToken',{ACTION:'FILEDOWNLOAD',DATA:JSON.stringify({VERSION:f.version,OID:f.oid,NAME:f.name})},'ecdrive_auth_failed');}
        catch {return {error:'ecdrive_auth_failed'};}
        if(typeof auth.Data?.AUTHTOKEN!=='string' || !auth.Data.AUTHTOKEN) return {error:'ecdrive_auth_invalid'};
        try {descriptor=await api('/SVC/Groupware/ECDrive/ExternalTask',{TOKEN:auth.Data.AUTHTOKEN},'ecdrive_file_info_failed');}
        catch {return {error:'ecdrive_file_info_failed'};}
        try {
          const resolved=new URL(descriptor.Data?.URL);
          if(resolved.protocol!=='https:' || resolved.username || resolved.password) return {error:'ecdrive_url_invalid'};
          url=resolved.href;
        }catch{return {error:'ecdrive_url_invalid'};}
        const current=new URL(location.href);
        if(current.origin!==r.origin || current.searchParams.get('ec_req_sid')!==r.sid) return {error:'session_changed'};
      }
      const response=await fetch(url,{credentials:'include',redirect:r.ecdrive?'follow':'error',signal:AbortSignal.timeout(r.timeout)});
      if(!response.ok) return {error:'download_http_error',status:response.status};
      if(!response.body) return {error:'download_empty_response'};
      const type=response.headers.get('content-type') || '';
      if(type.includes('text/html') && !${JSON.stringify(/\.html?$/i.test(file.name || ""))}) return {error:'download_html_response'};
      Object.defineProperty(globalThis,r.marker,{value:{reader:response.body.getReader(),buffer:new Uint8Array(),offset:0,done:false},configurable:true});
      return {ok:true};
    } catch { return {error:'download_request_failed'}; }
  }`);
  if (!started.ok)
    fail(
      started.error || "download_request_failed",
      "첨부 파일 요청에 실패했습니다.",
    );
  try {
    signal?.throwIfAborted();
    return await atomicDownload(
      targetPath,
      async (temporary) => {
        const output = await fs.open(temporary, "wx", 0o600);
        try {
          while (true) {
            signal?.throwIfAborted();
            const chunk = await browser.evaluate(`async () => {
            const r=${JSON.stringify(request)},u=new URL(location.href);
            if(u.origin!==r.origin || u.searchParams.get('ec_req_sid')!==r.sid) return {error:'session_changed'};
            const state=globalThis[r.marker];if(!state) return {error:'download_state_missing'};
            try {
              const block=new Uint8Array(131072);let size=0;
              while(size<block.length) {
                if(state.offset===state.buffer.length) {
                  if(state.done) break;
                  const next=await state.reader.read();
                  if(next.done){state.done=true;break;}
                  state.buffer=next.value;state.offset=0;
                }
                const count=Math.min(block.length-size,state.buffer.length-state.offset);
                block.set(state.buffer.subarray(state.offset,state.offset+count),size);
                size+=count;state.offset+=count;
              }
              if(!size && state.done) return {done:true};
              let text='';for(let i=0;i<size;i++) text+=String.fromCharCode(block[i]);
              return {data:btoa(text)};
            } catch { return {error:'download_stream_failed'}; }
          }`);
            if (chunk.error)
              fail(chunk.error, "첨부 파일 전송에 실패했습니다.");
            if (chunk.done) break;
            if (typeof chunk.data !== "string")
              fail(
                "download_stream_invalid",
                "첨부 파일 응답을 해석할 수 없습니다.",
              );
            const data = Buffer.from(chunk.data, "base64");
            let offset = 0;
            while (offset < data.length)
              offset += (await output.write(data, offset)).bytesWritten;
          }
        } finally {
          await output.close();
        }
      },
      file.size,
      signal,
    );
  } finally {
    await browser
      .evaluate(
        `async () => {
      const state=globalThis[${JSON.stringify(marker)}];
      if(state) {try{await state.reader.cancel();}catch{} delete globalThis[${JSON.stringify(marker)}];}
      return null;
    }`,
      )
      .catch(() => {});
  }
}

// The pasted popup HTML exposes file anchors, not file download URLs.
// Select only the exact post popup and an unambiguous file label.
export function attachmentSelector(
  { type, number, name, marker },
  activate = false,
) {
  const labels = {
    job: "작업",
    plan: "기획",
    dev: "개발",
    meeting: "회의",
    decision: "방향결정",
    tp: "테스트오류수정",
    dp: "테스트/배포",
    hub: "개발본부 Hub",
  };
  const visible = (element) => element.getClientRects().length > 0;
  const dialogs = Array.from(
    document.querySelectorAll(".ui-dialog[data-popup-id]"),
  ).filter(visible);
  const posts = dialogs.filter((dialog) => {
    const title = dialog.querySelector(".ui-dialog-title")?.textContent.trim();
    if (title !== `${labels[type]}View`) return false;
    const heading = dialog.querySelector(
      '[data-item-key^="widget_title_boardX"]',
    );
    return heading?.textContent.trim().split("|")[0].trim() === String(number);
  });
  if (posts.length !== 1) return { error: "download_post_not_open" };
  const matches = Array.from(
    posts[0].querySelectorAll(".wrapper-attach-file > li > a"),
  ).filter((anchor) => {
    if (
      !visible(anchor) ||
      anchor.querySelector(".label")?.textContent.trim() !== "파일"
    )
      return false;
    const text = Array.from(anchor.children)
      .find((child) => !child.classList.contains("label"))
      ?.textContent.trim();
    return text === name || text?.replace(/\s+\([^()]+\)$/, "") === name;
  });
  if (matches.length !== 1) return { error: "download_file_not_unique" };
  if (activate) {
    const anchor = document.querySelector<HTMLElement>(
      `[data-ec-download="${marker}"]`,
    );
    if (anchor !== matches[0]) return { error: "download_attachment_changed" };
    anchor.removeAttribute("data-ec-download");
    anchor.click();
  } else matches[0].setAttribute("data-ec-download", marker);
  return { ok: true };
}

export async function downloadNative(
  page,
  file,
  targetPath,
  { signal, timeout = 120000 }: DownloadOptions = {},
) {
  signal?.throwIfAborted();
  const marker = randomUUID();
  const request = {
    type: file.type || file.postKey?.split(":")[0],
    number: file.number || file.postKey?.split(":")[1],
    name: file.name,
    marker,
  };
  const selected = await page.evaluate(attachmentSelector, request);
  if (!selected.ok)
    fail(
      selected.error,
      "현재 게시글 팝업에서 첨부 파일을 확인할 수 없습니다.",
    );
  let target, cdp, guid, info;
  try {
    target = await page.createCDPSession();
    info = (await target.send("Target.getTargetInfo")).targetInfo;
    const frameId = (await target.send("Page.getFrameTree")).frameTree.frame.id;
    cdp = await page.browser().target().createCDPSession();
    return await atomicDownload(
      targetPath,
      async (temporary, directory) => {
        let timer, abort;
        const finished = new Promise<void>((resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DownloadError(
                  "download_timeout",
                  "첨부 파일 다운로드 시간이 초과되었습니다.",
                ),
              ),
            timeout,
          );
          abort = () => reject(signal!.reason);
          signal?.addEventListener("abort", abort, { once: true });
          cdp.on("Browser.downloadWillBegin", (event) => {
            if (event.frameId !== frameId || guid) return;
            guid = event.guid;
            if (event.suggestedFilename !== file.name)
              reject(
                new DownloadError(
                  "download_filename_mismatch",
                  "다운로드 파일명이 첨부 목록과 다릅니다.",
                ),
              );
          });
          cdp.on("Browser.downloadProgress", (event) => {
            if (event.guid !== guid) return;
            if (event.state === "completed") resolve();
            if (event.state === "canceled")
              reject(
                new DownloadError(
                  "download_canceled",
                  "첨부 파일 다운로드가 취소되었습니다.",
                ),
              );
          });
        });
        // Attach a rejection handler before issuing CDP commands.
        finished.catch(() => {});
        try {
          await cdp.send("Browser.setDownloadBehavior", {
            behavior: "allowAndName",
            downloadPath: directory,
            eventsEnabled: true,
            ...(info.browserContextId
              ? { browserContextId: info.browserContextId }
              : {}),
          });
          signal?.throwIfAborted();
          const activated = await page.evaluate(
            attachmentSelector,
            request,
            true,
          );
          if (!activated.ok)
            fail(activated.error, "첨부 파일 표시가 변경되었습니다.");
          await finished;
          await fs.rename(join(directory, guid), temporary);
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        }
      },
      file.size,
      signal,
    );
  } catch (error) {
    if (guid)
      await cdp
        .send("Browser.cancelDownload", {
          guid,
          ...(info.browserContextId
            ? { browserContextId: info.browserContextId }
            : {}),
        })
        .catch(() => {});
    throw error;
  } finally {
    await page
      .evaluate(
        (marker) =>
          document
            .querySelector<HTMLElement>(`[data-ec-download="${marker}"]`)
            ?.removeAttribute("data-ec-download"),
        marker,
      )
      .catch(() => {});
    await cdp
      ?.send("Browser.setDownloadBehavior", {
        behavior: "default",
        eventsEnabled: false,
        ...(info?.browserContextId
          ? { browserContextId: info.browserContextId }
          : {}),
      })
      .catch(() => {});
    await Promise.allSettled([cdp?.detach(), target?.detach()]);
  }
}
