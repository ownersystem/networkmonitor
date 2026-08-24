import {
  attachDebugger,
  detachDebugger,
  getResponseBody,
  onCdpDetach,
  onCdpEvent
} from "./debugger";
import { checkBodySize, safeLog, safeWarn } from "./security";
import { MAX_REQUESTS_PER_TAB } from "../shared/constants";
import type {
  BroadcastMessage,
  HeaderEntry,
  NetworkRequestRecord,
  RequestBodyInfo,
  TabRecordingSummary
} from "../shared/types";
import {
  base64ToUtf8,
  byteLengthOfBase64,
  detectRequestBodyKind,
  generateId,
  headerValue,
  isBinaryMime,
  parseRequestUrl,
  tryParseJson
} from "../shared/utils";

interface TabState {
  tabId: number;
  recording: boolean;
  requests: NetworkRequestRecord[];
  byCdpId: Map<string, NetworkRequestRecord>;
  requestTimings: Map<string, number>;
}

const tabStates = new Map<number, TabState>();

function ensureState(tabId: number): TabState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = {
      tabId,
      recording: false,
      requests: [],
      byCdpId: new Map(),
      requestTimings: new Map()
    };
    tabStates.set(tabId, state);
  }
  return state;
}

function objectToHeaderEntries(headers: Record<string, string> | undefined): HeaderEntry[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function describeInitiator(initiator: unknown): string | null {
  if (!initiator || typeof initiator !== "object") {
    return null;
  }
  const init = initiator as { type?: string; url?: string; lineNumber?: number };
  if (init.url) {
    const line = typeof init.lineNumber === "number" ? `:${init.lineNumber}` : "";
    return `${init.type ?? "other"} (${init.url}${line})`;
  }
  return init.type ?? "other";
}

function buildRequestBodyInfo(postData: string | undefined, headers: HeaderEntry[]): RequestBodyInfo {
  if (!postData) {
    return { kind: "none", raw: null, json: null, size: null };
  }
  const contentType = headerValue(headers, "content-type");
  const kind = detectRequestBodyKind(contentType, postData);
  let json: unknown | null = null;
  if (kind === "json") {
    const parsed = tryParseJson(postData);
    json = parsed.ok ? parsed.value : null;
  }
  return {
    kind,
    raw: postData,
    json,
    size: new TextEncoder().encode(postData).length
  };
}

function emptyResponseBody(reason: string) {
  return {
    available: false,
    reason,
    isBinary: false,
    size: null,
    truncated: false,
    encoding: null,
    text: null
  };
}

function addRecord(state: TabState, record: NetworkRequestRecord): void {
  state.requests.push(record);
  state.byCdpId.set(record.cdpRequestId, record);
  if (state.requests.length > MAX_REQUESTS_PER_TAB) {
    const removed = state.requests.shift();
    if (removed && state.byCdpId.get(removed.cdpRequestId) === removed) {
      state.byCdpId.delete(removed.cdpRequestId);
    }
  }
}

let broadcaster: ((message: BroadcastMessage) => void) | null = null;
export function setBroadcaster(fn: (message: BroadcastMessage) => void): void {
  broadcaster = fn;
}

function broadcast(message: BroadcastMessage): void {
  if (broadcaster) {
    broadcaster(message);
  }
}

function handleRequestWillBeSent(tabId: number, params: Record<string, unknown>): void {
  const state = ensureState(tabId);
  if (!state.recording) {
    return;
  }
  const requestId = params.requestId as string;
  const requestData = params.request as {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    hasPostData?: boolean;
  };
  const parsedUrl = parseRequestUrl(requestData.url);
  const headers = objectToHeaderEntries(requestData.headers);
  const bodyInfo = buildRequestBodyInfo(requestData.postData, headers);
  const wallTime = params.wallTime as number | undefined;
  const timestamp = typeof wallTime === "number" ? wallTime * 1000 : Date.now();
  const resourceType = (params.type as string | undefined) ?? "Other";
  const initiator = describeInitiator(params.initiator);
  const redirectResponse = params.redirectResponse as
    | { status: number; url: string }
    | undefined;

  const existing = state.byCdpId.get(requestId);

  if (existing && redirectResponse) {
    existing.redirectChain.push({
      url: existing.url,
      status: redirectResponse.status,
      timestamp: Date.now()
    });
    existing.method = requestData.method;
    existing.url = requestData.url;
    existing.hostname = parsedUrl.hostname;
    existing.pathname = parsedUrl.pathname;
    existing.query = parsedUrl.query;
    existing.requestHeaders = headers;
    existing.requestBody = bodyInfo;
    existing.initiator = initiator;
    existing.resourceType = resourceType;
    existing.status = null;
    existing.statusText = null;
    existing.responseHeaders = [];
    existing.mimeType = null;
    existing.responseBody = emptyResponseBody("Ожидание ответа");
    existing.contentType = null;
    existing.finished = false;
    existing.error = null;
    broadcast({ type: "REQUEST_UPDATED", tabId, request: existing });
    return;
  }

  if (existing) {
    return;
  }

  const record: NetworkRequestRecord = {
    id: generateId(),
    tabId,
    cdpRequestId: requestId,
    method: requestData.method,
    url: requestData.url,
    hostname: parsedUrl.hostname,
    pathname: parsedUrl.pathname,
    query: parsedUrl.query,
    timestamp,
    requestHeaders: headers,
    requestBody: bodyInfo,
    initiator,
    resourceType,
    status: null,
    statusText: null,
    responseHeaders: [],
    mimeType: null,
    responseBody: emptyResponseBody("Ожидание ответа"),
    contentType: null,
    timing: null,
    error: null,
    redirectChain: [],
    finished: false
  };

  state.requestTimings.set(requestId, Date.now());
  addRecord(state, record);
  broadcast({ type: "NEW_REQUEST", tabId, request: record });
  broadcast({ type: "COUNT_UPDATED", tabId, count: state.requests.length });
}

function handleResponseReceived(tabId: number, params: Record<string, unknown>): void {
  const state = tabStates.get(tabId);
  if (!state || !state.recording) {
    return;
  }
  const requestId = params.requestId as string;
  const record = state.byCdpId.get(requestId);
  if (!record) {
    return;
  }
  const response = params.response as {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    timing?: { requestTime: number };
  };
  record.status = response.status;
  record.statusText = response.statusText;
  record.responseHeaders = objectToHeaderEntries(response.headers);
  record.mimeType = response.mimeType ?? null;
  record.contentType = headerValue(record.responseHeaders, "content-type") ?? record.mimeType;
  if (response.timing) {
    record.timing = {
      requestTime: response.timing.requestTime,
      responseTime: Date.now(),
      finishedTime: null,
      durationMs: null
    };
  }
  broadcast({ type: "REQUEST_UPDATED", tabId, request: record });
}

function isBodyFetchable(record: NetworkRequestRecord): boolean {
  if (record.method === "HEAD") {
    return false;
  }
  if (record.status === null) {
    return false;
  }
  if (record.status >= 300 && record.status < 400) {
    return false;
  }
  return true;
}

async function fetchResponseBody(tabId: number, record: NetworkRequestRecord): Promise<void> {
  if (!isBodyFetchable(record)) {
    record.responseBody = emptyResponseBody("Response body недоступен для этого запроса");
    return;
  }
  const result = await getResponseBody(tabId, record.cdpRequestId);
  if (!result) {
    record.responseBody = emptyResponseBody("Response body недоступен");
    return;
  }

  const sizeBytes = result.base64Encoded
    ? byteLengthOfBase64(result.body)
    : new TextEncoder().encode(result.body).length;

  const binary = isBinaryMime(record.mimeType) || (result.base64Encoded && isProbablyBinary(result.body));
  const { fits, limitBytes } = checkBodySize(sizeBytes);

  if (!fits) {
    record.responseBody = {
      available: false,
      reason: `Response body слишком большой (лимит ${Math.round(limitBytes / (1024 * 1024))} MB)`,
      isBinary: binary,
      size: sizeBytes,
      truncated: true,
      encoding: null,
      text: null
    };
    return;
  }

  if (binary) {
    record.responseBody = {
      available: true,
      reason: null,
      isBinary: true,
      size: sizeBytes,
      truncated: false,
      encoding: result.base64Encoded ? "base64" : "text",
      text: result.base64Encoded ? result.body : null
    };
    return;
  }

  let text: string;
  try {
    text = result.base64Encoded ? base64ToUtf8(result.body) : result.body;
  } catch {
    record.responseBody = {
      available: true,
      reason: null,
      isBinary: true,
      size: sizeBytes,
      truncated: false,
      encoding: "base64",
      text: null
    };
    return;
  }

  record.responseBody = {
    available: true,
    reason: null,
    isBinary: false,
    size: sizeBytes,
    truncated: false,
    encoding: "text",
    text
  };
}

function isProbablyBinary(base64Body: string): boolean {
  try {
    const sample = atob(base64Body.slice(0, 256));
    let controlChars = 0;
    for (let i = 0; i < sample.length; i += 1) {
      const code = sample.charCodeAt(i);
      if (code === 0) {
        return true;
      }
      if (code < 9 || (code > 13 && code < 32)) {
        controlChars += 1;
      }
    }
    return controlChars / Math.max(sample.length, 1) > 0.1;
  } catch {
    return true;
  }
}

async function handleLoadingFinished(tabId: number, params: Record<string, unknown>): Promise<void> {
  const state = tabStates.get(tabId);
  if (!state || !state.recording) {
    return;
  }
  const requestId = params.requestId as string;
  const record = state.byCdpId.get(requestId);
  if (!record) {
    return;
  }
  record.finished = true;
  if (record.timing) {
    const started = state.requestTimings.get(requestId) ?? Date.now();
    record.timing.finishedTime = Date.now();
    record.timing.durationMs = Date.now() - started;
  }
  await fetchResponseBody(tabId, record);
  broadcast({ type: "REQUEST_UPDATED", tabId, request: record });
}

function handleLoadingFailed(tabId: number, params: Record<string, unknown>): void {
  const state = tabStates.get(tabId);
  if (!state || !state.recording) {
    return;
  }
  const requestId = params.requestId as string;
  const record = state.byCdpId.get(requestId);
  if (!record) {
    return;
  }
  record.finished = true;
  record.error = {
    errorText: (params.errorText as string) ?? "ERR_FAILED",
    canceled: Boolean(params.canceled)
  };
  record.responseBody = emptyResponseBody("Request failed");
  broadcast({ type: "REQUEST_UPDATED", tabId, request: record });
}

onCdpEvent((tabId, method, params) => {
  const typedParams = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case "Network.requestWillBeSent":
      handleRequestWillBeSent(tabId, typedParams);
      break;
    case "Network.responseReceived":
      handleResponseReceived(tabId, typedParams);
      break;
    case "Network.loadingFinished":
      void handleLoadingFinished(tabId, typedParams);
      break;
    case "Network.loadingFailed":
      handleLoadingFailed(tabId, typedParams);
      break;
    default:
      break;
  }
});

