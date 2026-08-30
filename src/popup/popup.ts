import type {
  BroadcastMessage,
  ExportedDump,
  ExtensionSettings,
  HeaderEntry,
  MethodFilter,
  NetworkRequestRecord,
  RuntimeMessage,
  RuntimeMessageResponse
} from "../shared/types";
import { EXTENSION_VERSION } from "../shared/constants";
import { formatBytes, formatClockTime, statusCategory, escapeHtml } from "../shared/utils";
import { maskHeadersForDisplay, maskJsonForDisplay, maskQueryParams, maskUrlForDisplay } from "../shared/sanitize";
import { generateCurl, generateFetch } from "../shared/generators";

interface ChangelogEntry {
  version: string;
  date: string;
  shortLabel: string;
  title: string;
  changes: string[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.1.4",
    date: "30.08.2026",
    shortLabel: "Auto + API",
    title: "Update 1.1.4",
    changes: [
      "Добавлен авто-режим: запись сети может стартовать сама при загрузке страницы, без нажатия «Начать запись» (включается в Настройках).",
      "Запросы, содержащие «api» в любом месте URL (регистр не важен), теперь помечаются бейджем API прямо в общем списке и их можно быстро отфильтровать кнопкой API рядом с фильтрами — без перехода на отдельный экран.",
      "Полностью удалён экспериментальный модуль обнаружения баннеров на странице: убраны связанные UI, код фонового процесса и content-script, чтобы расширение оставалось лёгким и сфокусированным на мониторинге сети.",
      "Мелкие правки текстов интерфейса."
    ]
  },
  {
    version: "1.1.3",
    date: "23.08.2026",
    shortLabel: "Redesign",
    title: "Update 1.1.3",
    changes: [
      "Полный редизайн интерфейса в стиле иконки расширения: новая тёмная палитра, фирменный pulse-акцент в шапке, иконки в полях поиска и фильтров, обновлённые бейджи методов/статусов.",
      "Скруглены внешние углы всей панели popup, а не только внутренних элементов.",
      "Исправлена утечка секретов: кнопки Copy URL, Copy body, экспорт JSON/TXT теперь учитывают настройку «Показывать секретные значения» — раньше они копировали и выгружали реальные значения токенов/паролей/cookie даже при включённой маскировке в интерфейсе.",
      "Обработка кликов в панели деталей сделана устойчивее: делегирование событий теперь ищет ближайший элемент с data-action/data-tab, а не полагается на точный элемент клика.",
      "Добавлено активное состояние для переключателя Pretty/Raw.",
      "Кастомный тонкий скроллбар вместо системного во всех прокручиваемых областях."
    ]
  },
  {
    version: "1.1.2",
    date: "22.08.2026",
    shortLabel: "FIX Copy",
    title: "Update 1.1.2",
    changes: [
      "Исправлено дублирование записей в списке запросов: сообщения фонового процесса теперь маршрутизируются раздельно для popup и overlay на странице, из-за пересечения каналов один и тот же запрос мог добавляться в список дважды.",
      "Добавлена защита от повторного добавления одной и той же записи на стороне popup (дедупликация по id) на случай повторной доставки сообщения.",
      "Debugger переиспользует уже подключённую CDP-сессию вместо повторного attach при перезапуске service worker, что тоже могло приводить к дублированию сетевых событий.",
      "Название расширения изменено с «Amazing Network Monitor» на «Network Monitor» во всём интерфейсе.",
      "Добавлен раздел «Change Log» с историей изменений версий."
    ]
  },
  {
    version: "1.1.1",
    date: "21.08.2026",
    shortLabel: "Release",
    title: "Update 1.1.1",
    changes: [
      "Первый релиз Network Monitor: запись сетевых запросов текущей вкладки через chrome.debugger и Chrome DevTools Protocol.",
      "Просмотр headers, query, request/response body, статус-коды, поиск и фильтры.",
      "Copy as cURL, Copy as fetch, экспорт в JSON/TXT, маскирование секретных значений.",
      "Индикатор записи на странице (overlay)."
    ]
  }
];

let selectedChangelogVersion = CHANGELOG[0].version;

let currentTabId: number | null = null;
let requests: NetworkRequestRecord[] = [];
let settings: ExtensionSettings | null = null;
let selectedRequestId: string | null = null;
let activeDetailTab = "overview";
let searchQuery = "";
let methodFilter: MethodFilter = "ALL";
let urlFilter = "";
let apiOnly = false;

