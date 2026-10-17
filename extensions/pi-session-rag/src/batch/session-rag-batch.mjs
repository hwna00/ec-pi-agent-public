import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, lstat, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SessionManager, ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { snapshot, textContent, summarize, renderMarkdown, RunMetrics, SUMMARY_TOOL_NAME,
  outputPath, metricsPath, uploadMetricsPath, saveNewFile, saveNewJson } from '../summary.ts';
import { loadCloudflareConfig, prepareEmbedding, generateEmbedding } from '../embedding.ts';
import { loadMongoConfig, uploadEmbedding } from '../db.ts';

const hash = text => createHash('sha256').update(text).digest('hex');
const modelName = 'openai-codex/gpt-6-luna';
const errorText = error => error instanceof Error ? error.message : String(error);

// Pi의 메모리 전용 로더를 사용해 원본 JSONL을 마이그레이션하거나 쓰지 않는다.
export async function readSession(root, path) {
  const directory = resolve(root, '.pi/sessions');
  const file = resolve(directory, path);
  const actual = await realpath(file);
  const base = await realpath(directory);
  if (!actual.startsWith(base + sep) || !(await lstat(file)).isFile()) {
    throw new Error('세션 경로가 원본 sessions 폴더의 일반 파일이 아닙니다.');
  }
  const raw = await readFile(file, 'utf8');
  const rows = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch { throw new Error(`JSONL ${index + 1}행을 읽지 못했습니다.`); }
  }
  if (rows[0]?.type !== 'session' || typeof rows[0].id !== 'string' || !rows[0].id || rows[0].version !== 3) {
    throw new Error('Pi version 3 세션 헤더가 필요합니다.');
  }
  const entries = rows.slice(1);
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || entry.type === 'session' || typeof entry.id !== 'string' || !entry.id || byId.has(entry.id)) {
      throw new Error('세션 entry ID가 없거나 중복됩니다.');
    }
    byId.set(entry.id, entry);
  }
  const parents = new Set();
  const checked = new Set();
  const warnings = [];
  for (const entry of entries) {
    if (entry.parentId) {
      if (!byId.has(entry.parentId)) warnings.push(`다른 분기의 부모 entry가 누락되었습니다: ${entry.id}`);
      parents.add(entry.parentId);
    }
    const pathIds = new Set();
    let current = entry;
    while (current && !checked.has(current.id)) {
      if (pathIds.has(current.id)) throw new Error('세션 분기에 순환 참조가 있습니다.');
      pathIds.add(current.id);
      current = byId.get(current.parentId);
    }
    for (const id of pathIds) checked.add(id);
  }
  const manager = SessionManager.inMemory(root, undefined, rows);
  const branch = leafId => {
    const entries = manager.getBranch(leafId);
    if (entries[0]?.parentId && !byId.has(entries[0].parentId)) {
      throw new Error('선택한 분기의 부모 entry가 누락되어 전체 대화 경로를 확인하지 못했습니다.');
    }
    return snapshot(entries, { sessionId: manager.getSessionId(), leafId, sourceFile: file });
  };
  const latestLeafId = manager.getLeafId();
  const leaves = entries.filter(entry => !parents.has(entry.id)).map(entry => entry.id);
  const branches = leaves.map(leafId => {
    try {
      const source = branch(leafId);
      return { leafId, turns: source.turns.length, answered: source.turns.filter(turn => turn.answer.trim()).length };
    } catch (error) { return { leafId, turns: 0, answered: 0, error: errorText(error) }; }
  }).filter(item => item.turns > 0 || item.error);
  const firstQuestion = entries.find(entry => entry.type === 'message' && entry.message?.role === 'user');
  const sessionName = manager.getSessionName() ?? null;
  const title = sessionName || textContent(firstQuestion?.message?.content).trim() || '(텍스트 질문 없음)';
  const latest = latestLeafId ? branch(latestLeafId) : null;
  return { file, rawHash: hash(raw), manager, branch, entries, branches, latestLeafId, latest,
    title, sessionName, warnings, createdAt: rows[0].timestamp, sessionId: manager.getSessionId() };
}

