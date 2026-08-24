import { MAX_RESPONSE_BODY_BYTES } from "../shared/constants";

export function safeLog(message: string): void {
  console.log(`[Network Monitor] ${message}`);
}

export function safeWarn(message: string): void {
  console.warn(`[Network Monitor] ${message}`);
}

export function safeError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : "";
  console.error(`[Network Monitor] ${message}${detail ? `: ${detail}` : ""}`);
}

export interface BodySizeCheckResult {
  fits: boolean;
  limitBytes: number;
}

export function checkBodySize(byteLength: number, limit: number = MAX_RESPONSE_BODY_BYTES): BodySizeCheckResult {
  return { fits: byteLength <= limit, limitBytes: limit };
}

export const NO_EXTERNAL_TRANSMISSION_POLICY =
  "Расширение не отправляет URL, заголовки, cookies или тела запросов на внешние серверы. Все данные обрабатываются локально в браузере.";
