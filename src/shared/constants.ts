export const EXTENSION_VERSION = "1.1.3";
export const EXTENSION_NAME = "Network Monitor";
export const EXTENSION_AUTHOR = "Telegram @sequencedev";

export const HTTP_METHODS: string[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
];

export const MAX_REQUESTS_PER_TAB = 2000;
export const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;

export const SECRET_KEY_PATTERNS: string[] = [
  "key",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "session",
  "sessionid",
  "session_id",
  "cookie",
  "password",
  "secret",
  "api_key",
  "apikey",
  "proxy-authorization"
];

export const SECRET_HEADER_NAMES: string[] = [
  "cookie",
  "authorization",
  "proxy-authorization",
  "set-cookie"
];

export const MASK_PLACEHOLDER = "********";
export const REMOVED_HEADER_PLACEHOLDER = "SECRET_HEADER_REMOVED";

export const BINARY_MIME_PREFIXES: string[] = [
  "image/",
  "audio/",
  "video/",
  "font/",
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/x-",
  "application/vnd."
];

export const TEXTUAL_MIME_TYPES: string[] = [
  "application/json",
  "text/",
  "application/javascript",
  "application/xml",
  "application/xhtml+xml",
  "image/svg+xml"
];

export const STORAGE_KEY_SETTINGS = "networkMonitorSettings";