export async function scanSessions(root) {
  const directory = join(root, '.pi/sessions');
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.jsonl')) files.push(relative(directory, path));
    }
  }
  await walk(directory);
  const catalog = [];
  for (const path of files) {
    const id = hash(path);
    try {
      const session = await readSession(root, path);
      catalog.push({ id, path, sessionId: session.sessionId, title: session.title, sessionName: session.sessionName,
        warnings: session.warnings, createdAt: session.createdAt,
        fileHash: session.rawHash, latestLeafId: session.latestLeafId, branches: session.branches,
        turns: session.latest?.turns.length ?? 0, error: session.branches.length ? null : '요약할 사용자 발화가 없습니다.' });
    } catch (error) {
      catalog.push({ id, path, title: path, turns: 0, branches: [], error: errorText(error) });
    }
  }
  return catalog.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || a.path.localeCompare(b.path));
}

// 첫 질문에서 만든 표시 제목과 하위 에이전트의 UUID 자동 이름은 선택하지 않는다.
export function selectNamedSessions(catalog, scope = 'latest', limit) {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('세션 개수는 양의 정수여야 합니다.');
  }
  const automatic = /^subagent-[\w-]+-[0-9a-f]{8}(?:(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?-\d+$/i;
  const named = catalog.filter(item => item.sessionName && !automatic.test(item.sessionName))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || a.path.localeCompare(b.path))
    .slice(0, limit);
  const invalid = named.filter(item => item.error || (scope === 'latest' && !item.turns));
  if (invalid.length) throw new Error(`제목을 지정한 세션 ${invalid.length}개를 읽지 못했습니다: ${invalid.map(item => item.path).join(', ')}`);
  return selectSessions(catalog, named.map(item => item.id), scope);
}

export function selectSessions(catalog, ids, scope) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
    throw new Error('중복 없이 한 개 이상의 세션을 선택하세요.');
  }
  if (!['latest', 'all'].includes(scope)) throw new Error('적재할 분기 범위를 선택하세요.');
  const byId = new Map(catalog.map(item => [item.id, item]));
  return ids.map(id => {
    const item = byId.get(id);
    if (!item || item.error) throw new Error('목록에 없거나 읽을 수 없는 세션이 선택되었습니다.');
    const leafIds = scope === 'all' ? item.branches.map(branch => branch.leafId)
      : item.turns ? [item.latestLeafId] : [];
    if (!leafIds.length) throw new Error('선택한 최신 분기에 요약할 사용자 발화가 없습니다. 모든 분기를 선택할 수 있습니다.');
    return { id, path: item.path, sessionId: item.sessionId, title: item.title, fileHash: item.fileHash, leafIds };
  });
}

