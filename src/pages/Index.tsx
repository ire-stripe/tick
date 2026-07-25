import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Globe3D } from "@/components/Globe3D";
import { StarField } from "@/components/StarField";
import { GlobalTicker } from "@/components/GlobalTicker";
import { RegionPanel } from "@/components/RegionPanel";
import { MiniPlayer } from "@/components/MiniPlayer";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { REGION_IDS, RegionId } from "@/lib/regions";
import { loadSettings } from "@/lib/userSettings";


const Index = () => {
  const closeTimerRef = useRef<number | null>(null);
  const clearPanelTimerRef = useRef<number | null>(null);
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
  const { episode: activeEpisode } = useAudioPlayer();
  const ambientCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Reload whenever the page regains focus (e.g. returning from /settings).
  useEffect(() => {
    const refresh = () => setEnabledRegions(loadSettings().regions);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
      const byRegion: Record<string, any[]> = {};
      REGION_IDS.forEach((r) => (byRegion[r] = []));
      articles.forEach((a: any) => {
        if (byRegion[a.region]) byRegion[a.region].push(a);
      });

      const c: Record<string, number> = {};
      REGION_IDS.forEach((r) => {
        const list = byRegion[r] ?? [];
        const seen = new Set<string>();
        const dedupe = (arr: any[]) =>
          arr.filter((a) => {
            const k = norm(a.title);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        const todays = list.filter((a) => a.published_at >= todayIso);
        const latest = dedupe(todays.filter((a) => !a.is_in_brief)).slice(0, 50);
        const brief = dedupe(todays.filter((a) => a.is_in_brief)).slice(0, 8);
        let total = latest.length + brief.length;
        if (total === 0) {
          total = dedupe(list).slice(0, 10).length;
        }
        c[r] = total;
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
      const headlinesOut = tickerPool
        .filter((a: any) => now - new Date(a.published_at).getTime() <= H72)
        .slice(0, 8);
      setHeadlines(headlinesOut);

      // Ambient floating headlines: today's articles across active territories,
      // deduped by title. Shown one at a time near their region's dot.
      const seenAmb = new Set<string>();
      const ambientOut: { title: string; region: RegionId }[] = [];
      articles.forEach((a: any) => {
        if (a.published_at < ambientCutoff) return;
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

  const handleSelectRegion = (id: RegionId) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (clearPanelTimerRef.current) {
      window.clearTimeout(clearPanelTimerRef.current);
      clearPanelTimerRef.current = null;
    }

    setActiveRegion(id);
    setPanelRegion(id);
    setPanelOpen(true);
    setHasSelected(true);
  };

  const handleClose = () => {
    setPanelOpen(false);

    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (clearPanelTimerRef.current) window.clearTimeout(clearPanelTimerRef.current);

    closeTimerRef.current = window.setTimeout(() => {
      setActiveRegion(null);
      closeTimerRef.current = null;
    }, 100);

    clearPanelTimerRef.current = window.setTimeout(() => {
      setPanelRegion(null);
      clearPanelTimerRef.current = null;
    }, 350);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <StarField burstKey={burstKey} />
      <Link
        to="/settings"
        aria-label="Settings"
        className="fixed z-[60] h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors"
        style={{ top: 16, right: 20 }}
      >
        <SettingsIcon className="h-5 w-5" />
      </Link>

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