const el = {
  statusDot: document.getElementById("status-dot") as HTMLSpanElement,
  statusText: document.getElementById("status-text") as HTMLSpanElement,
  btnRecord: document.getElementById("btn-record") as HTMLButtonElement,
  btnStop: document.getElementById("btn-stop") as HTMLButtonElement,
  btnClear: document.getElementById("btn-clear") as HTMLButtonElement,
  btnDownload: document.getElementById("btn-download") as HTMLButtonElement,
  downloadMenu: document.getElementById("download-menu") as HTMLDivElement,
  btnSettings: document.getElementById("btn-settings") as HTMLButtonElement,
  settingsPanel: document.getElementById("settings-panel") as HTMLDivElement,
  settingAutoMode: document.getElementById("setting-auto-mode") as HTMLInputElement,
  settingOverlayEnabled: document.getElementById("setting-overlay-enabled") as HTMLInputElement,  settingOverlayMinimal: document.getElementById("setting-overlay-minimal") as HTMLInputElement,
  settingShowSecrets: document.getElementById("setting-show-secrets") as HTMLInputElement,
  searchInput: document.getElementById("search-input") as HTMLInputElement,
  methodFilterSelect: document.getElementById("method-filter") as HTMLSelectElement,
  urlFilterInput: document.getElementById("url-filter") as HTMLInputElement,
  apiOnlyToggle: document.getElementById("api-only-toggle") as HTMLButtonElement,
  requestList: document.getElementById("request-list") as HTMLDivElement,
  emptyState: document.getElementById("empty-state") as HTMLDivElement,
  detailEmpty: document.getElementById("detail-empty") as HTMLDivElement,
  detailContent: document.getElementById("detail-content") as HTMLDivElement,
  detailTabs: document.getElementById("detail-tabs") as HTMLDivElement,
  detailActions: document.getElementById("detail-actions") as HTMLDivElement,
  detailBody: document.getElementById("detail-body") as HTMLDivElement,
  curlMenu: document.getElementById("curl-menu") as HTMLDivElement,
  debuggerNotice: document.getElementById("debugger-notice") as HTMLDivElement,
  noticeDismiss: document.getElementById("notice-dismiss") as HTMLButtonElement,
  workspace: document.getElementById("workspace") as HTMLElement,
  filters: document.getElementById("filters") as HTMLDivElement,
  btnChangelog: document.getElementById("btn-changelog") as HTMLButtonElement,
  changelogView: document.getElementById("changelog-view") as HTMLElement,
  changelogBack: document.getElementById("changelog-back") as HTMLButtonElement,
  changelogList: document.getElementById("changelog-list") as HTMLDivElement,
  changelogDetail: document.getElementById("changelog-detail") as HTMLDivElement,
};

function sendMessage(message: RuntimeMessage): Promise<RuntimeMessageResponse> {
  return chrome.runtime.sendMessage(message);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  const toastEl = document.getElementById("toast");
  const toastTextEl = document.getElementById("toast-text");
  if (!toastEl || !toastTextEl) {
    return;
  }
  toastTextEl.textContent = message;
  toastEl.classList.remove("hidden");
  requestAnimationFrame(() => toastEl.classList.add("visible"));
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
    toastTimer = setTimeout(() => {
      toastEl.classList.add("hidden");
    }, 180);
  }, 1500);
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Скопировано");
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showToast("Скопировано");
  }
}

function getRequestById(id: string | null): NetworkRequestRecord | null {
  if (!id) {
    return null;
  }
  return requests.find((r) => r.id === id) ?? null;
}

function matchesSearch(request: NetworkRequestRecord, query: string): boolean {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  if (request.url.toLowerCase().includes(q)) return true;
  if (request.method.toLowerCase().includes(q)) return true;
  if (String(request.status ?? "").includes(q)) return true;
  if (request.hostname.toLowerCase().includes(q)) return true;
  if (request.pathname.toLowerCase().includes(q)) return true;
  if (request.responseBody.text && request.responseBody.text.toLowerCase().includes(q)) return true;
  return false;
}

function isApiRequest(request: NetworkRequestRecord): boolean {
  return /api/i.test(request.url);
}

function matchesUrlFilter(request: NetworkRequestRecord, filter: string): boolean {
  if (!filter) {
    return true;
  }
  const f = filter.toLowerCase();
  return (
    request.url.toLowerCase().includes(f) ||
    request.hostname.toLowerCase().includes(f) ||
    request.pathname.toLowerCase().includes(f)
  );
}

function filteredRequests(): NetworkRequestRecord[] {
  return requests.filter((r) => {
    if (methodFilter !== "ALL" && r.method !== methodFilter) {
      return false;
    }
    if (apiOnly && !isApiRequest(r)) {
      return false;
    }
    if (!matchesUrlFilter(r, urlFilter)) {
      return false;
    }
    if (!matchesSearch(r, searchQuery)) {
      return false;
    }
    return true;
  });
}

function methodBadgeClass(method: string): string {
  const lower = method.toLowerCase();
  if (lower === "post") return "badge badge--method badge--method-post";
  if (lower === "put") return "badge badge--method badge--method-put";
  if (lower === "patch") return "badge badge--method badge--method-patch";
  if (lower === "delete") return "badge badge--method badge--method-delete";
  return "badge badge--method";
}

