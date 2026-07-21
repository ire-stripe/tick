import { REGION_IDS } from "@/lib/regions";

export const SETTINGS_KEY = "tick.settings";

export type VoicePref = "female" | "male";
export type LanguagePref = "en" | "local";

export type UserSettings = {
  regions: string[];
  slack: boolean;
  voice: VoicePref;
  language: LanguagePref;
};

export const DEFAULT_SETTINGS: UserSettings = {
  regions: REGION_IDS,
  slack: false,
  voice: "female",
  language: "en",
};

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}
