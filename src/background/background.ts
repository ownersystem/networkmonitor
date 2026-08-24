import {
  clearRequests,
  cleanupTab,
  getRequests,
  getSummary,
  setBroadcaster,
  startRecording,
  stopRecording
} from "./network";
import { loadSettings, saveSettings } from "./storage";
import { safeError, safeLog } from "./security";
import type { BroadcastMessage, RuntimeMessage, RuntimeMessageResponse } from "../shared/types";

setBroadcaster((message: BroadcastMessage) => {
  const sendToPopup = message.type !== "COUNT_UPDATED";
  const sendToContentScript =
    message.type === "COUNT_UPDATED" ||
    message.type === "RECORDING_STATE_CHANGED" ||
    message.type === "REQUESTS_CLEARED";

  if (sendToPopup) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  if (sendToContentScript && "tabId" in message) {
    chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
  }
});

function updateBadge(tabId: number): void {
  const summary = getSummary(tabId);
  const text = summary.recording ? String(Math.min(summary.requestCount, 9999)) : "";
  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: "#3B82F6" });
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeMessageResponse) => void
  ) => {
    void handleMessage(message, sender).then(sendResponse);
    return true;
  }
);

async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeMessageResponse> {
  try {
    switch (message.type) {
      case "START_RECORDING": {
        const state = await startRecording(message.tabId);
        updateBadge(message.tabId);
        return { ok: true, state };
      }
      case "STOP_RECORDING": {
        const state = await stopRecording(message.tabId);
        updateBadge(message.tabId);
        return { ok: true, state };
      }
      case "CLEAR_REQUESTS": {
        const state = clearRequests(message.tabId);
        updateBadge(message.tabId);
        return { ok: true, state };
      }
      case "GET_TAB_STATE": {
        const tab = await chrome.tabs.get(message.tabId).catch(() => null);
        const state = getSummary(message.tabId, tab?.url ?? null, tab?.title ?? null);
        return { ok: true, state };
      }
      case "GET_ACTIVE_TAB_STATE": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || typeof tab.id !== "number") {
          return { ok: false, error: "Активная вкладка не найдена" };
        }
        const state = getSummary(tab.id, tab.url ?? null, tab.title ?? null);
        return { ok: true, state };
      }
      case "GET_REQUESTS": {
        return { ok: true, requests: getRequests(message.tabId) };
      }
      case "GET_SETTINGS": {
        const settings = await loadSettings();
        return { ok: true, settings };
      }
      case "UPDATE_SETTINGS": {
        const settings = await saveSettings(message.settings);
        return { ok: true, settings };
      }
      case "OVERLAY_QUERY": {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number") {
          return { ok: false, error: "Не удалось определить вкладку" };
        }
        const state = getSummary(tabId);
        const settings = await loadSettings();
        return { ok: true, state, settings };
      }
      default:
        return { ok: false, error: "Неизвестный тип сообщения" };
    }
  } catch (error) {
    safeError("Ошибка обработки сообщения", error);
    return { ok: false, error: error instanceof Error ? error.message : "Неизвестная ошибка" };
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTab(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  safeLog("Network Monitor установлен");
  void loadSettings();
});

safeLog("Service worker запущен");
