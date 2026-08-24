import {
  MASK_PLACEHOLDER,
  REMOVED_HEADER_PLACEHOLDER,
  SECRET_HEADER_NAMES,
  SECRET_KEY_PATTERNS
} from "./constants";
import type { HeaderEntry } from "./types";

export function isSecretKeyName(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => lower === pattern || lower.includes(pattern));
}

export function isSecretHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_HEADER_NAMES.includes(lower);
}

export function maskQueryParams(
  query: Record<string, string>,
  reveal: boolean
): Record<string, string> {
  if (reveal) {
    return { ...query };
  }
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    masked[key] = isSecretKeyName(key) ? MASK_PLACEHOLDER : value;
  }
  return masked;
}

export function maskHeadersForDisplay(headers: HeaderEntry[], reveal: boolean): HeaderEntry[] {
  if (reveal) {
    return headers.map((h) => ({ ...h }));
  }
  return headers.map((h) =>
    isSecretHeaderName(h.name) || isSecretKeyName(h.name)
      ? { name: h.name, value: MASK_PLACEHOLDER }
      : { ...h }
  );
}

export function stripSecretHeadersForExport(headers: HeaderEntry[]): HeaderEntry[] {
  return headers.map((h) =>
    isSecretHeaderName(h.name) ? { name: h.name, value: REMOVED_HEADER_PLACEHOLDER } : { ...h }
  );
}

export function maskJsonForDisplay(value: unknown, reveal: boolean): unknown {
  if (reveal) {
    return value;
  }
  return maskJsonDeep(value);
}

function maskJsonDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskJsonDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKeyName(key) && (typeof val === "string" || typeof val === "number")) {
        result[key] = MASK_PLACEHOLDER;
      } else {
        result[key] = maskJsonDeep(val);
      }
    }
    return result;
  }
  return value;
}

export function containsLikelySecrets(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsLikelySecrets(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, val]) => isSecretKeyName(key) || containsLikelySecrets(val)
    );
  }
  return false;
}

export function maskUrlForDisplay(url: string, reveal: boolean): string {
  if (reveal) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if ([...parsed.searchParams.keys()].length === 0) {
      return url;
    }
    const masked = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      masked.append(key, isSecretKeyName(key) ? MASK_PLACEHOLDER : value);
    });
    parsed.search = masked.toString();
    return parsed.toString();
  } catch {
    return url;
  }
}
