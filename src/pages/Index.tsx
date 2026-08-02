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
import { REGIONS, REGION_IDS, RegionId } from "@/lib/regions";
import { loadSettings, saveSettings, applyTheme } from "@/lib/userSettings";

type TodaySignal = {
  region: RegionId;
  title: string;
  count: number;
};

type StripePlay = {
  product: string;
  reason: string;
  count: number;
  region: RegionId | null;
};

const STRIPE_PLAY_DEFINITIONS = [
  {
    product: "Billing",
    reason: "Subscription, recurring revenue, and monetization signals",
    keywords: ["subscription", "billing", "invoice", "recurring", "churn", "monetization", "revenue recovery"],
  },
  {
    product: "Connect",
    reason: "Marketplace, platform, onboarding, and embedded finance signals",
    keywords: ["marketplace", "platform", "seller", "merchant onboarding", "embedded finance", "payout"],
  },
  {
    product: "Payments",
    reason: "Checkout, commerce, wallets, and payment performance signals",
    keywords: ["payment", "payments", "checkout", "commerce", "wallet", "transaction", "conversion"],
  },
  {
    product: "Radar",
    reason: "Fraud, risk, scams, and chargeback signals",
    keywords: ["fraud", "scam", "risk", "chargeback", "security"],
  },
  {
    product: "Link",
    reason: "Consumer checkout, wallet, and conversion signals",
    keywords: ["wallet", "checkout", "conversion", "consumer", "pay by bank", "bank account"],
  },
  {
    product: "Tax",
    reason: "Tax, VAT, compliance, and cross-border expansion signals",
    keywords: ["tax", "vat", "gst", "compliance", "cross-border", "international"],
  },
  {
    product: "Capital / Issuing",
    reason: "Financing, card issuing, spend management, and credit signals",
    keywords: ["capital", "lending", "financing", "issuing", "card issuing", "expense", "credit"],
  },
];

const Index = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [headlines, setHeadlines] = useState<any[]>([]);
  const [ambient, setAmbient] = useState<{ title: string; region: RegionId }[]>([]);
  const [todaySignals, setTodaySignals] = useState<TodaySignal[]>([]);
  const [stripePlays, setStripePlays] = useState<StripePlay[]>([]);
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

      const enabledRegionSet = new Set(loadSettings().regions);
      const signalOut = REGION_IDS.map((region) => {
        if (!enabledRegionSet.has(region)) return null;

        const list = byRegion[region] ?? [];
        const today = dedupeByTitle(
          list.filter((a: any) => !a.is_in_brief && a.published_at >= todayIso),
        );
        const fallback = dedupeByTitle(list);
        const candidate = today[0] ?? fallback[0];

        if (!candidate || !c[region]) return null;

        return {
          region: region as RegionId,
          title: candidate.title,
          count: c[region],
        };
      })
        .filter(Boolean)
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 3) as TodaySignal[];

      setTodaySignals(signalOut);

      const recentArticles = dedupeByTitle(
        articles.filter((a: any) => {
          if (!REGION_IDS.includes(a.region)) return false;
          if (!enabledRegionSet.has(a.region)) return false;
          return now - new Date(a.published_at).getTime() <= H72;
        }),
      );

      const playOut = STRIPE_PLAY_DEFINITIONS.map((definition) => {
        const matches = recentArticles.filter((a: any) => {
          const haystack = `${a.title ?? ""} ${a.url ?? ""}`.toLowerCase();
          return definition.keywords.some((keyword) => haystack.includes(keyword));
        });

        const regionCounts = new Map<RegionId, number>();
        matches.forEach((a: any) => {
          const region = a.region as RegionId;
          regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
        });

        const topRegion = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

        return {
          product: definition.product,
          reason: definition.reason,
          count: matches.length,
          region: topRegion,
        };
      })
        .filter((play) => play.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      setStripePlays(playOut);

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

  const completeOnboardingHint = () => {
    if (!showOnboardingHint) return;

    // Persist the dismissal, but keep the current hint text mounted while the
    // header fades out. This avoids flashing back to "Select a region to begin"
    // during the region-open transition.
    saveSettings({ onboardingHintDismissed: true });
  };

  const openRegion = (id: RegionId) => {
    setActiveRegion(id);
    setPanelRegion(id);
    setPanelOpen(true);
    setHasSelected(true);
    completeOnboardingHint();
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
        <div
          className="mt-2 flex justify-center"
          style={{
            opacity: hasSelected ? 0 : 1,
            transition: "opacity 500ms ease-out",
          }}
        >
          <p
            className={
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] tracking-[0.15em] transition-all " +
              (showOnboardingHint
                ? "border border-primary/20 bg-primary/8 text-primary/90 shadow-[0_0_28px_hsl(var(--primary)/0.16)]"
                : "text-muted-foreground/70")
            }
          >
            {showOnboardingHint && (
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
            )}
            <span>
              {showOnboardingHint
                ? "Select a glowing region to explore today’s market signals"
                : "Select a region to begin"}
            </span>
          </p>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex items-center justify-center px-4 relative z-10">
        {!panelOpen && todaySignals.length > 0 && (
          <aside className="pointer-events-auto absolute left-6 top-1/2 z-20 hidden w-64 -translate-y-1/2 xl:block">
            <div className="rounded-3xl border border-border bg-background/60 p-4 shadow-2xl backdrop-blur-md dark:border-white/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Today’s Signals
              </p>

              <div className="mt-4 space-y-3">
                {todaySignals.map((signal) => (
                  <button
                    key={signal.region}
                    type="button"
                    onClick={() => handleSelectRegion(signal.region)}
                    className="group w-full rounded-2xl border border-border/80 bg-background/45 p-3 text-left transition-colors hover:border-primary/60 hover:bg-secondary/60 dark:border-white/10 dark:hover:border-primary/60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-foreground">
                        {REGIONS[signal.region]?.name ?? signal.region}
                      </span>
                      <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {signal.count} {signal.count === 1 ? "story" : "stories"}
                      </span>
                    </div>
                    <p
                      className="mt-2 text-xs leading-5 text-muted-foreground group-hover:text-foreground/85"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {signal.title}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {!panelOpen && stripePlays.length > 0 && (
          <aside className="pointer-events-auto absolute right-6 top-1/2 z-20 hidden w-64 -translate-y-1/2 xl:block">
            <div className="rounded-3xl border border-border bg-background/60 p-4 shadow-2xl backdrop-blur-md dark:border-white/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Suggested Stripe Plays
              </p>

              <div className="mt-4 space-y-3">
                {stripePlays.map((play) => (
                  <button
                    key={play.product}
                    type="button"
                    onClick={() => play.region && handleSelectRegion(play.region)}
                    className="group w-full rounded-2xl border border-border/80 bg-background/45 p-3 text-left transition-colors hover:border-primary/60 hover:bg-secondary/60 disabled:cursor-default dark:border-white/10 dark:hover:border-primary/60"
                    disabled={!play.region}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-foreground">{play.product}</span>
                      <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {play.count}x
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground group-hover:text-foreground/85">
                      {play.reason}
                    </p>
                    {play.region && (
                      <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Strongest in {REGIONS[play.region]?.name ?? play.region}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        <Globe3D
          counts={counts}
          activeRegion={activeRegion}
          onSelectRegion={handleSelectRegion}
          onCloseRegion={handleClose}
          ambientHeadlines={ambient}
          enabledRegions={enabledRegions}
        />

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

