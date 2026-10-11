import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "../npm/node_modules/@earendil-works/pi-coding-agent/dist/index.js" with { "resolution-mode": "import" };

type ClipperConfig = {
	enabled: boolean;
	host: string;
	port: number;
	autoStart: boolean;
};

type BoardField = {
	label: string;
	value: string;
};

type BoardArticle = {
	no: string;
	title: string;
	author: string;
	date: string;
	fields: BoardField[];
	bodyMd: string;
	indent: number;
};

type ClipPayload = {
	rawHtml?: string;
	articles?: BoardArticle[];
	url?: string;
	capturedAt?: string;
};

const PI_DIR = resolve(process.cwd(), ".pi");
const ONTOLOGY_ROOT = join(PI_DIR, "ontology", "query-model");
const CONFIG_PATH = join(PI_DIR, "ontology-clipper.json");
const RAW_DIR = join(ONTOLOGY_ROOT, "sources", "clipper", "raw", "board-html");
const NORMALIZED_DIR = join(ONTOLOGY_ROOT, "sources", "clipper", "normalized", "board-md");
const STATUS_PATH = join(ONTOLOGY_ROOT, "status", "index-state.json");
const BROWSER_EXTENSION_DIR = join(ONTOLOGY_ROOT, "clipper", "browser-extension");

const DEFAULT_CONFIG: ClipperConfig = {
	enabled: true,
	host: "127.0.0.1",
	port: 7777,
	autoStart: true,
};

let server: Server | undefined;
let serverUrl: string | undefined;
let lastError: string | undefined;

function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}

function loadConfig(): ClipperConfig {
	if (!existsSync(CONFIG_PATH)) {
		writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
		return DEFAULT_CONFIG;
	}
	const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<ClipperConfig>;
	return {
		enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
		host: parsed.host ?? DEFAULT_CONFIG.host,
		port: Number(parsed.port ?? DEFAULT_CONFIG.port),
		autoStart: parsed.autoStart ?? DEFAULT_CONFIG.autoStart,
	};
}