function statusBadgeClass(status: number | null, hasError: boolean): string {
  if (hasError) {
    return "badge badge--status-error";
  }
  const category = statusCategory(status);
  return `badge badge--status-${category}`;
}

function renderList(): void {
  const items = filteredRequests();
  el.requestList.querySelectorAll(".request-item").forEach((node) => node.remove());

  if (items.length === 0) {
    el.emptyState.classList.remove("hidden");
    return;
  }
  el.emptyState.classList.add("hidden");

  const fragment = document.createDocumentFragment();
  for (const request of items) {
    const item = document.createElement("div");
    item.className = "request-item" + (request.id === selectedRequestId ? " active" : "");
    item.dataset.requestId = request.id;

    const top = document.createElement("div");
    top.className = "request-item__top";

    const methodBadge = document.createElement("span");
    methodBadge.className = methodBadgeClass(request.method);
    methodBadge.textContent = request.method;

    const statusBadge = document.createElement("span");
    statusBadge.className = statusBadgeClass(request.status, Boolean(request.error));
    statusBadge.textContent = request.error ? "ERR" : request.status !== null ? String(request.status) : "…";

    const time = document.createElement("span");
    time.className = "request-item__time";
    time.textContent = formatClockTime(request.timestamp);

    top.appendChild(methodBadge);
    top.appendChild(statusBadge);
    if (isApiRequest(request)) {
      const apiBadge = document.createElement("span");
      apiBadge.className = "badge badge--api";
      apiBadge.textContent = "API";
      top.appendChild(apiBadge);
    }
    top.appendChild(time);

    const urlLine = document.createElement("div");
    urlLine.className = "request-item__url";
    urlLine.textContent = request.url;
    urlLine.title = request.url;

    item.appendChild(top);
    item.appendChild(urlLine);
    item.addEventListener("click", () => selectRequest(request.id));
    fragment.appendChild(item);
  }
  el.requestList.appendChild(fragment);
}

function selectRequest(id: string): void {
  selectedRequestId = id;
  requestBodyView = "pretty";
  responseBodyView = "pretty";
  renderList();
  renderDetail();
}

function renderDetail(): void {
  const request = getRequestById(selectedRequestId);
  if (!request) {
    el.detailEmpty.classList.remove("hidden");
    el.detailContent.classList.add("hidden");
    return;
  }
  el.detailEmpty.classList.add("hidden");
  el.detailContent.classList.remove("hidden");
  renderDetailTabBody(request);
}

function renderDetailTabBody(request: NetworkRequestRecord): void {
  el.detailTabs.querySelectorAll(".detail-tab").forEach((tabEl) => {
    tabEl.classList.toggle("active", (tabEl as HTMLElement).dataset.tab === activeDetailTab);
  });

  const reveal = settings?.showSecrets ?? false;

  switch (activeDetailTab) {
    case "overview":
      el.detailBody.innerHTML = renderOverviewHtml(request);
      break;
    case "headers":
      renderHeadersTab(request, reveal);
      return;
    case "query":
      el.detailBody.innerHTML = renderQueryHtml(request, reveal);
      break;
    case "request":
      renderRequestTab(request, reveal);
      return;
    case "response":
      renderResponseTab(request, reveal);
      return;
    case "timing":
      el.detailBody.innerHTML = renderTimingHtml(request);
      break;
    default:
      el.detailBody.innerHTML = "";
  }
}

function renderOverviewHtml(request: NetworkRequestRecord): string {
  const rows: [string, string][] = [
    ["Method", escapeHtml(request.method)],
    ["URL", escapeHtml(request.url)],
    ["Status", request.status !== null ? String(request.status) : "—"],
    ["Status text", escapeHtml(request.statusText ?? "—")],
    ["Remote host", escapeHtml(request.hostname)],
    ["MIME type", escapeHtml(request.mimeType ?? "—")],
    ["Timestamp", new Date(request.timestamp).toLocaleString("ru-RU")],
    ["Resource type", escapeHtml(request.resourceType)]
  ];
  let redirectHtml = "";
  if (request.redirectChain.length > 0) {
    const hops = request.redirectChain
      .map((hop) => `${hop.status} → ${escapeHtml(hop.url)}`)
      .join("<br />");
    redirectHtml = `<div class="redirect-chain"><strong>Redirect chain</strong><br />${hops}<br />${request.status ?? "…"} → ${escapeHtml(request.url)}</div>`;
  }
  let errorHtml = "";
  if (request.error) {
    errorHtml = `<div class="error-note">Request failed<br />Error: ${escapeHtml(request.error.errorText)}${request.error.canceled ? " (canceled)" : ""}</div>`;
  }
  const tableRows = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  return `${redirectHtml}${errorHtml}<table class="kv-table">${tableRows}</table>`;
}

