import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { REGIONS, RegionId, REGION_IDS } from "@/lib/regions";
import { toast } from "sonner";
import {
  loadSettings,
  saveSettings,
  VoicePref,
  LanguagePref,
} from "@/lib/userSettings";

const Settings = () => {
  const initial = loadSettings();
  const [regions, setRegions] = useState<RegionId[]>(initial.regions);
  const [slack, setSlack] = useState<boolean>(initial.slack);
  const [voice, setVoice] = useState<VoicePref>(initial.voice);
  const [language, setLanguage] = useState<LanguagePref>(initial.language);
  const [defaultRegion, setDefaultRegion] = useState<RegionId | "none">(initial.defaultRegion);
  const [autoOpenDefaultRegion, setAutoOpenDefaultRegion] = useState<boolean>(initial.autoOpenDefaultRegion);

  const toggle = (id: RegionId) => {
    setRegions((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  };

  const save = () => {
    saveSettings({
      regions,
      slack,
      voice,
      language,
      defaultRegion,
      autoOpenDefaultRegion: defaultRegion !== "none" && autoOpenDefaultRegion,
    });

    toast.success("Preferences saved");
  };

  const pillClass = (active: boolean) =>
    "px-3 py-1 rounded-full text-xs font-semibold tracking-wide border transition-colors " +
    (active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-background/50 text-muted-foreground border-border hover:bg-secondary/70 hover:text-foreground hover:border-primary/45 dark:bg-transparent dark:border-white/15 dark:hover:border-white/30");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 py-4">
          <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
            ← Globe
          </Link>
          <div className="text-sm font-semibold">Settings</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-1">Your Regions</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Only checked regions appear on the globe. Uncheck to hide.
          </p>

          <div className="space-y-3">
            {REGION_IDS.map((id) => (
              <label key={id} className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={regions.includes(id)}
                  onCheckedChange={() => toggle(id)}
                />
                <span className="text-sm">
                  {REGIONS[id].name} <span className="ml-1">{REGIONS[id].flags}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-1">Default view on open</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Choose a region to open automatically when you launch tick.
          </p>

          <div className="space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Default region
              </span>
              <select
                value={defaultRegion}
                onChange={(e) => setDefaultRegion(e.target.value as RegionId | "none")}
                className="mt-2 w-full rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
              >
                <option value="none">Globe / no auto-open</option>
                {REGION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {REGIONS[id].name} {REGIONS[id].flags}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Automatically expand this region</div>
                <p className="text-sm text-muted-foreground">
                  When enabled, tick. opens directly into your selected region.
                </p>
              </div>

              <Switch
                checked={autoOpenDefaultRegion}
                onCheckedChange={setAutoOpenDefaultRegion}
                disabled={defaultRegion === "none"}
              />
            </div>

            {defaultRegion !== "none" && !regions.includes(defaultRegion) && (
              <p className="text-xs text-amber-500 dark:text-amber-300/90">
                This region is currently hidden from your globe. Re-enable it above or choose another default.
              </p>
            )}
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-1">Preferred voice</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your default voice for Morning Briefs.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              className={pillClass(voice === "female")}
              onClick={() => setVoice("female")}
            >
              Female
            </button>

            <button
              type="button"
              className={pillClass(voice === "male")}
              onClick={() => setVoice("male")}
            >
              Male
            </button>
          </div>
        </section>

        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-1">Preferred language</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your default language for Morning Briefs. Only applies to regions that support it.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              className={pillClass(language === "en")}
              onClick={() => setLanguage("en")}
            >
              English
            </button>

            <button
              type="button"
              className={pillClass(language === "local")}
              onClick={() => setLanguage("local")}
            >
              Local language
            </button>
          </div>
        </section>

        <section className="glass rounded-2xl p-6 opacity-60">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold mb-1">Slack notifications</h2>
              <p className="text-sm text-muted-foreground">
                Coming soon. Daily briefs delivered to your Slack channel each morning.
              </p>
            </div>

            <Switch checked={slack} onCheckedChange={setSlack} disabled />
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save}>Save preferences</Button>
        </div>
      </main>
    </div>
  );
};

export default Settings;