const REATTACHABLE_REASONS = new Set(["target_closed", "replaced_with_devtools"]);

onCdpDetach((tabId, reason) => {
  const state = tabStates.get(tabId);
  if (!state) {
    return;
  }
  const wasRecording = state.recording;
  if (!wasRecording) {
    return;
  }

  if (REATTACHABLE_REASONS.has(reason)) {
    safeWarn(`Debugger отключен от вкладки ${tabId} (${reason}), пробуем переподключиться`);
    void attemptReattach(tabId, state);
    return;
  }

  state.recording = false;
  safeWarn(`Debugger отключен от вкладки ${tabId} (${reason}), запись остановлена`);
  broadcast({ type: "RECORDING_STATE_CHANGED", tabId, recording: false, requestCount: state.requests.length });
});

async function attemptReattach(tabId: number, state: TabState): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const attached = await attachDebugger(tabId);
  if (attached && state.recording) {
    safeLog(`Debugger переподключен к вкладке ${tabId}, запись продолжена`);
    return;
  }
  state.recording = false;
  safeWarn(`Не удалось переподключиться к вкладке ${tabId}, запись остановлена`);
  broadcast({ type: "RECORDING_STATE_CHANGED", tabId, recording: false, requestCount: state.requests.length });
}

export async function startRecording(tabId: number): Promise<TabRecordingSummary> {
  const state = ensureState(tabId);
  const attached = await attachDebugger(tabId);
  if (!attached) {
    return getSummary(tabId);
  }
  state.recording = true;
  safeLog(`Запись начата на вкладке ${tabId}`);
  broadcast({ type: "RECORDING_STATE_CHANGED", tabId, recording: true, requestCount: state.requests.length });
  return getSummary(tabId);
}