function headersSectionHtml(title: string, headers: HeaderEntry[]): HTMLElement {
  const wrap = document.createElement("div");
  const heading = document.createElement("div");
  heading.className = "section-title";
  heading.textContent = title;
  wrap.appendChild(heading);

  if (headers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "binary-note";
    empty.textContent = "Нет заголовков";
    wrap.appendChild(empty);
    return wrap;
  }

  for (const header of headers) {
    const row = document.createElement("div");
    row.className = "header-row";

    const name = document.createElement("div");
    name.className = "header-row__name";
    name.textContent = header.name;

    const value = document.createElement("div");
    value.className = "header-row__value";
    value.textContent = header.value;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Копировать";
    copyBtn.addEventListener("click", () => {
      void copyToClipboard(`${header.name}: ${header.value}`);
    });

    row.appendChild(name);
    row.appendChild(value);
    row.appendChild(copyBtn);
    wrap.appendChild(row);
  }
  return wrap;
}

function renderHeadersTab(request: NetworkRequestRecord, reveal: boolean): void {
  el.detailBody.innerHTML = "";
  const reqHeaders = maskHeadersForDisplay(request.requestHeaders, reveal);
  const resHeaders = maskHeadersForDisplay(request.responseHeaders, reveal);
  el.detailBody.appendChild(headersSectionHtml("Request Headers", reqHeaders));
  el.detailBody.appendChild(headersSectionHtml("Response Headers", resHeaders));
}

function renderQueryHtml(request: NetworkRequestRecord, reveal: boolean): string {
  const entries = Object.entries(maskQueryParams(request.query, reveal));
  if (entries.length === 0) {
    return `<div class="binary-note">Нет query parameters</div>`;
  }
  const rows = entries
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<table class="kv-table">${rows}</table>`;
}

function renderJsonViewer(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);
  if (value === null) {
    return `<span class="json-null">null</span>`;
  }
  if (typeof value === "string") {
    return `<span class="json-string">${escapeHtml(JSON.stringify(value))}</span>`;
  }
  if (typeof value === "number") {
    return `<span class="json-number">${value}</span>`;
  }
  if (typeof value === "boolean") {
    return `<span class="json-boolean">${value}</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map((item) => `${padInner}${renderJsonViewer(item, indent + 1)}`).join(",\n");
    return `[\n${items}\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    const items = entries
      .map(
        ([k, v]) =>
          `${padInner}<span class="json-key">${escapeHtml(JSON.stringify(k))}</span>: ${renderJsonViewer(v, indent + 1)}`
      )
      .join(",\n");
    return `{\n${items}\n${pad}}`;
  }
  return String(value);
}

function bodyToolbarHtml(prefix: string, view: "pretty" | "raw"): string {
  return `<div class="body-toolbar">
    <button class="btn btn--small" data-action="${prefix}-copy" type="button">Copy</button>
    <button class="btn btn--small" data-action="${prefix}-download" type="button">Download</button>
    <button class="btn btn--small${view === "pretty" ? " is-active" : ""}" data-action="${prefix}-pretty" type="button">Pretty</button>
    <button class="btn btn--small${view === "raw" ? " is-active" : ""}" data-action="${prefix}-raw" type="button">Raw</button>
  </div>`;
}

let requestBodyView: "pretty" | "raw" = "pretty";
let responseBodyView: "pretty" | "raw" = "pretty";

function renderRequestTab(request: NetworkRequestRecord, reveal: boolean): void {
  const body = request.requestBody;
  if (body.kind === "none" || !body.raw) {
    el.detailBody.innerHTML = `<div class="binary-note">Тело запроса отсутствует</div>`;
    return;
  }

  let content = "";
  if (body.kind === "json" && body.json !== null) {
    const masked = maskJsonForDisplay(body.json, reveal);
    content =
      requestBodyView === "pretty"
        ? renderJsonViewer(masked)
        : escapeHtml(JSON.stringify(masked));
  } else {
    content = escapeHtml(body.raw);
  }

  const kindLabel = body.kind === "json" ? "JSON" : body.kind === "form" ? "Form Data" : "Raw";
  el.detailBody.innerHTML = `
    <div class="section-title">${kindLabel} · ${formatBytes(body.size)}</div>
    ${body.kind === "json" ? bodyToolbarHtml("req-body", requestBodyView) : `<div class="body-toolbar"><button class="btn btn--small" data-action="req-body-copy" type="button">Copy body</button></div>`}
    <pre class="code-block">${content}</pre>
  `;
}

function renderResponseTab(request: NetworkRequestRecord, reveal: boolean): void {
  const body = request.responseBody;

  if (request.error) {
    el.detailBody.innerHTML = `<div class="error-note">Request failed<br />Error: ${escapeHtml(request.error.errorText)}</div>`;
    return;
  }

  if (!body.available) {
    el.detailBody.innerHTML = `<div class="binary-note">${escapeHtml(body.reason ?? "Response body недоступен")}</div>`;
    return;
  }

  if (body.isBinary) {
    el.detailBody.innerHTML = `
      <div class="binary-note">Binary response<br />Size: ${formatBytes(body.size)}</div>
      <div class="body-toolbar"><button class="btn btn--small" data-action="res-body-download-binary" type="button">Download</button></div>
    `;
    return;
  }

  const text = body.text ?? "";
  const jsonParse = tryParseForView(text);
  let content: string;

  if (jsonParse.ok) {
    const masked = maskJsonForDisplay(jsonParse.value, reveal);
    content =
      responseBodyView === "pretty" ? renderJsonViewer(masked) : escapeHtml(JSON.stringify(masked));
  } else {
    content = escapeHtml(text);
  }

  el.detailBody.innerHTML = `
    <div class="section-title">${escapeHtml(request.contentType ?? request.mimeType ?? "text")} · ${formatBytes(body.size)}</div>
    ${jsonParse.ok ? bodyToolbarHtml("res-body", responseBodyView) : `<div class="body-toolbar"><button class="btn btn--small" data-action="res-body-copy" type="button">Copy</button><button class="btn btn--small" data-action="res-body-download" type="button">Download</button></div>`}
    <pre class="code-block">${content}</pre>
  `;
}

function tryParseForView(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function renderTimingHtml(request: NetworkRequestRecord): string {
  if (!request.timing) {
    return `<div class="binary-note">Timing недоступен</div>`;
  }
  const rows: [string, string][] = [
    ["Request time", String(request.timing.requestTime)],
    ["Duration", request.timing.durationMs !== null ? `${request.timing.durationMs} ms` : "—"],
    ["Finished", request.timing.finishedTime ? new Date(request.timing.finishedTime).toLocaleTimeString("ru-RU") : "—"]
  ];
  const tableRows = rows.map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(v)}</td></tr>`).join("");
  return `<table class="kv-table">${tableRows}</table>`;
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