export async function completeFromPi() {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const registry = new ModelRegistry(runtime);
  const model = registry.find('openai-codex', 'gpt-6-luna');
  if (!model || typeof registry.complete !== 'function') throw new Error('Pi에서 요약 모델 gpt-6-luna를 찾을 수 없습니다.');
  const tool = { name: SUMMARY_TOOL_NAME, description: '작성한 대화 요약을 반환한다.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    constrainedSampling: { type: 'json_schema', strict: 'require' } };
  return request => registry.complete(model, { systemPrompt: request.systemPrompt,
      messages: [{ role: 'user', content: request.userText, timestamp: Date.now() }], tools: [tool] }, {
      signal: request.signal, cacheRetention: 'none', sessionId: randomUUID(), reasoningEffort: 'medium', toolChoice: 'required',
      onPayload: payload => ({ ...payload, parallel_tool_calls: false }),
    });
}

async function sourceUnchanged(root, selected) {
  const current = await readSession(root, selected.path);
  if (current.rawHash !== selected.fileHash || current.sessionId !== selected.sessionId) {
    throw new Error('선택한 뒤 원본 세션이 변경되었습니다. 목록을 새로고침하고 다시 선택하세요.');
  }
  return current;
}

export async function processSelection(root, selection, { signal, onProgress = () => {}, complete, fetcher,
  upload = uploadEmbedding, env = process.env } = {}) {
  signal ??= new AbortController().signal;
  const config = await loadMongoConfig(root, env);
  if (!config) throw new Error('DB 적재에는 MONGODB_URI와 MONGODB_DB가 필요합니다.');
  const cloudflare = await loadCloudflareConfig(root, env);
  const results = [];
  const tasks = selection.sessions.flatMap(session => session.leafIds.map(leafId => ({ session, leafId })));
  let completeModel = complete;
  for (const [index, { session: selected, leafId }] of tasks.entries()) {
    if (signal.aborted) break;
    const result = { path: selected.path, sessionId: selected.sessionId, leafId, status: 'failed', stage: '원본 확인',
      summaryFile: null, embeddingFile: null, documentId: null, error: null, warnings: [] };
    const progress = stage => { result.stage = stage; onProgress({ completed: index, total: tasks.length, path: selected.path, stage }); };
    let metrics;
    let summaryStatus = 'failed';
    const started = performance.now();
    try {
      const current = await sourceUnchanged(root, selected);
      result.warnings.push(...current.warnings);
      const source = current.branch(leafId);
      if (!source.turns.length) throw new Error('선택한 분기에 사용자 발화가 없습니다.');
      result.summaryFile = outputPath(root, source);
      metrics = new RunMetrics(source, modelName);
      let exists = false;
      try {
        if (!(await lstat(result.summaryFile)).isFile()) throw new Error('기존 요약이 일반 파일이 아닙니다.');
        exists = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exists) { summaryStatus = 'reused'; progress('기존 요약 재사용'); }
      else {
        completeModel ??= await completeFromPi();
        const summary = await summarize(source, async request => {
          const response = await metrics.measure(request, () => completeModel(request));
          const calls = response.content.filter(part => part.type === 'toolCall');
          if (response.stopReason !== 'toolUse' || calls.length !== 1 || calls[0].name !== SUMMARY_TOOL_NAME || calls[0].namespace) {
            throw new Error(`요약 모델이 정상적인 submit_summary 호출을 반환하지 않았습니다. 종료 상태: ${response.stopReason}, 도구 호출: ${calls.length}개.`);
          }
          return calls[0].arguments;
        }, { signal, onProgress: (completed, total) => progress(completed < total
          ? `턴 ${completed + 1} / 총 ${total} 요약 중` : `턴 ${total} / 총 ${total} 완료 · 개요 생성 중`) });
        await sourceUnchanged(root, selected);
        const saved = await saveNewFile(result.summaryFile, renderMarkdown(source, summary, modelName), signal);
        summaryStatus = saved === 'created' ? 'created' : 'preserved';
      }
      const record = metrics.finish(summaryStatus);
      try { await saveNewJson(metricsPath(result.summaryFile, record.runId), record); }
      catch { result.warnings.push('요약 실행 기록 저장 실패'); }
      metrics = undefined;
      progress('임베딩 준비 중');
      const prepared = await prepareEmbedding(result.summaryFile, signal);
      const embedded = 'result' in prepared ? prepared.result : await generateEmbedding(prepared.plan, cloudflare, {
        signal, fetcher, onProgress: (completed, total) => progress(`임베딩 청크 ${Math.min(completed + 1, total)} / 총 ${total}`),
      });
      result.embeddingFile = embedded.path;
      await sourceUnchanged(root, selected);
      progress('DB 업로드 중');
      const uploadStarted = performance.now();
      const uploadRecord = { format: 'pi-session-rag-upload-metrics/1', runId: randomUUID(), embeddingFile: embedded.path,
        startedAt: new Date().toISOString(), status: 'failed', elapsedMs: 0, database: config.database,
        documentId: null, totalChunks: embedded.totalChunks, insertedChunks: null, reusedChunks: null, error: null };
      try {
        const uploaded = await upload(embedded.path, config, { signal,
          onProgress: (completed, total) => progress(`DB 청크 ${Math.min(completed + 1, total)} / 총 ${total}`) });
        signal.throwIfAborted();
        Object.assign(uploadRecord, { status: uploaded.status, documentId: uploaded.documentId,
          insertedChunks: uploaded.insertedChunks, reusedChunks: uploaded.reusedChunks });
        result.documentId = uploaded.documentId;
        result.status = 'completed';
        result.uploadStatus = uploaded.status;
        result.summaryStatus = summaryStatus;
        result.embeddingStatus = embedded.status;
      } catch (error) {
        uploadRecord.status = signal.aborted ? 'cancelled' : 'failed';
        uploadRecord.error = errorText(error);
        throw error;
      } finally {
        uploadRecord.elapsedMs = performance.now() - uploadStarted;
        try { await saveNewJson(uploadMetricsPath(embedded.path, uploadRecord.runId), uploadRecord); }
        catch { result.warnings.push('업로드 실행 기록 저장 실패'); }
      }
    } catch (error) {
      result.status = signal.aborted ? 'cancelled' : 'failed';
      result.error = signal.aborted ? '작업을 취소했습니다.' : errorText(error);
      if (metrics) {
        const record = metrics.finish(signal.aborted ? 'cancelled' : summaryStatus);
        try { await saveNewJson(metricsPath(result.summaryFile, record.runId), record); }
        catch { result.warnings.push('요약 실행 기록 저장 실패'); }
      }
    }
    result.elapsedMs = performance.now() - started;
    results.push(result);
    onProgress({ completed: results.length, total: tasks.length, path: selected.path, stage: result.status, result });
  }
  return { results, total: tasks.length, completed: results.filter(item => item.status === 'completed').length,
    failed: results.filter(item => item.status === 'failed').length, cancelled: signal.aborted, pending: tasks.length - results.length };
}

// 선택 파일만 갱신한다. 요약·벡터·DB 산출물의 저장은 기존 확장의 보호 규칙을 사용한다.
async function saveSelection(root, value) {
  const directory = join(root, '.pi/rag-batch');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, 'selection.json');
  try { if (!(await lstat(target)).isFile()) throw new Error('선택 저장 경로가 일반 파일이 아닙니다.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, target);
  return target;
}

export async function startServer(root, { port = 0, process = processSelection } = {}) {
  root = resolve(root);
  let catalog = await scanSessions(root);
  const token = randomUUID();
  let selection = null;
  try {
    const saved = JSON.parse(await readFile(join(root, '.pi/rag-batch/selection.json'), 'utf8'));
    if (saved.projectRoot === root && saved.format === 'pi-session-rag-selection/1') selection = saved;
  } catch (error) { if (error.code !== 'ENOENT') console.error('기존 선택 파일을 읽지 못했습니다. 새로 선택하세요.'); }
  let state = { status: 'idle', completed: 0, total: 0, results: [], reportPath: null };
  let controller;
  let job;
  let mutation = false;
  const html = await readFile(new URL('./session-rag-batch.html', import.meta.url), 'utf8');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (code, value, type = 'application/json') => {
      response.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    if ((request.headers['x-rag-token'] ?? url.searchParams.get('token')) !== token) return send(403, { error: '이 선택 화면의 접근 토큰이 필요합니다.' });
    let locked = false;
    try {
      if (request.method === 'GET' && url.pathname === '/') return send(200, html, 'text/html');
      if (request.method === 'GET' && url.pathname === '/api/catalog') return send(200, { catalog, selection, state });
      if (request.method === 'GET' && url.pathname === '/api/state') return send(200, state);
      if (request.method === 'GET' && url.pathname === '/api/preview') {
        const item = catalog.find(item => item.id === url.searchParams.get('id'));
        if (!item || item.error) throw new Error('읽을 수 없는 세션입니다.');
        const session = await sourceUnchanged(root, item);
        const messages = session.entries.filter(entry => entry.type === 'message' && ['user', 'assistant'].includes(entry.message?.role))
          .map(entry => ({ role: entry.message.role, text: textContent(entry.message.content), id: entry.id,
            stopReason: entry.message.stopReason, timestamp: entry.timestamp })).filter(item => item.text.trim());
        return send(200, { title: session.title, path: item.path, messages, branches: session.branches.length });
      }
      if (request.method !== 'POST') return send(404, { error: '없는 요청입니다.' });
      let body = '';
      for await (const part of request) body += part;
      const input = body ? JSON.parse(body) : {};
      if (url.pathname === '/api/cancel') {
        controller?.abort();
        return send(200, { cancelled: !!controller });
      }
      if (controller || mutation) return send(409, { error: '진행 중인 처리가 끝나거나 취소된 뒤 변경하세요.' });
      mutation = locked = true;
      if (url.pathname === '/api/refresh') {
        catalog = await scanSessions(root);
        return send(200, { catalog, selection, state });
      }
      if (url.pathname === '/api/selection' || url.pathname === '/api/run') {
        const sessions = selectSessions(catalog, input.ids, input.scope);
        selection = { format: 'pi-session-rag-selection/1', projectRoot: root,
          selectedAt: new Date().toISOString(), scope: input.scope, sessions };
        for (const selected of sessions) await sourceUnchanged(root, selected);
        const selectionPath = await saveSelection(root, selection);
        if (url.pathname === '/api/selection') return send(200, { selectionPath, selected: sessions.length });
        // 선택한 세션의 적재를 시작하기 전에 필수 설정을 검사한다.
        if (!await loadMongoConfig(root)) throw new Error('MONGODB_URI와 MONGODB_DB를 먼저 설정하세요. 선택 목록은 저장했습니다.');
        await loadCloudflareConfig(root);
        controller = new AbortController();
        const runId = randomUUID();
        state = { status: 'running', runId, startedAt: new Date().toISOString(), completed: 0,
          total: sessions.reduce((sum, item) => sum + item.leafIds.length, 0), results: [], stage: '처리 준비 중', reportPath: null };
        const signal = controller.signal;
        const current = state;
        const chosen = selection;
        job = (async () => {
          try {
            const outcome = await process(root, chosen, { signal, onProgress: progress => {
              const { result, ...current } = progress;
              Object.assign(state, current);
              if (result) state.results.push(result);
            } });
            Object.assign(current, outcome, { status: outcome.cancelled ? 'cancelled' : outcome.failed ? 'partial' : 'completed' });
          } catch (error) { current.status = signal.aborted ? 'cancelled' : 'failed'; current.error = errorText(error); }
          current.finishedAt = new Date().toISOString();
          const path = join(root, '.pi/rag-batch', `${runId}.json`);
          current.reportPath = path;
          try { await saveNewJson(path, { format: 'pi-session-rag-batch/1', selection: chosen, ...current }); }
          catch { current.reportError = '배치 실행 기록 저장 실패'; }
          controller = undefined;
          console.log(JSON.stringify({ event: 'batch_finished', ...current }));
        })();
        return send(202, { runId, selectionPath });
      }
      return send(404, { error: '없는 요청입니다.' });
    } catch (error) { return send(400, { error: errorText(error) }); }
    finally { if (locked) mutation = false; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, catalog, url: `http://127.0.0.1:${server.address().port}/?token=${token}`,
    getState: () => state, cancel: () => controller?.abort(), wait: () => job,
    close: async () => { controller?.abort(); await job; await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, port: { type: 'string' },
    named: { type: 'boolean' }, scope: { type: 'string' }, limit: { type: 'string' } } });
  const root = values.root ? resolve(values.root) : resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  if (values.named) {
    const scope = values.scope ?? 'latest';
    const catalog = await scanSessions(root);
    const selection = { format: 'pi-session-rag-selection/1', projectRoot: root, selectedAt: new Date().toISOString(),
      filter: 'named', scope, ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
      sessions: selectNamedSessions(catalog, scope, values.limit === undefined ? undefined : Number(values.limit)) };
    const selectionPath = await saveSelection(root, selection);
    const runId = randomUUID();
    const record = { format: 'pi-session-rag-batch/1', runId, selection, startedAt: new Date().toISOString(), status: 'running' };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, cancel);
    console.log(JSON.stringify({ event: 'named_started', runId, sessions: selection.sessions.length, scope, selectionPath }));
    try {
      const outcome = await processSelection(root, selection, { signal: controller.signal,
        onProgress: progress => {
          const { result, ...current } = progress;
          console.log(JSON.stringify({ event: 'progress', ...current,
            ...(result ? { result: { status: result.status, documentId: result.documentId, error: result.error } } : {}) }));
        } });
      Object.assign(record, outcome, { status: outcome.cancelled ? 'cancelled' : outcome.failed ? 'partial' : 'completed' });
      process.exitCode = outcome.cancelled ? 130 : outcome.failed ? 1 : 0;
    } catch (error) {
      record.status = controller.signal.aborted ? 'cancelled' : 'failed';
      record.error = errorText(error);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      record.finishedAt = new Date().toISOString();
      const reportPath = join(root, '.pi/rag-batch', `${runId}.json`);
      await saveNewJson(reportPath, record);
      console.log(JSON.stringify({ event: 'batch_finished', status: record.status, completed: record.completed,
        failed: record.failed, pending: record.pending, error: record.error, reportPath }));
      for (const event of ['SIGINT', 'SIGTERM']) process.removeListener(event, cancel);
    }
  } else {
    if (values.scope || values.limit !== undefined) throw new Error('--scope와 --limit는 --named와 함께 사용하세요.');
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port는 0부터 65535까지의 정수입니다.');
    const application = await startServer(root, { port });
    console.log(JSON.stringify({ event: 'ready', sessions: application.catalog.length, url: application.url,
      selectionPath: join(root, '.pi/rag-batch/selection.json') }));
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, async () => { await application.close(); process.exit(0); });
  }
}
