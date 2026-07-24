import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Globe3D } from "@/components/Globe3D";
import { GlobalTicker } from "@/components/GlobalTicker";
import { RegionPanel } from "@/components/RegionPanel";
import { MiniPlayer } from "@/components/MiniPlayer";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { REGION_IDS, RegionId } from "@/lib/regions";
import { loadSettings } from "@/lib/userSettings";


const Index = () => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [headlines, setHeadlines] = useState<any[]>([]);
  const [ambient, setAmbient] = useState<{ title: string; region: RegionId }[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());
  const [activeRegion, setActiveRegion] = useState<RegionId | null>(null);
  const [panelRegion, setPanelRegion] = useState<RegionId | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);
  const [enabledRegions, setEnabledRegions] = useState<string[]>(() => loadSettings().regions);
  const { episode: activeEpisode } = useAudioPlayer();

  // Reload whenever the page regains focus (e.g. returning from /settings).
  useEffect(() => {
    const refresh = () => setEnabledRegions(loadSettings().regions);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);



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

  const handleSelectRegion = (id: RegionId) => {
    setActiveRegion(id);
    setPanelRegion(id);
    setPanelOpen(true);
    setHasSelected(true);
  };

  const handleClose = () => {
    // Panel fades first, then map zooms out (100ms later)
    setPanelOpen(false);
    window.setTimeout(() => setActiveRegion(null), 100);
    window.setTimeout(() => setPanelRegion(null), 350);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden relative bg-background text-foreground">
      <Link
        to="/settings"
        aria-label="Settings"
        className="fixed z-[60] h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-black/5 transition-colors"
        style={{ top: 16, right: 20 }}
      >
        <SettingsIcon className="h-5 w-5" />
      </Link>

      <header
        className="shrink-0 relative z-20 border-b border-border bg-card/95 overflow-hidden transition-all duration-500 ease-in-out"
        style={{
          maxHeight: panelOpen ? 0 : 200,
          opacity: panelOpen ? 0 : 1,
          paddingTop: panelOpen ? 0 : 16,
          paddingBottom: panelOpen ? 0 : 16,
          borderBottomWidth: panelOpen ? 0 : 1,
        }}
      >
        <h1 className="font-serifDisplay text-5xl md:text-6xl leading-none lowercase text-foreground text-center">
          tick.
        </h1>
        <p className="mt-2 text-[11px] text-muted-foreground tracking-[0.15em] text-center">
          Get the latest fintech news in 5 minutes.
        </p>
        <p
          className="text-[10px] text-muted-foreground tracking-[0.15em] mt-0.5 text-center"
          style={{
            opacity: hasSelected ? 0 : 0.75,
            transition: "opacity 500ms ease-out",
          }}
        >
          Select a region to begin
        </p>
      </header>

      <main className="flex-1 min-h-0 flex items-center justify-center px-4 py-4 relative z-10 bg-background">
        <div className="relative w-full max-w-6xl flex-1 min-h-[420px]">
          <div className="relative w-full" style={{ height: "min(68vh, 680px)" }}>
            <Globe3D
              counts={counts}
              activeRegion={activeRegion}
              onSelectRegion={handleSelectRegion}
              onCloseRegion={handleClose}
              ambientHeadlines={ambient}
              enabledRegions={enabledRegions}
            />
          </div>
        </div>
      </main>

      <div className="shrink-0 relative z-10 bg-background">
        <p className="text-center text-[10px] text-muted-foreground py-1.5 border-t border-border-subtle">
          Last refreshed: {minsAgo} min ago
        </p>
        <GlobalTicker headlines={headlines} />
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

