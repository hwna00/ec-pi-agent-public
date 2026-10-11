// Optional adapter for an already logged-in Chromium exposed on loopback CDP.
// Reads rendered DOM only. No navigation, reload, or mutation.
const endpoint = new URL(process.argv[2] || 'http://127.0.0.1:9222');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP must be loopback');
const tabs = await (await fetch(new URL('/json/list', endpoint), {signal: AbortSignal.timeout(5000)})).json();
const candidates = tabs.filter(t => t.type === 'page' && /^https:\/\/[\w-]+\.ecount\.com\//.test(t.url));
if (candidates.length !== 1) throw new Error('Expected one ERP tab; close ambiguous ERP tabs');
const tab = candidates[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
const result = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);
  ws.addEventListener('error', () => {clearTimeout(timeout); reject(new Error('CDP connection failed'));});
  ws.addEventListener('open', () => ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'JSON.stringify({text:document.body.innerText})',returnByValue:true}})));
  ws.addEventListener('message', event => {
    const msg=JSON.parse(String(event.data));
    if (msg.id!==1) return;
    clearTimeout(timeout);ws.close();
    if (msg.error || msg.result.exceptionDetails) reject(new Error('Cannot read current DOM'));
    else resolve(msg.result.result.value);
  });
});
process.stdout.write(result);
