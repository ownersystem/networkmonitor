import { BINARY_MIME_PREFIXES, TEXTUAL_MIME_TYPES } from "./constants";

export function generateId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${time}-${rand}`;
}

export interface ParsedUrl {
  hostname: string;
  pathname: string;
  query: Record<string, string>;
}

export function parseRequestUrl(url: string): ParsedUrl {
  try {
    const parsed = new URL(url);
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    return {
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      query
    };
  } catch {
    return { hostname: "", pathname: url, query: {} };
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatClockTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function formatDateForFilename(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}-${hh}-${mm}-${ss}`;
}

export function tryParseJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export function detectRequestBodyKind(
  contentType: string | null,
  raw: string
): "json" | "form" | "raw" | "none" {
  if (!raw) {
    return "none";
  }
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    return "json";
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    return "form";
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJson(trimmed);
    if (parsed.ok) {
      return "json";
    }
  }
  return "raw";
}

export function isBinaryMime(mime: string | null): boolean {
  if (!mime) {
    return false;
  }
  const lower = mime.toLowerCase();
  const isTextual = TEXTUAL_MIME_TYPES.some((prefix) => lower.startsWith(prefix));
  if (isTextual) {
    return false;
  }
  return BINARY_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function headerValue(headers: { name: string; value: string }[], name: string): string | null {
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : null;
}

export function statusCategory(status: number | null): "2xx" | "3xx" | "4xx" | "5xx" | "pending" | "error" {
  if (status === null) {
    return "pending";
  }
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500) return "5xx";
  return "error";
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function byteLengthOfBase64(base64: string): number {
  const padding = (base64.match(/=+$/) ?? [""])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}
