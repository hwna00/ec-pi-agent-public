"use strict";
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