function downloadBase64(filename: string, base64: string, mime: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

function dateForFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function requestToTxt(request: NetworkRequestRecord, reveal: boolean): string {
  const r = sanitizeRequestForExport(request, reveal);
  const lines: string[] = [];
  lines.push(`${r.method} ${r.url}`);
  lines.push(`Status: ${r.status ?? "-"} ${r.statusText ?? ""}`);
  lines.push(`Time: ${new Date(r.timestamp).toLocaleString("ru-RU")}`);
  lines.push("");
  lines.push("Request Headers:");
  for (const h of r.requestHeaders) {
    lines.push(`  ${h.name}: ${h.value}`);
  }
  lines.push("");
  lines.push("Response Headers:");
  for (const h of r.responseHeaders) {
    lines.push(`  ${h.name}: ${h.value}`);
  }
  if (r.requestBody.raw) {
    lines.push("");
    lines.push("Request Body:");
    lines.push(r.requestBody.raw);
  }
  if (r.responseBody.text) {
    lines.push("");
    lines.push("Response Body:");
    lines.push(r.responseBody.text);
  }
  lines.push("");
  return lines.join("\n");
}

function isSecretsRevealed(): boolean {
  return settings?.showSecrets ?? false;
}

function maskedJsonText(raw: unknown, reveal: boolean): string {
  return JSON.stringify(maskJsonForDisplay(raw, reveal), null, 2);
}

function sanitizeRequestForExport(request: NetworkRequestRecord, reveal: boolean): NetworkRequestRecord {
  if (reveal) {
    return request;
  }

  const sanitized: NetworkRequestRecord = {
    ...request,
    url: maskUrlForDisplay(request.url, false),
    query: maskQueryParams(request.query, false),
    requestHeaders: maskHeadersForDisplay(request.requestHeaders, false),
    responseHeaders: maskHeadersForDisplay(request.responseHeaders, false),
    requestBody: { ...request.requestBody },
    responseBody: { ...request.responseBody }
  };

  if (request.requestBody.kind === "json" && request.requestBody.json !== null) {
    const maskedText = maskedJsonText(request.requestBody.json, false);
    sanitized.requestBody = {
      ...request.requestBody,
      raw: maskedText,
      json: maskJsonForDisplay(request.requestBody.json, false)
    };
  }

  if (request.responseBody.available && !request.responseBody.isBinary && request.responseBody.text) {
    const parsed = tryParseForView(request.responseBody.text);
    if (parsed.ok) {
      sanitized.responseBody = { ...request.responseBody, text: maskedJsonText(parsed.value, false) };
    }
  }

  return sanitized;
}

function exportDump(items: NetworkRequestRecord[]): ExportedDump {
  const reveal = isSecretsRevealed();
  return {
    version: EXTENSION_VERSION,
    exportedAt: new Date().toISOString(),
    requests: items.map((item) => sanitizeRequestForExport(item, reveal))
  };
}

function renderChangelogList(): void {
  el.changelogList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const entry of CHANGELOG) {
    const item = document.createElement("div");
    item.className = "changelog-item" + (entry.version === selectedChangelogVersion ? " active" : "");

    const label = document.createElement("div");
    label.className = "changelog-item__label";
    label.textContent = entry.shortLabel;

    const version = document.createElement("div");
    version.className = "changelog-item__version";
    version.textContent = `v${entry.version}`;

    const date = document.createElement("div");
    date.className = "changelog-item__date";
    date.textContent = entry.date;

    item.appendChild(label);
    item.appendChild(version);
    item.appendChild(date);
    item.addEventListener("click", () => {
      selectedChangelogVersion = entry.version;
      renderChangelogList();
      renderChangelogDetail();
    });
    fragment.appendChild(item);
  }
  el.changelogList.appendChild(fragment);
}