function slug(value: string): string {
	return value
		.replace(/\s+/g, "-")
		.replace(/[\\/:*?"<>|#]/g, "")
		.slice(0, 80);
}

function renderMarkdown(articles: BoardArticle[], metadata: Pick<ClipPayload, "url" | "capturedAt">): string {
	const main = articles[0];
	if (!main) return "";
	const extras = articles.slice(1).filter((article) => article.indent === 0);
	const replies = articles.slice(1).filter((article) => article.indent >= 1);
	const out: string[] = [
		`# ${main.no} | ${main.title}`,
		"",
		`- **작성자**: ${main.author}`,
		`- **작성일**: ${main.date}`,
		metadata.url ? `- **수집 URL**: ${metadata.url}` : undefined,
		metadata.capturedAt ? `- **수집일시**: ${metadata.capturedAt}` : undefined,
	]
		.filter((line): line is string => line !== undefined);

	for (const field of main.fields ?? []) {
		if (["작성자명", "제목", "게시글번호"].includes(field.label)) continue;
		out.push(`- **${field.label}**: ${field.value}`);
	}
	out.push("", "## 본문", "", main.bodyMd ?? "", "");

	for (const article of extras) {
		out.push("---", "", `## 연결 정보: ${article.no} | ${article.title}`, "", `- **작성자**: ${article.author}`, `- **작성일**: ${article.date}`);
		for (const field of article.fields ?? []) {
			if (["작성자명", "제목", "게시글번호"].includes(field.label)) continue;
			out.push(`- **${field.label}**: ${field.value}`);
		}
		if (article.bodyMd) out.push("", article.bodyMd);
		out.push("");
	}

	if (replies.length > 0) {
		out.push("---", "", "## 답글", "");
		for (const article of replies) {
			const level = Math.min(3 + (article.indent - 1), 6);
			out.push(`${"#".repeat(level)} ${article.no} | ${article.author} | ${article.date}`, "");
			for (const field of article.fields ?? []) {
				if (field.label === "작성자명") continue;
				out.push(`- **${field.label}**: ${field.value}`);
			}
			if (article.fields?.some((field) => field.label !== "작성자명")) out.push("");
			if (article.bodyMd) out.push(article.bodyMd, "");
		}
	}
	return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function markStale(details: Record<string, unknown>): void {
	ensureDir(join(ONTOLOGY_ROOT, "status"));
	const previous = existsSync(STATUS_PATH) ? JSON.parse(readFileSync(STATUS_PATH, "utf-8")) : {};
	writeFileSync(
		STATUS_PATH,
		`${JSON.stringify({
			...previous,
			stale: true,
			stale_reason: "clipper captured board evidence",
			stale_at: new Date().toISOString(),
			last_ingest: {
				source: "clipper",
				...details,
			},
		}, null, 2)}\n`,
		"utf-8",
	);
}

function saveClip(payload: ClipPayload): { no: string; title: string; htmlPath: string; mdPath: string; replyCount: number } {
	const articles = Array.isArray(payload.articles) ? payload.articles : [];
	const main = articles[0];
	if (!main) throw new Error("No board article was provided by browser extension.");
	ensureDir(RAW_DIR);
	ensureDir(NORMALIZED_DIR);

	const base = `tp_${slug(main.no)}`;
	const htmlPath = join(RAW_DIR, `${base}.html`);
	const mdPath = join(NORMALIZED_DIR, `${base}.md`);
	writeFileSync(htmlPath, payload.rawHtml ?? "", "utf-8");
	writeFileSync(mdPath, renderMarkdown(articles, payload), "utf-8");
	markStale({ raw_path: htmlPath, normalized_path: mdPath });

	return {
		no: main.no,
		title: main.title,
		htmlPath,
		mdPath,
		replyCount: articles.filter((article) => article.indent >= 1).length,
	};
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.writeHead(statusCode, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, OPTIONS, GET",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify(body));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolveBody, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	if (req.method === "OPTIONS") {
		sendJson(res, 204, {});
		return;
	}
	if (req.method === "GET" && req.url === "/health") {
		sendJson(res, 200, { ok: true, receiver: "ontology-clipper", url: serverUrl, naming: "tp-prefixed-overwrite" });
		return;
	}
	if (req.method !== "POST" || (req.url !== "/clip" && req.url !== "/clip/")) {
		sendJson(res, 404, { ok: false, error: "not found" });
		return;
	}
	try {
		const raw = await readRequestBody(req);
		const contentType = String(req.headers["content-type"] ?? "");
		const payload = contentType.includes("application/json") ? JSON.parse(raw) as ClipPayload : { rawHtml: raw, articles: [] };
		const saved = saveClip(payload);
		sendJson(res, 200, {
			ok: true,
			no: saved.no,
			title: saved.title,
			html_path: saved.htmlPath,
			md_path: saved.mdPath,
			reply_count: saved.replyCount,
		});
	} catch (error) {
		sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
	}
}

async function startReceiver(config = loadConfig()): Promise<string> {
	if (server && serverUrl) return serverUrl;
	if (!config.enabled) throw new Error(`Ontology clipper is disabled in ${CONFIG_PATH}`);
	ensureDir(RAW_DIR);
	ensureDir(NORMALIZED_DIR);
	writeBrowserExtension(config);
	server = createServer((req, res) => {
		void handleRequest(req, res);
	});
	await new Promise<void>((resolveStart, rejectStart) => {
		server?.once("error", rejectStart);
		server?.listen(config.port, config.host, () => resolveStart());
	});
	serverUrl = `http://${config.host}:${config.port}`;
	lastError = undefined;
	return serverUrl;
}

async function stopReceiver(): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolveStop, rejectStop) => server?.close((error) => error ? rejectStop(error) : resolveStop()));
	server = undefined;
	serverUrl = undefined;
}

