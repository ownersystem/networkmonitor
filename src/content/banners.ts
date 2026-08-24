import {
  buildFingerprint,
  buildSelector,
  collectAttributes,
  elementText,
  extractValueHits,
  isLikelyBannerElement
} from "../shared/banner-detect";
import { BANNER_MUTATION_DEBOUNCE_MS, BANNER_RESCAN_INTERVAL_MS, BANNER_TEXT_PREVIEW_LENGTH } from "../shared/constants";
import { debounce } from "../shared/utils";
import type { BannerAction, BannerEvent } from "../shared/types";

const trackedBanners = new Map<string, Element>();

function sendBannerEvent(action: BannerAction, el: Element, fingerprint: string): void {
  const event: Omit<BannerEvent, "id" | "tabId"> = {
    fingerprint,
    action,
    selector: buildSelector(el),
    tagName: el.tagName.toLowerCase(),
    classes: Array.from(el.classList),
    text: elementText(el).slice(0, BANNER_TEXT_PREVIEW_LENGTH),
    attributes: collectAttributes(el),
    values: extractValueHits(el),
    timestamp: Date.now(),
    pageUrl: location.href
  };
  chrome.runtime.sendMessage({ type: "BANNER_EVENT", event }).catch(() => {});
}

function scanForBanners(root: ParentNode): void {
  const candidates = root.querySelectorAll("*");
  candidates.forEach((el) => {
    if (!isLikelyBannerElement(el)) {
      return;
    }
    const fingerprint = buildFingerprint(el);
    if (trackedBanners.has(fingerprint)) {
      return;
    }
    trackedBanners.set(fingerprint, el);
    sendBannerEvent("appeared", el, fingerprint);
  });
}

function checkForDisappeared(): void {
  for (const [fingerprint, el] of Array.from(trackedBanners.entries())) {
    const stillInDom = document.body ? document.body.contains(el) : false;
    const stillVisible = stillInDom && isLikelyBannerElement(el);
    if (!stillVisible) {
      trackedBanners.delete(fingerprint);
      sendBannerEvent("disappeared", el, fingerprint);
    }
  }
}

function runScanCycle(): void {
  if (!document.body) {
    return;
  }
  scanForBanners(document.body);
  checkForDisappeared();
}

const debouncedScanCycle = debounce(runScanCycle, BANNER_MUTATION_DEBOUNCE_MS);

function init(): void {
  runScanCycle();

  const observer = new MutationObserver(() => {
    debouncedScanCycle();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"]
  });

  setInterval(runScanCycle, BANNER_RESCAN_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