function renderChangelogDetail(): void {
  const entry = CHANGELOG.find((e) => e.version === selectedChangelogVersion) ?? CHANGELOG[0];
  const items = entry.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("");
  el.changelogDetail.innerHTML = `
    <div class="changelog-detail__title">${escapeHtml(entry.title)}</div>
    <div class="changelog-detail__date">${escapeHtml(entry.date)}</div>
    <ul class="changelog-detail__list">${items}</ul>
  `;
}

function openChangelog(): void {
  el.workspace.classList.add("hidden");
  el.filters.classList.add("hidden");
  el.changelogView.classList.remove("hidden");
  renderChangelogList();
  renderChangelogDetail();
}

function closeChangelog(): void {
  el.changelogView.classList.add("hidden");
  el.workspace.classList.remove("hidden");
  el.filters.classList.remove("hidden");
}

function updateRecordingUi(recording: boolean, count: number): void {
  el.statusDot.classList.toggle("recording", recording);
  el.statusText.textContent = recording ? "Запись активна" : "Остановлено";
  el.btnRecord.disabled = recording;
  el.btnStop.disabled = !recording;
  void count;
}

async function refreshRequests(): Promise<void> {
  if (currentTabId === null) {
    return;
  }
  const response = await sendMessage({ type: "GET_REQUESTS", tabId: currentTabId });
  if (response.ok && "requests" in response) {
    requests = response.requests;
    renderList();
    renderDetail();
  }
}

async function init(): Promise<void> {
  const tabResponse = await sendMessage({ type: "GET_ACTIVE_TAB_STATE" });
  if (!tabResponse.ok || !("state" in tabResponse)) {
    return;
  }
  currentTabId = tabResponse.state.tabId;
  updateRecordingUi(tabResponse.state.recording, tabResponse.state.requestCount);

  const settingsResponse = await sendMessage({ type: "GET_SETTINGS" });
  if (settingsResponse.ok && "settings" in settingsResponse) {
    settings = settingsResponse.settings;
    applySettingsToUi(settings);
    if (!settings.debuggerNoticeShown) {
      el.debuggerNotice.classList.remove("hidden");
    }
  }

  await refreshRequests();
}

function applySettingsToUi(s: ExtensionSettings): void {
  el.settingAutoMode.checked = s.autoMode;
  el.settingOverlayEnabled.checked = s.overlayEnabled;
  el.settingOverlayMinimal.checked = s.overlayMinimal;
  el.settingShowSecrets.checked = s.showSecrets;
}

function enableHorizontalScroll(el: HTMLElement): void {
  let isDown = false;
  let moved = false;
  let startX = 0;
  let scrollStart = 0;

  el.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY === 0 && event.deltaX === 0) {
        return;
      }
      el.scrollLeft += Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      event.preventDefault();
    },
    { passive: false }
  );

  el.addEventListener("mousedown", (event) => {
    isDown = true;
    moved = false;
    startX = event.pageX;
    scrollStart = el.scrollLeft;
  });

  window.addEventListener("mousemove", (event) => {
    if (!isDown) {
      return;
    }
    const delta = event.pageX - startX;
    if (Math.abs(delta) > 3) {
      moved = true;
    }
    el.scrollLeft = scrollStart - delta;
  });

  window.addEventListener("mouseup", () => {
    isDown = false;
  });

  el.addEventListener(
    "click",
    (event) => {
      if (moved) {
        event.stopPropagation();
        event.preventDefault();
        moved = false;
      }
    },
    true
  );
}