function captureContentScriptSource(config = loadConfig()): string {
	const endpoint = `http://${config.host}:${config.port}/clip`;
	return `"use strict";
const ONTOLOGY_CLIPPER_ENDPOINT = ${JSON.stringify(endpoint)};

function ontologyClipperClean(value) {
  return String(value || "").replace(/\\s+/g, " ").trim();
}

function ontologyClipperToast(message, ok) {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    padding: "10px 16px",
    borderRadius: "6px",
    zIndex: 9999999,
    background: ok ? "#2a7" : "#c33",
    color: "#fff",
    fontFamily: "sans-serif",
    fontSize: "13px",
    boxShadow: "0 2px 8px rgba(0,0,0,.3)",
    maxWidth: "600px",
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function ontologyClipperTitleOf(dialog) {
  const title = dialog.querySelector(".wrapper-layout-module-main .panel-heading b");
  return title ? ontologyClipperClean(title.textContent) : ontologyClipperClean(dialog.getAttribute("data-popup-id") || "unknown");
}

function ontologyClipperBodyMd(element) {
  if (!element) return "";
  return ontologyClipperClean(element.innerText || element.textContent || "").replace(/\\n{3,}/g, "\\n\\n");
}

function ontologyClipperParseTitle(panel) {
  const text = ontologyClipperClean(panel && panel.querySelector(".panel-heading b")?.textContent);
  const parts = text.split("|").map(ontologyClipperClean);
  if (parts.length < 4) return null;
  return {
    no: parts[0],
    title: parts.slice(1, -2).join(" | "),
    author: parts[parts.length - 2],
    date: parts[parts.length - 1],
  };
}

function ontologyClipperFields(body) {
  return Array.from((body || document).querySelectorAll("ul.wrapper-form > li"))
    .map((li) => ({
      label: ontologyClipperClean(li.querySelector(".title")?.textContent),
      value: ontologyClipperClean(li.querySelector(".form")?.textContent),
    }))
    .filter((field) => field.label && field.value);
}

function ontologyClipperArticleFromPanel(panel, indent) {
  const header = ontologyClipperParseTitle(panel);
  if (!header) return null;
  const body = panel.querySelector(".panel-body");
  const textContainer = body && body.querySelector('[data-item-key^="body_html_ctt_"] .ec-textcontainer');
  return {
    no: header.no,
    title: header.title,
    author: header.author,
    date: header.date,
    fields: ontologyClipperFields(body),
    bodyMd: ontologyClipperBodyMd(textContainer),
    indent,
  };
}

function ontologyClipperParseDialog(dialog) {
  const articles = [];
  Array.from(dialog.querySelectorAll(".wrapper-layout-module-main .grid-stack-item")).forEach((item) => {
    const article = ontologyClipperArticleFromPanel(item.querySelector(".panel"), 0);
    if (article) articles.push(article);
  });
  Array.from(dialog.querySelectorAll(".wrapper-layout-module-reply .layout-module")).forEach((module) => {
    let indent = 0;
    Array.from(module.classList || []).forEach((className) => {
      const match = /^indent(\\d+)$/.exec(className);
      if (match) indent = Number(match[1]);
    });
    if (!indent) return;
    const article = ontologyClipperArticleFromPanel(module.querySelector(".panel"), indent);
    if (article) articles.push(article);
  });
  return articles;
}

function ontologyClipperDialogs() {
  return Array.from(document.querySelectorAll('.ui-dialog[data-popup-id^="IBoardViewPage_"]'))
    .sort((a, b) => parseInt(b.style.zIndex || "0", 10) - parseInt(a.style.zIndex || "0", 10));
}

async function ontologyClipperSend(dialog) {
  const payload = {
    rawHtml: dialog.outerHTML,
    articles: ontologyClipperParseDialog(dialog),
    url: location.href,
    capturedAt: new Date().toISOString(),
  };
  try {
    const response = await fetch(ONTOLOGY_CLIPPER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (response.ok && body.ok) {
      ontologyClipperToast("saved " + body.no + " (replies:" + body.reply_count + ")", true);
    } else {
      ontologyClipperToast("error: " + (body.error || "unknown"), false);
    }
  } catch (error) {
    ontologyClipperToast("receiver 연결 실패: " + error.message, false);
  }
}

function ontologyClipperPicker(dialogs) {
  const old = document.getElementById("__ontology_clipper_picker__");
  if (old) old.remove();
  const wrap = document.createElement("div");
  wrap.id = "__ontology_clipper_picker__";
  Object.assign(wrap.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,.4)",
    zIndex: 9999998,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "sans-serif",
  });
  const box = document.createElement("div");
  Object.assign(box.style, {
    background: "#fff",
    borderRadius: "8px",
    padding: "16px",
    minWidth: "420px",
    maxWidth: "720px",
    maxHeight: "70vh",
    overflow: "auto",
    boxShadow: "0 8px 32px rgba(0,0,0,.3)",
  });
  const header = document.createElement("div");
  header.textContent = "캡처할 게시글 선택 (" + dialogs.length + "개 열림)";
  Object.assign(header.style, { fontSize: "14px", fontWeight: "bold", marginBottom: "12px" });
  box.appendChild(header);
  dialogs.forEach((dialog, index) => {
    const button = document.createElement("button");
    button.textContent = (index === 0 ? "★ " : "   ") + ontologyClipperTitleOf(dialog);
    Object.assign(button.style, {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 12px",
      margin: "4px 0",
      border: "1px solid #ccc",
      borderRadius: "4px",
      background: index === 0 ? "#eef6ff" : "#f7f7f7",
      cursor: "pointer",
      fontSize: "13px",
    });
    button.onclick = () => {
      wrap.remove();
      void ontologyClipperSend(dialog);
    };
    box.appendChild(button);
  });
  const cancel = document.createElement("button");
  cancel.textContent = "취소";
  cancel.onclick = () => wrap.remove();
  box.appendChild(cancel);
  wrap.appendChild(box);
  wrap.onclick = (event) => {
    if (event.target === wrap) wrap.remove();
  };
  document.body.appendChild(wrap);
}

function ontologyClipperCapture() {
  const dialogs = ontologyClipperDialogs();
  if (dialogs.length === 0) {
    ontologyClipperToast("IBoardViewPage 팝업이 열려있지 않음", false);
  } else if (dialogs.length === 1) {
    void ontologyClipperSend(dialogs[0]);
  } else {
    ontologyClipperPicker(dialogs);
  }
}

if (!globalThis.__ontologyClipperContentScriptLoaded) {
  globalThis.__ontologyClipperContentScriptLoaded = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "ontology-clipper-capture") {
      ontologyClipperCapture();
    }
  });
}
`;
}

