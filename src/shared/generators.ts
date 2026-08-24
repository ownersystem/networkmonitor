import { stripSecretHeadersForExport } from "./sanitize";
import type { NetworkRequestRecord } from "./types";

function buildFullUrl(request: NetworkRequestRecord): string {
  return request.url;
}

export function generateCurl(
  request: NetworkRequestRecord,
  platform: "unix" | "windows"
): string {
  const headers = stripSecretHeadersForExport(request.requestHeaders);
  const lineBreak = platform === "windows" ? "^\n  " : " \\\n  ";
  const quote = platform === "windows" ? '"' : "'";

  const parts: string[] = [`curl -X ${request.method}`];
  parts.push(`${quote}${buildFullUrl(request)}${quote}`);

  for (const header of headers) {
    const value = header.value.replace(/'/g, "'\\''");
    parts.push(`-H ${quote}${header.name}: ${value}${quote}`);
  }

  if (request.requestBody.kind !== "none" && request.requestBody.raw) {
    const body = request.requestBody.raw.replace(/'/g, "'\\''");
    parts.push(`--data-raw ${quote}${body}${quote}`);
  }

  return parts.join(lineBreak);
}

export function generateFetch(request: NetworkRequestRecord): string {
  const headers = stripSecretHeadersForExport(request.requestHeaders).filter(
    (h) => !["host", "content-length", "connection"].includes(h.name.toLowerCase())
  );

  const headerLines = headers
    .map((h) => `    ${JSON.stringify(h.name)}: ${JSON.stringify(h.value)}`)
    .join(",\n");

  const options: string[] = [`  method: ${JSON.stringify(request.method)}`];

  if (headers.length > 0) {
    options.push(`  headers: {\n${headerLines}\n  }`);
  }

  if (request.requestBody.kind !== "none" && request.requestBody.raw) {
    options.push(`  body: ${JSON.stringify(request.requestBody.raw)}`);
  }

  return `fetch(${JSON.stringify(buildFullUrl(request))}, {\n${options.join(",\n")}\n})`;
}
