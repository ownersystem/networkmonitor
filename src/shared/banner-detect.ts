import {
  BANNER_ATTRIBUTE_KEYWORDS,
  BANNER_MAX_TEXT_LENGTH,
  BANNER_MIN_TEXT_LENGTH,
  BANNER_TEXT_KEYWORDS
} from "./constants";
import type { BannerValueHit } from "./types";

const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/g,
  /\b\d{1,2}\s+(январ[яь]|феврал[яь]|март[а]?|апрел[яь]|ма[йя]|июн[яь]|июл[яь]|август[а]?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])\b/gi,
  /\b(до|by|until|through)\s+\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{2,4})?\b/gi
];

const MULTIPLIER_PATTERN = /\b[xх]\s?\d(?:[.,]\d)?\b/gi;
const PERCENT_PATTERN = /\b\d{1,3}\s?%/g;
const COUNTDOWN_PATTERN = /\b\d{1,3}\s?:\s?\d{2}\s?:\s?\d{2}\b/g;
const BANNER_ATTR_NAME_PATTERN = /date|time|expire|start|end|until|from|to|deadline/i;

export function elementText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function isLikelyBannerElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  if (el.id === "amazing-network-monitor-overlay-host") {
    return false;
  }
  const text = elementText(el);
  if (text.length < BANNER_MIN_TEXT_LENGTH || text.length > BANNER_MAX_TEXT_LENGTH) {
    return false;
  }
  const haystack = `${el.className} ${el.id} ${el.getAttribute("data-testid") ?? ""} ${el.getAttribute("role") ?? ""}`.toLowerCase();
  const attrHit = BANNER_ATTRIBUTE_KEYWORDS.some((keyword) => haystack.includes(keyword));
  const textLower = text.toLowerCase();
  const textHit = BANNER_TEXT_KEYWORDS.some((keyword) => textLower.includes(keyword));
  if (!attrHit && !textHit) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 12) {
    return false;
  }
  return true;
}

export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.body && depth < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const cls = Array.from(node.classList).slice(0, 2).join(".");
    if (cls) {
      part += `.${cls}`;
    }
    parts.unshift(part);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}

export function buildFingerprint(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).sort().join(".");
  const id = (el as HTMLElement).id ?? "";
  const textSample = elementText(el).slice(0, 60);
  return `${tag}|${id}|${classes}|${textSample}`;
}

export function collectAttributes(el: Element): Record<string, string> {
  const result: Record<string, string> = {};
  if (!(el instanceof HTMLElement)) {
    return result;
  }
  for (const attr of Array.from(el.attributes)) {
    result[attr.name] = attr.value;
  }
  return result;
}

function pushUnique(hits: BannerValueHit[], hit: BannerValueHit): void {
  const exists = hits.some((h) => h.label === hit.label && h.value === hit.value);
  if (!exists) {
    hits.push(hit);
  }
}

export function extractValueHits(el: Element): BannerValueHit[] {
  const hits: BannerValueHit[] = [];
  const text = elementText(el);

  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      pushUnique(hits, { source: "text", label: "дата", value: match[0].trim() });
      match = pattern.exec(text);
    }
  }

  MULTIPLIER_PATTERN.lastIndex = 0;
  let multiplierMatch = MULTIPLIER_PATTERN.exec(text);
  while (multiplierMatch !== null) {
    pushUnique(hits, { source: "text", label: "множитель", value: multiplierMatch[0].trim() });
    multiplierMatch = MULTIPLIER_PATTERN.exec(text);
  }

  PERCENT_PATTERN.lastIndex = 0;
  let percentMatch = PERCENT_PATTERN.exec(text);
  while (percentMatch !== null) {
    pushUnique(hits, { source: "text", label: "процент", value: percentMatch[0].trim() });
    percentMatch = PERCENT_PATTERN.exec(text);
  }

  COUNTDOWN_PATTERN.lastIndex = 0;
  let countdownMatch = COUNTDOWN_PATTERN.exec(text);
  while (countdownMatch !== null) {
    pushUnique(hits, { source: "text", label: "таймер", value: countdownMatch[0].trim() });
    countdownMatch = COUNTDOWN_PATTERN.exec(text);
  }

  if (el instanceof HTMLElement) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("data-") && BANNER_ATTR_NAME_PATTERN.test(attr.name)) {
        pushUnique(hits, { source: "attribute", label: attr.name, value: attr.value });
      }
    }
  }

  return hits.slice(0, 24);
}
