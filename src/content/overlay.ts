import type { BroadcastMessage, ExtensionSettings, RuntimeMessageResponse, TabRecordingSummary } from "../shared/types";
import { EXTENSION_NAME } from "../shared/constants";

const HOST_ID = "network-monitor-overlay-host";

let currentState: TabRecordingSummary = {
  tabId: -1,
  recording: false,
  requestCount: 0,
  url: null,
  title: null
};
let overlayEnabled = true;
let overlayMinimal = false;

let hostEl: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let countEl: HTMLSpanElement | null = null;
let statusDotEl: HTMLSpanElement | null = null;
let statusTextEl: HTMLSpanElement | null = null;
let panelEl: HTMLDivElement | null = null;

function createOverlay(): void {
  if (hostEl) {
    return;
  }
  hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  hostEl.style.cssText = "all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;";
  shadow = hostEl.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .panel {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 10px;
      background: rgba(23, 25, 31, 0.92);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(40, 44, 52, 0.9);
      color: #E6E8EC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.3;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 160ms ease, transform 160ms ease;
      pointer-events: none;
      user-select: none;
    }
    .panel.visible {
      opacity: 0.95;
      transform: translateY(0);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #8B919C;
      flex-shrink: 0;
    }
    .dot.recording {
      background: #E5484D;
    }
    .col { display: flex; flex-direction: column; gap: 2px; }
    .title { font-weight: 600; color: #E6E8EC; }
    .status { color: #8B919C; }
    .count { color: #8B919C; font-variant-numeric: tabular-nums; }
    .minimal .col { flex-direction: row; align-items: center; gap: 6px; }
    .minimal .status { display: none; }
  `;

  panelEl = document.createElement("div");
  panelEl.className = "panel";

  statusDotEl = document.createElement("span");
  statusDotEl.className = "dot";

  const col = document.createElement("div");
  col.className = "col";

  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = EXTENSION_NAME;

  statusTextEl = document.createElement("span");
  statusTextEl.className = "status";
  statusTextEl.textContent = "Пауза";

  countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = "0 requests";

  col.appendChild(titleEl);
  col.appendChild(statusTextEl);
  col.appendChild(countEl);

  panelEl.appendChild(statusDotEl);
  panelEl.appendChild(col);

  shadow.appendChild(style);
  shadow.appendChild(panelEl);
  document.documentElement.appendChild(hostEl);
}

function render(): void {
  if (!overlayEnabled || !currentState.recording) {
    if (hostEl && panelEl) {
      panelEl.classList.remove("visible");
    }
    return;
  }
  createOverlay();
  if (!panelEl || !statusDotEl || !statusTextEl || !countEl) {
    return;
  }

  panelEl.classList.toggle("minimal", overlayMinimal);
  panelEl.classList.add("visible");
  statusDotEl.classList.toggle("recording", currentState.recording);
  statusTextEl.textContent = currentState.recording ? "Запись активна" : "Пауза";
  countEl.textContent = `${currentState.requestCount} requests`;
}

function removeOverlay(): void {
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
    shadow = null;
    panelEl = null;
    statusDotEl = null;
    statusTextEl = null;
    countEl = null;
  }
}

function applySettings(settings: ExtensionSettings): void {
  overlayEnabled = settings.overlayEnabled;
  overlayMinimal = settings.overlayMinimal;
  if (!overlayEnabled) {
    removeOverlay();
  } else {
    render();
  }
}

chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
  switch (message.type) {
    case "RECORDING_STATE_CHANGED":
      currentState = { ...currentState, recording: message.recording, requestCount: message.requestCount };
      render();
      break;
    case "NEW_REQUEST":
    case "COUNT_UPDATED":
      currentState = {
        ...currentState,
        requestCount: "count" in message ? message.count : currentState.requestCount + 1
      };
      render();
      break;
    case "REQUESTS_CLEARED":
      currentState = { ...currentState, requestCount: 0 };
      render();
      break;
    default:
      break;
  }
});

function init(): void {
  chrome.runtime
    .sendMessage({ type: "OVERLAY_QUERY" })
    .then((response: RuntimeMessageResponse) => {
      if (response && response.ok && "state" in response && "settings" in response) {
        currentState = response.state;
        applySettings(response.settings);
      }
    })
    .catch(() => {});
}

init();
