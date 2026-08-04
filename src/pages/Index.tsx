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

type DailyBriefItem = {
  id: string;
  title: string;
  evidenceLabel: string;
  primaryRegion: RegionId | null;
};

type BriefTakeaway = {
  id: string;
  title: string;
  commercialAngle: string;
  accountTypes: string[];
  stripeContext: string[];
  primaryRegion: RegionId | null;
};

type BriefTopicTemplate = {
  id: string;
  briefTitle: string;
  takeawayTitle: string;
  briefingSummary: string;
  accountTypes: string[];
  commercialAngle: string;
  stripeContext: string[];
  keywords: string[];
};

const BRIEF_TOPIC_TEMPLATES: BriefTopicTemplate[] = [
  {
    id: "ai-monetization",
    briefTitle: "AI monetization is getting more complex",
    takeawayTitle: "AI monetization hook",
    briefingSummary:
      "Fast-growing AI companies often need pricing, billing, and payment infrastructure that can keep up with usage growth.",
    accountTypes: ["AI tools", "devtools", "B2B SaaS", "usage-based software"],
    commercialAngle: "Ask how they are managing pricing, payments, and billing complexity as usage grows.",
    stripeContext: ["Billing", "Payments", "Link"],
    keywords: ["ai", "artificial intelligence", "openai", "llm", "automation", "developer", "devtool", "machine learning"],
  },
  {
    id: "platform-monetization",
    briefTitle: "Platforms are turning payments into a product surface",
    takeawayTitle: "Platform monetization hook",
    briefingSummary:
      "Platforms and marketplaces are looking for ways to deepen merchant relationships through onboarding, payouts, and embedded financial workflows.",
    accountTypes: ["Marketplaces", "vertical SaaS", "merchant networks", "fintech platforms"],
    commercialAngle: "Ask whether payments are becoming part of the product experience, not just back-office infrastructure.",
    stripeContext: ["Connect", "Billing", "Tax"],
    keywords: ["marketplace", "platform", "seller", "merchant", "embedded finance", "payout", "onboarding"],
  },
  {
    id: "checkout-conversion",
    briefTitle: "Payment choice is becoming a conversion lever",
    takeawayTitle: "Checkout conversion hook",
    briefingSummary:
      "Consumer businesses expanding across markets may need local payment methods, wallet support, and lower-friction checkout.",
    accountTypes: ["Ecommerce", "travel", "consumer marketplaces", "subscription commerce"],
    commercialAngle: "Ask how payment choice is affecting conversion as they grow across markets.",
    stripeContext: ["Payments", "Link", "Local payment methods"],
    keywords: ["checkout", "wallet", "consumer", "conversion", "ecommerce", "retail", "pay by bank", "payment choice"],
  },
  {
    id: "risk-reduction",
    briefTitle: "Fraud pressure is creating a conversion tradeoff",
    takeawayTitle: "Risk reduction hook",
    briefingSummary:
      "High-volume businesses need to reduce fraud and disputes without adding unnecessary friction to good customers.",
    accountTypes: ["High-volume commerce", "fintech", "marketplaces", "ticketing"],
    commercialAngle: "Ask whether fraud controls are protecting revenue without hurting legitimate conversion.",
    stripeContext: ["Radar", "optimized authorization", "Identity"],
    keywords: ["fraud", "scam", "risk", "chargeback", "dispute", "security", "identity"],
  },
  {
    id: "global-expansion",
    briefTitle: "Expansion is making payments more operationally complex",
    takeawayTitle: "Market expansion hook",
    briefingSummary:
      "Companies entering new markets often run into currency, tax, local payment, and compliance complexity at the same time.",
    accountTypes: ["SaaS", "marketplaces", "cross-border commerce", "international platforms"],
    commercialAngle: "Ask how they are managing payment complexity as they enter or serve more markets.",
    stripeContext: ["Payments", "Tax", "Local payment methods"],
    keywords: ["cross-border", "international", "global", "expansion", "currency", "vat", "tax", "compliance", "local"],
  },
  {
    id: "capital-access",
    briefTitle: "Financial services are becoming part of the user experience",
    takeawayTitle: "Embedded finance hook",
    briefingSummary:
      "Businesses with merchant or creator networks can use financing, cards, and money movement to create stickier customer relationships.",
    accountTypes: ["Platforms", "creator tools", "merchant networks", "vertical SaaS"],
    commercialAngle: "Ask whether financial services could help them deepen the relationship with their users or sellers.",
    stripeContext: ["Capital", "Issuing", "Connect"],
    keywords: ["capital", "lending", "financing", "issuing", "card issuing", "credit", "expense", "spend management"],
  },
];

