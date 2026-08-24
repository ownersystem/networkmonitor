import { safeError, safeLog } from "./security";

const PROTOCOL_VERSION = "1.3";
const attachedTabs = new Set<number>();

export type CdpEventHandler = (tabId: number, method: string, params: unknown) => void;
export type CdpDetachHandler = (tabId: number, reason: string) => void;

let eventHandler: CdpEventHandler | null = null;
let detachHandler: CdpDetachHandler | null = null;

export function onCdpEvent(handler: CdpEventHandler): void {
  eventHandler = handler;
}

export function onCdpDetach(handler: CdpDetachHandler): void {
  detachHandler = handler;
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== "number") {
    return;
  }
  if (eventHandler) {
    eventHandler(source.tabId, method, params);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (typeof source.tabId !== "number") {
    return;
  }
  attachedTabs.delete(source.tabId);
  if (detachHandler) {
    detachHandler(source.tabId, reason);
  }
});

export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

export async function attachDebugger(tabId: number): Promise<boolean> {
  if (attachedTabs.has(tabId)) {
    return true;
  }
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    attachedTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    safeLog(`Debugger подключен к вкладке ${tabId}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already attached")) {
      attachedTabs.add(tabId);
      try {
        await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
      } catch {
        return false;
      }
      safeLog(`Debugger уже был подключен к вкладке ${tabId}, переиспользуем сессию`);
      return true;
    }
    safeError(`Не удалось подключить debugger к вкладке ${tabId}`, error);
    attachedTabs.delete(tabId);
    return false;
  }
}

export async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    return;
  }
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
    safeLog(`Debugger отключен от вкладки ${tabId}`);
  } catch (error) {
    safeError(`Ошибка при отключении debugger от вкладки ${tabId}`, error);
  }
}

export interface GetResponseBodyResult {
  body: string;
  base64Encoded: boolean;
}

export async function getResponseBody(
  tabId: number,
  requestId: string
): Promise<GetResponseBodyResult | null> {
  if (!attachedTabs.has(tabId)) {
    return null;
  }
  try {
    const result = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
      requestId
    })) as GetResponseBodyResult | undefined;
    if (!result) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export function listAttachedTabs(): number[] {
  return Array.from(attachedTabs);
}