function backgroundScriptSource(): string {
	return `"use strict";
function sendCapture(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "ontology-clipper-capture" }, () => {
    if (!chrome.runtime.lastError) return;
    chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] }, () => {
      if (chrome.runtime.lastError) return;
      chrome.tabs.sendMessage(tabId, { type: "ontology-clipper-capture" });
    });
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  sendCapture(tab.id);
});
`;
}

function manifestSource(config = loadConfig()): string {
	return `${JSON.stringify({
		manifest_version: 3,
		name: "Pi Ontology Clipper",
		version: "0.1.0",
		description: "Capture Ecount board popups into the project-local query-model ontology sources.",
		action: {
			default_title: "Capture board into Pi ontology",
		},
		permissions: ["activeTab", "scripting"],
		host_permissions: [`http://${config.host}:${config.port}/*`, "http://localhost:7777/*", "<all_urls>"],
		background: {
			service_worker: "background.js",
		},
		content_scripts: [
			{
				matches: ["<all_urls>"],
				js: ["content-script.js"],
				run_at: "document_idle",
			},
		],
	}, null, 2)}\n`;
}

function browserExtensionReadme(): string {
	return `# Pi Ontology Clipper Browser Extension

Chrome/Edge unpacked extension generated by \`.pi/extensions/ontology-clipper.ts\`.

## Install

1. Open Chrome/Edge extensions page.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this folder:

\`\`\`text
${BROWSER_EXTENSION_DIR}
\`\`\`

The Pi receiver must be running at \`http://127.0.0.1:7777\`. It auto-starts from the Pi extension when \`.pi/ontology-clipper.json\` has \`autoStart: true\`.

## Use

Open an Ecount board view popup and click the extension toolbar icon.
`;
}

function writeBrowserExtension(config = loadConfig()): void {
	ensureDir(BROWSER_EXTENSION_DIR);
	writeFileSync(join(BROWSER_EXTENSION_DIR, "manifest.json"), manifestSource(config), "utf-8");
	writeFileSync(join(BROWSER_EXTENSION_DIR, "background.js"), backgroundScriptSource(), "utf-8");
	writeFileSync(join(BROWSER_EXTENSION_DIR, "content-script.js"), captureContentScriptSource(config), "utf-8");
	writeFileSync(join(BROWSER_EXTENSION_DIR, "README.md"), browserExtensionReadme(), "utf-8");
}

function statusText(): string {
	const config = loadConfig();
	return [
		`enabled: ${config.enabled}`,
		`autoStart: ${config.autoStart}`,
		`url: ${serverUrl ?? `http://${config.host}:${config.port}`}`,
		`running: ${Boolean(server)}`,
		lastError ? `lastError: ${lastError}` : undefined,
		`rawDir: ${RAW_DIR}`,
		`normalizedDir: ${NORMALIZED_DIR}`,
		`browserExtension: ${BROWSER_EXTENSION_DIR}`,
	].filter((line): line is string => line !== undefined).join("\n");
}

export default function ontologyClipperExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig();
		writeBrowserExtension(config);
		if (!config.autoStart) return;
		try {
			const url = await startReceiver(config);
			ctx.ui.notify(`Ontology clipper receiver running at ${url}`, "info");
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Ontology clipper receiver failed: ${lastError}`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		await stopReceiver();
	});

	pi.registerCommand("ontology-clipper", {
		description: "Manage ontology board clipper receiver",
		handler: async (args, ctx: ExtensionContext) => {
			const command = args.trim() || "status";
			try {
				if (command === "start") {
					const url = await startReceiver();
					ctx.ui.notify(`Ontology clipper receiver running at ${url}`, "info");
					return;
				}
				if (command === "stop") {
					await stopReceiver();
					ctx.ui.notify("Ontology clipper receiver stopped.", "info");
					return;
				}
				if (command === "extension") {
					writeBrowserExtension();
					ctx.ui.notify(`Browser extension written to ${BROWSER_EXTENSION_DIR}`, "info");
					pi.sendMessage({ customType: "ontology-clipper-extension", content: `Load unpacked extension from:\n${BROWSER_EXTENSION_DIR}`, display: true });
					return;
				}
				if (command === "status") {
					pi.sendMessage({ customType: "ontology-clipper-status", content: statusText(), display: true });
					return;
				}
				ctx.ui.notify("Usage: /ontology-clipper [status|start|stop|extension]", "warning");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