export async function stopRecording(tabId: number): Promise<TabRecordingSummary> {
  const state = ensureState(tabId);
  state.recording = false;
  await detachDebugger(tabId);
  safeLog(`Запись остановлена на вкладке ${tabId}`);
  broadcast({ type: "RECORDING_STATE_CHANGED", tabId, recording: false, requestCount: state.requests.length });
  return getSummary(tabId);
}

export function clearRequests(tabId: number): TabRecordingSummary {
  const state = ensureState(tabId);
  state.requests = [];
  state.byCdpId.clear();
  state.requestTimings.clear();
  broadcast({ type: "REQUESTS_CLEARED", tabId });
  return getSummary(tabId);
}

export function getRequests(tabId: number): NetworkRequestRecord[] {
  const state = tabStates.get(tabId);
  return state ? state.requests : [];
}

export function getSummary(tabId: number, url?: string | null, title?: string | null): TabRecordingSummary {
  const state = tabStates.get(tabId);
  return {
    tabId,
    recording: state ? state.recording : false,
    requestCount: state ? state.requests.length : 0,
    url: url ?? null,
    title: title ?? null
  };
}

export function cleanupTab(tabId: number): void {
  tabStates.delete(tabId);
  void detachDebugger(tabId);
}

export function isRecording(tabId: number): boolean {
  const state = tabStates.get(tabId);
  return state ? state.recording : false;
}
