import { DEFAULT_SETTINGS, ExtensionSettings } from "../shared/types";
import { STORAGE_KEY_SETTINGS } from "../shared/constants";
import { safeError } from "./security";

let cachedSettings: ExtensionSettings | null = null;

export async function loadSettings(): Promise<ExtensionSettings> {
  if (cachedSettings) {
    return cachedSettings;
  }
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
    const value = stored[STORAGE_KEY_SETTINGS] as Partial<ExtensionSettings> | undefined;
    cachedSettings = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  } catch (error) {
    safeError("Не удалось загрузить настройки, используются значения по умолчанию", error);
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next: ExtensionSettings = { ...current, ...patch };
  cachedSettings = next;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: next });
  } catch (error) {
    safeError("Не удалось сохранить настройки", error);
  }
  return next;
}

export async function markDebuggerNoticeShown(): Promise<void> {
  await saveSettings({ debuggerNoticeShown: true });
}