const Index = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [headlines, setHeadlines] = useState<any[]>([]);
  const [ambient, setAmbient] = useState<{ title: string; region: RegionId }[]>([]);
  const [briefItems, setBriefItems] = useState<DailyBriefItem[]>([]);
  const [briefTakeaways, setBriefTakeaways] = useState<BriefTakeaway[]>([]);
  const [panelScopeLabel, setPanelScopeLabel] = useState("your selected regions");
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

      const settingsForPanels = loadSettings();
      const enabledRegionSet = new Set(settingsForPanels.regions);
      const defaultRegion = settingsForPanels.defaultRegion !== "none" ? settingsForPanels.defaultRegion : null;
      const primaryScope =
        defaultRegion && enabledRegionSet.has(defaultRegion) && REGION_IDS.includes(defaultRegion)
          ? [defaultRegion]
          : [];
      const fallbackScope = settingsForPanels.regions.filter((region) => REGION_IDS.includes(region));
      const scopedRegions = primaryScope.length > 0 ? primaryScope : fallbackScope.length > 0 ? fallbackScope : REGION_IDS;
      const scopedRegionSet = new Set(scopedRegions);
      const scopeLabel =
        primaryScope.length === 1
          ? REGIONS[primaryScope[0]]?.name ?? primaryScope[0]
          : "your selected regions";
      setPanelScopeLabel(scopeLabel);

      const scopedRecentArticles = dedupeByTitle(
        articles.filter((a: any) => {
          if (!REGION_IDS.includes(a.region)) return false;
          if (!scopedRegionSet.has(a.region)) return false;
          return now - new Date(a.published_at).getTime() <= H72;
        }),
      );
      const scopedFallbackArticles = dedupeByTitle(
        articles.filter((a: any) => REGION_IDS.includes(a.region) && scopedRegionSet.has(a.region)),
      );
      const scopedArticles = scopedRecentArticles.length > 0 ? scopedRecentArticles : scopedFallbackArticles;

      const templateMatches = BRIEF_TOPIC_TEMPLATES.map((template) => {
        const matches = scopedArticles.filter((a: any) => {
          const haystack = `${a.title ?? ""} ${a.url ?? ""}`.toLowerCase();
          return template.keywords.some((keyword) => haystack.includes(keyword));
        });

        const regionCounts = new Map<RegionId, number>();
        matches.forEach((a: any) => {
          const region = a.region as RegionId;
          regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
        });

        const primaryRegion = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? scopedRegions[0] ?? null;

        return {
          template,
          matches,
          primaryRegion,
          score: matches.length,
        };
      })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      const evidenceFor = (count: number) =>
        primaryScope.length === 1
          ? `${count} ${REGIONS[primaryScope[0]]?.name ?? primaryScope[0]} ${count === 1 ? "story" : "stories"}`
          : `${count} ${count === 1 ? "story" : "stories"} from selected regions`;

      const briefOut = templateMatches.map(({ template, matches, primaryRegion }) => ({
        id: template.id,
        title: template.briefTitle,
        evidenceLabel: evidenceFor(matches.length),
        primaryRegion,
      }));

      const takeawayOut = templateMatches.slice(0, 2).map(({ template, primaryRegion }) => ({
        id: template.id,
        title: template.takeawayTitle,
        commercialAngle: template.commercialAngle,
        accountTypes: template.accountTypes,
        stripeContext: template.stripeContext,
        primaryRegion,
      }));

      setBriefItems(briefOut);
      setBriefTakeaways(takeawayOut);

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
        {briefItems.length > 0 && (
          <aside
            aria-hidden={panelOpen}
            className={
              "absolute left-5 top-1/2 z-20 hidden w-[300px] -translate-y-1/2 transition-all duration-300 ease-out xl:block 2xl:left-6 " +
              (panelOpen
                ? "pointer-events-none -translate-x-4 opacity-0"
                : "pointer-events-auto translate-x-0 opacity-100")
            }
          >
            <div className="rounded-3xl border border-border bg-background/55 p-4 shadow-2xl backdrop-blur-md dark:border-white/10">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Today’s Brief
                </p>
                <p className="mt-1 text-xs text-muted-foreground/85">
                  {panelScopeLabel === "your selected regions"
                    ? "What the morning briefing is tracking."
                    : `What ${panelScopeLabel} is tracking today.`}
                </p>
              </div>

              <div className="mt-4 space-y-2.5">
                {briefItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.primaryRegion && handleSelectRegion(item.primaryRegion)}
                    className="group flex w-full gap-3 rounded-2xl border border-border/80 bg-background/40 p-3 text-left transition-colors hover:border-primary/60 hover:bg-secondary/60 dark:border-white/10 dark:hover:border-primary/60"
                  >
                    <span className="mt-0.5 text-xs font-semibold text-primary/80">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold leading-5 text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.evidenceLabel}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {briefTakeaways.length > 0 && (
          <aside
            aria-hidden={panelOpen}
            className={
              "absolute right-5 top-1/2 z-20 hidden w-[340px] -translate-y-1/2 transition-all duration-300 ease-out xl:block 2xl:right-6 " +
              (panelOpen
                ? "pointer-events-none translate-x-4 opacity-0"
                : "pointer-events-auto translate-x-0 opacity-100")
            }
          >
            <div className="rounded-3xl border border-border bg-background/55 p-3.5 shadow-2xl backdrop-blur-md dark:border-white/10">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Takeaways
                </p>
                <p className="mt-1 text-xs text-muted-foreground/85">
                  Why today’s brief may matter commercially.
                </p>
              </div>

              <div className="mt-3 space-y-2.5">
                {briefTakeaways.map((takeaway) => (
                  <button
                    key={takeaway.id}
                    type="button"
                    onClick={() => takeaway.primaryRegion && handleSelectRegion(takeaway.primaryRegion)}
                    className="group w-full rounded-2xl border border-border/80 bg-background/40 p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-secondary/60 dark:border-white/10 dark:hover:border-primary/60"
                  >
                    <p className="text-[15px] font-semibold leading-5 text-foreground">
                      {takeaway.title.replace(" hook", "")}
                    </p>
                    <p className="mt-1.5 text-sm leading-5 text-muted-foreground group-hover:text-foreground/85">
                      {takeaway.commercialAngle}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {takeaway.accountTypes.slice(0, 3).map((type) => (
                        <span
                          key={type}
                          className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground dark:border-white/10"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-primary/80">
                      {takeaway.stripeContext.slice(0, 3).join(" + ")}
                    </p>
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

