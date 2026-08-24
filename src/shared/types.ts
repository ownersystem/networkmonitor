export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type MethodFilter = "ALL" | HttpMethod;

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface TimingInfo {
  requestTime: number;
  responseTime: number | null;
  finishedTime: number | null;
  durationMs: number | null;
}

export interface RedirectHop {
  url: string;
  status: number;
  timestamp: number;
}

export type RequestBodyKind = "json" | "form" | "raw" | "none";

export interface RequestBodyInfo {
  kind: RequestBodyKind;
  raw: string | null;
  json: unknown | null;
  size: number | null;
}

export type BodyEncoding = "text" | "base64";

export interface ResponseBodyInfo {
  available: boolean;
  reason: string | null;
  isBinary: boolean;
  size: number | null;
  truncated: boolean;
  encoding: BodyEncoding | null;
  text: string | null;
}

export interface NetworkErrorInfo {
  errorText: string;
  canceled: boolean;
}

export interface NetworkRequestRecord {
  id: string;
  tabId: number;
  cdpRequestId: string;
  method: string;
  url: string;
  hostname: string;
  pathname: string;
  query: Record<string, string>;
  timestamp: number;
  requestHeaders: HeaderEntry[];
  requestBody: RequestBodyInfo;
  initiator: string | null;
  resourceType: string;
  status: number | null;
  statusText: string | null;
  responseHeaders: HeaderEntry[];
  mimeType: string | null;
  responseBody: ResponseBodyInfo;
  contentType: string | null;
  timing: TimingInfo | null;
  error: NetworkErrorInfo | null;
  redirectChain: RedirectHop[];
  finished: boolean;
}

export interface TabRecordingSummary {
  tabId: number;
  recording: boolean;
  requestCount: number;
  url: string | null;
  title: string | null;
}

export interface ExtensionSettings {
  overlayEnabled: boolean;
  overlayMinimal: boolean;
  methodFilter: MethodFilter;
  urlFilter: string;
  showSecrets: boolean;
  maxRequests: number;
  version: string;
  debuggerNoticeShown: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  overlayEnabled: true,
  overlayMinimal: false,
  methodFilter: "ALL",
  urlFilter: "",
  showSecrets: false,
  maxRequests: 2000,
  version: "1.1.3",
  debuggerNoticeShown: false
};

export type RuntimeMessage =
  | { type: "START_RECORDING"; tabId: number }
  | { type: "STOP_RECORDING"; tabId: number }
  | { type: "CLEAR_REQUESTS"; tabId: number }
  | { type: "GET_TAB_STATE"; tabId: number }
  | { type: "GET_REQUESTS"; tabId: number }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "GET_ACTIVE_TAB_STATE" }
  | { type: "OVERLAY_QUERY" };

export type RuntimeMessageResponse =
  | { ok: true; state: TabRecordingSummary }
  | { ok: true; requests: NetworkRequestRecord[] }
  | { ok: true; settings: ExtensionSettings }
  | { ok: true; state: TabRecordingSummary; settings: ExtensionSettings }
  | { ok: true }
  | { ok: false; error: string };

export type BroadcastMessage =
  | { type: "NEW_REQUEST"; tabId: number; request: NetworkRequestRecord }
  | { type: "REQUEST_UPDATED"; tabId: number; request: NetworkRequestRecord }
  | { type: "RECORDING_STATE_CHANGED"; tabId: number; recording: boolean; requestCount: number }
  | { type: "REQUESTS_CLEARED"; tabId: number }
  | { type: "COUNT_UPDATED"; tabId: number; count: number };

export interface ExportedDump {
  version: string;
  exportedAt: string;
  requests: NetworkRequestRecord[];
}
