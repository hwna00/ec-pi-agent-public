"use strict";
const ONTOLOGY_CLIPPER_ENDPOINT = "http://127.0.0.1:7777/clip";

function ontologyClipperClean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  return ontologyClipperClean(element.innerText || element.textContent || "").replace(/\n{3,}/g, "\n\n");
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
      const match = /^indent(\d+)$/.exec(className);
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
