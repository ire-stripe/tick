import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Globe3D } from "@/components/Globe3D";
import { StarField } from "@/components/StarField";
import { GlobalTicker } from "@/components/GlobalTicker";
import { RegionPanel } from "@/components/RegionPanel";
import { MiniPlayer } from "@/components/MiniPlayer";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { REGION_IDS, RegionId } from "@/lib/regions";
import { loadSettings, saveSettings, applyTheme } from "@/lib/userSettings";


const Index = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [headlines, setHeadlines] = useState<any[]>([]);
  const [ambient, setAmbient] = useState<{ title: string; region: RegionId }[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());
  const [activeRegion, setActiveRegion] = useState<RegionId | null>(null);
  const [panelRegion, setPanelRegion] = useState<RegionId | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [hasSelected, setHasSelected] = useState(false);
  const [enabledRegions, setEnabledRegions] = useState<string[]>(() => loadSettings().regions);
  const [theme, setTheme] = useState(() => loadSettings().theme);
  const [showOnboardingHint, setShowOnboardingHint] = useState(() => !loadSettings().onboardingHintDismissed);
  const autoOpenAppliedRef = useRef(false);
  const { episode: activeEpisode } = useAudioPlayer();

  useEffect(() => {
    const settings = loadSettings();
    setTheme(settings.theme);
    applyTheme(settings.theme);

    const refresh = () => {
      const nextSettings = loadSettings();
      setEnabledRegions(nextSettings.regions);
      setTheme(nextSettings.theme);
      applyTheme(nextSettings.theme);
    };

    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    saveSettings({ theme: nextTheme });
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  // If the user has chosen a default region, open it once when tick. launches.
  useEffect(() => {
    if (autoOpenAppliedRef.current) return;

    const settings = loadSettings();
    const shouldAutoOpen =
      settings.autoOpenDefaultRegion &&
      settings.defaultRegion !== "none" &&
      settings.regions.includes(settings.defaultRegion) &&
      REGION_IDS.includes(settings.defaultRegion);

    if (!shouldAutoOpen) return;

    autoOpenAppliedRef.current = true;
    const timer = window.setTimeout(() => {
      if (settings.defaultRegion === "none") return;

      setActiveRegion(settings.defaultRegion);
      setPanelRegion(settings.defaultRegion);
      setPanelOpen(true);
      setHasSelected(true);

      if (!settings.onboardingHintDismissed) {
        setShowOnboardingHint(false);
        saveSettings({ onboardingHintDismissed: true });
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, []);


  // Trigger a shimmer burst on the star field when a region is opened or switched.
  useEffect(() => {
    if (activeRegion) setBurstKey((k) => k + 1);
  }, [activeRegion]);

  useEffect(() => {
    const load = async () => {
      const startOfTodayUtc = new Date();
      startOfTodayUtc.setUTCHours(0, 0, 0, 0);
      const todayIso = startOfTodayUtc.toISOString();

      // Fetch a broad recent window so counts mirror the panel's display logic
      // (today's articles, with fallback to 10 most recent if today is empty).
      const { data: articles } = await supabase
        .from("articles")
        .select("id,title,url,region,language,is_breaking,is_in_brief,global_ticker,ticker_source,published_at,created_at")
        .order("published_at", { ascending: false })
        .limit(2000);
      if (!articles) return;

      const norm = (t: string) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
      const dedupeByTitle = (list: any[]) => {
        const seen = new Set<string>();
        return list.filter((a) => {
          const key = norm(a.title);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const byRegion: Record<string, any[]> = {};
      REGION_IDS.forEach((r) => (byRegion[r] = []));
      articles.forEach((a: any) => {
        if (byRegion[a.region]) byRegion[a.region].push(a);
      });
      const globalToday = articles.filter(
        (a: any) => a.region === "global" && a.published_at >= todayIso,
      );

      const c: Record<string, number> = {};
      REGION_IDS.forEach((r) => {
        const list = byRegion[r] ?? [];
        let latest = dedupeByTitle(
          list.filter((a) => !a.is_in_brief && a.published_at >= todayIso),
        ).slice(0, 50);
        const brief = dedupeByTitle(list.filter((a) => a.is_in_brief)).slice(0, 8);

        if (latest.length === 0 && brief.length === 0) {
          c[r] = dedupeByTitle(list).slice(0, 10).length;
          return;
        }

        if (latest.length < 3) {
          const seenIds = new Set(latest.map((a) => a.id));
          const extra = dedupeByTitle(globalToday)
            .filter((a) => !seenIds.has(a.id))
            .slice(0, 3 - latest.length);
          latest = dedupeByTitle([...latest, ...extra]);
        }

        c[r] = latest.length + brief.length;
      });

      setCounts(c);
      const now = Date.now();
      const H72 = 72 * 60 * 60 * 1000;
      // Ticker shows only curated (global_ticker=true) items from the dedicated
      // ticker pool, within the last 72h (matches curate-ticker window). If none
      // qualify, GlobalTicker renders a static message — never fall back to stale.
      const tickerPool = articles.filter(
        (a: any) => a.ticker_source && (a.language ?? "en") === "en" && a.global_ticker,
      );
      const seenTicker = new Set<string>();
      const headlinesOut = tickerPool
        .filter((a: any) => now - new Date(a.published_at).getTime() <= H72)
        .filter((a: any) => {
          const key = norm(a.title);
          if (seenTicker.has(key)) return false;
          seenTicker.add(key);
          return true;
        })
        .slice(0, 8);
      setHeadlines(headlinesOut);

      // Ambient floating headlines: today's articles across active territories,
      // deduped by title. Shown one at a time near their region's dot.
      const seenAmb = new Set<string>();
      const ambientOut: { title: string; region: RegionId }[] = [];
      articles.forEach((a: any) => {
        if (a.published_at < todayIso) return;
        if (!REGION_IDS.includes(a.region)) return;
        const key = (a.title || "").toLowerCase().trim();
        if (!key || seenAmb.has(key)) return;
        seenAmb.add(key);
        ambientOut.push({ title: a.title, region: a.region as RegionId });
      });
      setAmbient(ambientOut);


      setRefreshedAt(new Date());
    };
    load();
  }, []);


  const minsAgo = Math.max(1, Math.floor((Date.now() - refreshedAt.getTime()) / 60000));

  const dismissOnboardingHint = () => {
    if (!showOnboardingHint) return;

    setShowOnboardingHint(false);
    saveSettings({ onboardingHintDismissed: true });
  };

  const openRegion = (id: RegionId) => {
    setActiveRegion(id);
    setPanelRegion(id);
    setPanelOpen(true);
    setHasSelected(true);
    dismissOnboardingHint();
  };

  const handleSelectRegion = (id: RegionId) => {
    openRegion(id);
  };

  const handleClose = () => {
    // Panel fades first, then map zooms out (100ms later)
    setPanelOpen(false);
    window.setTimeout(() => setActiveRegion(null), 100);
    window.setTimeout(() => setPanelRegion(null), 350);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden relative bg-background text-foreground">
      <StarField burstKey={burstKey} />
        <div
          className="fixed z-[60] flex items-center gap-2"
          style={{ top: 16, right: 20 }}
        >
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-primary transition-colors"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>

          <Link
            to="/settings"
            aria-label="Settings"
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-primary transition-colors"
          >
            <SettingsIcon className="h-5 w-5" />
          </Link>
        </div>

      <header className="pt-4 pb-2 text-center shrink-0 relative z-10">
        <h1 className="font-serifDisplay text-4xl md:text-5xl leading-none lowercase">
          tick.
        </h1>
        <p className="mt-2 text-[11px] text-foreground/80 tracking-[0.15em]">
          Get the latest fintech news in 5 minutes.
        </p>
        <p
          className="text-[10px] text-muted-foreground tracking-[0.15em] mt-0.5"
          style={{
            opacity: hasSelected ? 0 : 0.6,
            transition: "opacity 500ms ease-out",
          }}
        >
          Select a region to begin
        </p>
      </header>

      <main className="flex-1 min-h-0 flex items-center justify-center px-4 relative z-10">
        <Globe3D
          counts={counts}
          activeRegion={activeRegion}
          onSelectRegion={handleSelectRegion}
          onCloseRegion={handleClose}
          ambientHeadlines={ambient}
          enabledRegions={enabledRegions}
        />

        {showOnboardingHint && !hasSelected && !activeRegion && (
          <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 w-[min(92vw,380px)] -translate-x-1/2 rounded-2xl border border-border bg-background/75 px-4 py-3 text-center shadow-2xl backdrop-blur-md dark:border-white/10">
            <p className="text-sm font-medium text-foreground">
              Click a glowing region to explore today’s market signals.
            </p>
            <button
              type="button"
              onClick={dismissOnboardingHint}
              className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary transition-colors hover:text-primary/80"
            >
              Got it
            </button>
          </div>
        )}
      </main>

      <div className="shrink-0 relative z-10">
        <GlobalTicker headlines={headlines} />
        <p className="text-center text-[10px] text-muted-foreground py-1.5">
          Last refreshed: {minsAgo} min ago
        </p>
      </div>


      {panelRegion && (
        <RegionPanel regionId={panelRegion} open={panelOpen} onClose={handleClose} />
      )}

      <MiniPlayer
        visible={!!activeEpisode && (!panelOpen || activeEpisode.regionId !== panelRegion)}
        onExpand={(id) => handleSelectRegion(id as RegionId)}
      />

    </div>
  );
};

export default Index;

