import { MAX_BANNER_EVENTS_PER_TAB } from "../shared/constants";
import { generateId } from "../shared/utils";
import type { BannerEvent } from "../shared/types";

interface TabBannerState {
  events: BannerEvent[];
}

const tabStates = new Map<number, TabBannerState>();

function ensureState(tabId: number): TabBannerState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = { events: [] };
    tabStates.set(tabId, state);
  }
  return state;
}

export function recordBannerEvent(tabId: number, partial: Omit<BannerEvent, "id" | "tabId">): BannerEvent {
  const state = ensureState(tabId);
  const event: BannerEvent = { ...partial, id: generateId(), tabId };
  state.events.push(event);
  if (state.events.length > MAX_BANNER_EVENTS_PER_TAB) {
    state.events.shift();
  }
  return event;
}

export function getBannerEvents(tabId: number): BannerEvent[] {
  const state = tabStates.get(tabId);
  return state ? state.events : [];
}

export function clearBannerEvents(tabId: number): void {
  const state = ensureState(tabId);
  state.events = [];
}

export function cleanupBannerTab(tabId: number): void {
  tabStates.delete(tabId);
}
