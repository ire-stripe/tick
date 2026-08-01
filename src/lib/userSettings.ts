import { REGION_IDS, type RegionId } from "@/lib/regions";

export const SETTINGS_KEY = "tick.settings";

export type VoicePref = "female" | "male";
export type LanguagePref = "en" | "local";
export type ThemePref = "dark" | "light";

export type UserSettings = {
  regions: RegionId[];
  slack: boolean;
  voice: VoicePref;
  language: LanguagePref;
  theme: ThemePref;
  defaultRegion: RegionId | "none";
  autoOpenDefaultRegion: boolean;
  onboardingHintDismissed: boolean;
};

export const DEFAULT_SETTINGS: UserSettings = {
  regions: [...REGION_IDS],
  slack: false,
  voice: "female",
  language: "en",
  theme: "dark",
  defaultRegion: "none",
  autoOpenDefaultRegion: false,
  onboardingHintDismissed: false,
};

export function applyTheme(theme: ThemePref) {
  try {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  } catch {}
}

export function loadSettings(): UserSettings {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;

    const raw = localStorage.getItem(SETTINGS_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserSettings>;

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        regions: Array.isArray(parsed.regions)
          ? (parsed.regions as RegionId[])
          : DEFAULT_SETTINGS.regions,
        voice: parsed.voice === "male" || parsed.voice === "female"
          ? parsed.voice
          : DEFAULT_SETTINGS.voice,
        language: parsed.language === "local" || parsed.language === "en"
          ? parsed.language
          : DEFAULT_SETTINGS.language,
        theme: parsed.theme === "light" || parsed.theme === "dark"
          ? parsed.theme
          : DEFAULT_SETTINGS.theme,
        defaultRegion: parsed.defaultRegion === "none" || REGION_IDS.includes(parsed.defaultRegion as RegionId)
          ? (parsed.defaultRegion as RegionId | "none")
          : DEFAULT_SETTINGS.defaultRegion,
        autoOpenDefaultRegion: typeof parsed.autoOpenDefaultRegion === "boolean"
          ? parsed.autoOpenDefaultRegion
          : DEFAULT_SETTINGS.autoOpenDefaultRegion,
        onboardingHintDismissed: typeof parsed.onboardingHintDismissed === "boolean"
          ? parsed.onboardingHintDismissed
          : DEFAULT_SETTINGS.onboardingHintDismissed,
      };
    }
  } catch {}

  return DEFAULT_SETTINGS;
}

export function saveSettings(next: Partial<UserSettings>) {
  try {
    if (typeof localStorage === "undefined") return;

    const merged: UserSettings = {
      ...loadSettings(),
      ...next,
    };

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    applyTheme(merged.theme);
  } catch {}
}