function setupEventListeners(): void {
  enableHorizontalScroll(el.detailTabs);
  enableHorizontalScroll(el.detailActions);

  document.addEventListener(
    "wheel",
    (event) => {
      if (document.documentElement.scrollWidth <= window.innerWidth) {
        return;
      }
      if (event.deltaY === 0 && event.deltaX === 0) {
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "#detail-tabs, #detail-actions, .request-list, .detail-body, .changelog-list, .changelog-detail, pre.code-block, select"
        )
      ) {
        return;
      }
      window.scrollBy({ left: Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX });
      event.preventDefault();
    },
    { passive: false }
  );

  el.btnRecord.addEventListener("click", async () => {
    if (currentTabId === null) return;
    const response = await sendMessage({ type: "START_RECORDING", tabId: currentTabId });
    if (response.ok && "state" in response) {
      updateRecordingUi(response.state.recording, response.state.requestCount);
    }
    if (settings && !settings.debuggerNoticeShown) {
      await sendMessage({ type: "UPDATE_SETTINGS", settings: { debuggerNoticeShown: true } });
      settings.debuggerNoticeShown = true;
      el.debuggerNotice.classList.add("hidden");
    }
  });

  el.btnStop.addEventListener("click", async () => {
    if (currentTabId === null) return;
    const response = await sendMessage({ type: "STOP_RECORDING", tabId: currentTabId });
    if (response.ok && "state" in response) {
      updateRecordingUi(response.state.recording, response.state.requestCount);
    }
  });

  el.btnClear.addEventListener("click", async () => {
    if (currentTabId === null) return;
    await sendMessage({ type: "CLEAR_REQUESTS", tabId: currentTabId });
    requests = [];
    selectedRequestId = null;
    renderList();
    renderDetail();
  });

  el.noticeDismiss.addEventListener("click", async () => {
    el.debuggerNotice.classList.add("hidden");
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { debuggerNoticeShown: true } });
    if (settings) {
      settings.debuggerNoticeShown = true;
    }
  });

  el.btnDownload.addEventListener("click", () => {
    el.downloadMenu.classList.toggle("hidden");
  });

  el.btnSettings.addEventListener("click", () => {
    el.settingsPanel.classList.toggle("hidden");
  });

  el.btnChangelog.addEventListener("click", () => {
    openChangelog();
  });

  el.changelogBack.addEventListener("click", () => {
    closeChangelog();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!el.btnDownload.contains(target) && !el.downloadMenu.contains(target)) {
      el.downloadMenu.classList.add("hidden");
    }
    if (!target.closest(".dropdown")) {
      el.curlMenu.classList.add("hidden");
    }
  });

  el.downloadMenu.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = target?.dataset.action;
    if (!action) return;
    el.downloadMenu.classList.add("hidden");
    const date = dateForFilename();

    if (action === "download-json-all") {
      const dump = exportDump(requests);
      downloadBlob(`network-dump-${date}.json`, JSON.stringify(dump, null, 2), "application/json");
    } else if (action === "download-txt-all") {
      const text = requests.map((r) => requestToTxt(r, isSecretsRevealed())).join("\n---\n\n");
      downloadBlob(`network-dump-${date}.txt`, text, "text/plain");
    } else if (action === "download-json-selected") {
      const request = getRequestById(selectedRequestId);
      if (!request) return;
      const dump = exportDump([request]);
      downloadBlob(`request-${date}.json`, JSON.stringify(dump, null, 2), "application/json");
    }
  });

  el.settingAutoMode.addEventListener("change", async () => {
    const autoMode = el.settingAutoMode.checked;
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { autoMode } });
    if (autoMode && currentTabId !== null) {
      const response = await sendMessage({ type: "START_RECORDING", tabId: currentTabId });
      if (response.ok && "state" in response) {
        updateRecordingUi(response.state.recording, response.state.requestCount);
      }
    }
  });
  el.settingOverlayEnabled.addEventListener("change", async () => {
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { overlayEnabled: el.settingOverlayEnabled.checked } });
  });
  el.settingOverlayMinimal.addEventListener("change", async () => {
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { overlayMinimal: el.settingOverlayMinimal.checked } });
  });
  el.settingShowSecrets.addEventListener("change", async () => {
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { showSecrets: el.settingShowSecrets.checked } });
    if (settings) {
      settings.showSecrets = el.settingShowSecrets.checked;
    }
    renderDetail();
  });

  el.searchInput.addEventListener("input", () => {
    searchQuery = el.searchInput.value;
    renderList();
  });

  el.methodFilterSelect.addEventListener("change", () => {
    methodFilter = el.methodFilterSelect.value as MethodFilter;
    renderList();
  });

  el.urlFilterInput.addEventListener("input", () => {
    urlFilter = el.urlFilterInput.value;
    renderList();
  });

  el.apiOnlyToggle.addEventListener("click", () => {
    apiOnly = !apiOnly;
    el.apiOnlyToggle.classList.toggle("active", apiOnly);
    renderList();
  });

  el.detailTabs.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    const tab = target?.dataset.tab;
    if (!tab) return;
    activeDetailTab = tab;
    requestBodyView = "pretty";
    responseBodyView = "pretty";
    renderDetail();
  });

  el.detailActions.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = target?.dataset.action;
    if (!action) return;
    const request = getRequestById(selectedRequestId);
    if (!request) return;

    if (action === "copy-url") {
      await copyToClipboard(maskUrlForDisplay(request.url, isSecretsRevealed()));
    } else if (action === "curl-menu") {
      el.curlMenu.classList.toggle("hidden");
    } else if (action === "copy-fetch") {
      await copyToClipboard(generateFetch(request));
    }
  });

  el.curlMenu.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = target?.dataset.action;
    const request = getRequestById(selectedRequestId);
    if (!request || !action) return;
    if (action === "copy-curl-unix") {
      await copyToClipboard(generateCurl(request, "unix"));
    } else if (action === "copy-curl-windows") {
      await copyToClipboard(generateCurl(request, "windows"));
    }
    el.curlMenu.classList.add("hidden");
  });

  el.detailBody.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = target?.dataset.action;
    if (!action) return;
    const request = getRequestById(selectedRequestId);
    if (!request) return;

    if (action === "req-body-copy") {
      const reveal = isSecretsRevealed();
      const text =
        request.requestBody.kind === "json" && request.requestBody.json !== null
          ? maskedJsonText(request.requestBody.json, reveal)
          : request.requestBody.raw ?? "";
      await copyToClipboard(text);
    } else if (action === "req-body-download") {
      const reveal = isSecretsRevealed();
      const isJson = request.requestBody.kind === "json" && request.requestBody.json !== null;
      const text = isJson ? maskedJsonText(request.requestBody.json, reveal) : request.requestBody.raw ?? "";
      downloadBlob(`request-body-${dateForFilename()}.${isJson ? "json" : "txt"}`, text, "text/plain");
    } else if (action === "req-body-pretty") {
      requestBodyView = "pretty";
      renderDetailTabBody(request);
    } else if (action === "req-body-raw") {
      requestBodyView = "raw";
      renderDetailTabBody(request);
    } else if (action === "res-body-copy") {
      const reveal = isSecretsRevealed();
      const parsed = request.responseBody.text ? tryParseForView(request.responseBody.text) : { ok: false, value: null };
      const text = parsed.ok ? maskedJsonText(parsed.value, reveal) : request.responseBody.text ?? "";
      await copyToClipboard(text);
    } else if (action === "res-body-download") {
      const reveal = isSecretsRevealed();
      const parsed = request.responseBody.text ? tryParseForView(request.responseBody.text) : { ok: false, value: null };
      const text = parsed.ok ? maskedJsonText(parsed.value, reveal) : request.responseBody.text ?? "";
      const ext = guessExtension(request.contentType ?? request.mimeType);
      downloadBlob(`response-body-${dateForFilename()}.${ext}`, text, "text/plain");
    } else if (action === "res-body-download-binary") {
      if (request.responseBody.encoding === "base64" && request.responseBody.text) {
        const ext = guessExtension(request.contentType ?? request.mimeType);
        downloadBase64(
          `response-body-${dateForFilename()}.${ext}`,
          request.responseBody.text,
          request.mimeType ?? "application/octet-stream"
        );
      }
    } else if (action === "res-body-pretty") {
      responseBodyView = "pretty";
      renderDetailTabBody(request);
    } else if (action === "res-body-raw") {
      responseBodyView = "raw";
      renderDetailTabBody(request);
    }
  });
}

function guessExtension(contentType: string | null): string {
  if (!contentType) return "txt";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("xml")) return "xml";
  if (contentType.includes("css")) return "css";
  if (contentType.includes("javascript")) return "js";
  return "txt";
}

function handleBroadcast(message: BroadcastMessage): void {
  if (currentTabId === null || !("tabId" in message) || message.tabId !== currentTabId) {
    return;
  }

  if (message.type === "NEW_REQUEST") {
    const alreadyExists = requests.some((r) => r.id === message.request.id);
    if (!alreadyExists) {
      requests.push(message.request);
      renderList();
    }
  } else if (message.type === "REQUEST_UPDATED") {
    const index = requests.findIndex((r) => r.id === message.request.id);
    if (index >= 0) {
      requests[index] = message.request;
    }
    renderList();
    if (selectedRequestId === message.request.id) {
      renderDetail();
    }
  } else if (message.type === "RECORDING_STATE_CHANGED") {
    updateRecordingUi(message.recording, message.requestCount);
  } else if (message.type === "REQUESTS_CLEARED") {
    requests = [];
    selectedRequestId = null;
    renderList();
    renderDetail();
  }
}

setupEventListeners();

chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
  handleBroadcast(message);
});

void init();
