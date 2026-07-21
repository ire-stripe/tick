import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { REGIONS, RegionId } from "@/lib/regions";
import { AudioPlayer } from "@/components/AudioPlayer";
import { StoryCard, Story } from "@/components/StoryCard";
import { FeedbackModal } from "@/components/FeedbackModal";
import { X } from "lucide-react";

interface Props {
  regionId: RegionId;
  open: boolean;
  onClose: () => void;
}

export const RegionPanel = ({ regionId, open, onClose }: Props) => {
  const [latest, setLatest] = useState<Story[]>([]);
  const [today, setToday] = useState<Story[]>([]);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(15);
  const meta = REGIONS[regionId];

  const PAGE_SIZE = 15;
  const MAX_LATEST = 50;
  const TODAY_MAX = 8;

  // Two-phase mount so the initial opacity:0 state is painted before we transition to 1.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      // Double rAF: guarantees the browser paints the initial (opacity:0) state
      // before we flip to the final state, so the CSS transition actually runs.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setVisible(false);
  }, [open]);

  // Content cross-fade when switching regions while panel stays mounted.
  const [displayRegion, setDisplayRegion] = useState<RegionId>(regionId);
  const [contentVisible, setContentVisible] = useState(true);
  const firstRegionRef = useRef(regionId);
  useEffect(() => {
    if (regionId === displayRegion) return;
    setContentVisible(false);
    // Clear the previous region's data synchronously so that when
    // <AudioPlayer key={displayRegion}> remounts below, it can't briefly
    // see stale episodes from the region we just left. Without this the
    // remounted player would latch onto the previous region's audio_url
    // on its first render (matching the globally-playing episode and
    // showing a false "playing" state, or playing the wrong brief on tap).
    setEpisodes([]);
    setLatest([]);
    setToday([]);
    setLoading(true);
    const t = window.setTimeout(() => {
      setDisplayRegion(regionId);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setContentVisible(true));
      });
    }, 200);
    return () => window.clearTimeout(t);
  }, [regionId, displayRegion]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setVisibleCount(PAGE_SIZE);
    setLatest([]);
    setToday([]);
    setEpisodes([]);
    const load = async () => {

      const startOfTodayUtc = new Date();
      startOfTodayUtc.setUTCHours(0, 0, 0, 0);
      const todayIso = startOfTodayUtc.toISOString();

      const [{ data: articles }, { data: eps }] = await Promise.all([
        supabase
          .from("articles")
          .select("*")
          .eq("region", displayRegion)
          .order("published_at", { ascending: false })
          .limit(MAX_LATEST + TODAY_MAX + 20),
        supabase
          .from("episodes")
          .select("*")
          .eq("region", displayRegion)
          .order("date", { ascending: false })
          .limit(10),
      ]);
      if (cancelled) return;
      const dedupeByTitle = <T extends { title: string; id: string }>(list: T[]): T[] => {
        const seen = new Set<string>();
        return list.filter((a) => {
          const k = a.title.toLowerCase().replace(/\s+/g, " ").trim();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };
      const all = (articles ?? []) as any[];
      let latestList = dedupeByTitle(
        all.filter((a) => !a.is_in_brief && a.published_at >= todayIso) as Story[],
      ).slice(0, MAX_LATEST);
      const todayList = dedupeByTitle(
        all.filter((a) => a.is_in_brief && a.published_at >= todayIso) as Story[],
      ).slice(0, TODAY_MAX);

      if (latestList.length === 0 && todayList.length === 0) {
        latestList = dedupeByTitle(all as Story[]).slice(0, 10);
      } else if (latestList.length < 3) {
        const { data: globals } = await supabase
          .from("articles")
          .select("*")
          .eq("region", "global")
          .gte("published_at", todayIso)
          .order("published_at", { ascending: false })
          .limit(3);
        if (cancelled) return;
        const seen = new Set(latestList.map((a) => a.id));
        const extra = ((globals ?? []) as Story[])
          .filter((a) => !seen.has(a.id))
          .slice(0, 3 - latestList.length);
        latestList = dedupeByTitle([...latestList, ...extra]);
      }

      // Keep only the most recent episode per language.
      const byLang = new Map<string, any>();
      for (const e of (eps ?? []) as any[]) {
        if (!byLang.has(e.language_code)) byLang.set(e.language_code, e);
      }

      setLatest(latestList);
      setToday(todayList);
      setEpisodes(Array.from(byLang.values()));
      setLoading(false);
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [displayRegion]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const shown = open && visible;

  const desktopStyle: React.CSSProperties = {
    top: 20,
    left: 20,
    bottom: 20,
    width: 420,
    maxHeight: "calc(100vh - 40px)",
    borderRadius: 16,
    transform: shown ? "translateX(0)" : "translateX(-20px)",
    opacity: shown ? 1 : 0,
    transition: open
      ? "opacity 300ms ease-out, transform 300ms ease-out"
      : "opacity 250ms ease-in, transform 250ms ease-in",
    willChange: "transform, opacity",
  };

  const mobileStyle: React.CSSProperties = {
    left: 0,
    right: 0,
    bottom: 0,
    height: "80vh",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    transform: shown ? "translateY(0)" : "translateY(20px)",
    opacity: shown ? 1 : 0,
    transition: open
      ? "opacity 300ms ease-out, transform 300ms ease-out"
      : "opacity 250ms ease-in, transform 250ms ease-in",
    willChange: "transform, opacity",
  };

  const displayMeta = REGIONS[displayRegion];

  return (
    <aside
      className="fixed z-50 overflow-y-auto"
      style={{
          background: "rgba(17, 29, 46, 0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          pointerEvents: open ? "auto" : "none",
          ...(isMobile ? mobileStyle : desktopStyle),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/5 backdrop-blur-md"
          style={{ background: "rgba(17,29,46,0.75)" }}
        >
          <div
            className="text-sm font-semibold"
            style={{
              opacity: contentVisible ? 1 : 0,
              transition: "opacity 200ms ease-out",
            }}
          >
            {displayMeta.name} <span className="ml-1">{displayMeta.flags}</span>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="px-5 py-5 space-y-7"
          style={{
            opacity: contentVisible ? 1 : 0,
            transition: "opacity 200ms ease-out",
            willChange: "opacity",
          }}
        >
          <AudioPlayer
            key={displayRegion}
            episodes={episodes}
            languages={displayMeta.languages}
            regionId={displayRegion}
            regionName={displayMeta.name}
            regionFlags={displayMeta.flags}
          />


          <section>
            <h3 className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              ── Latest (since this morning's brief) ──
            </h3>
            <div className="space-y-3">
              {loading ? (
                <div className="glass rounded-xl h-24 animate-pulse" />
              ) : latest.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing new since the brief.</p>
              ) : (
                <>
                  {latest.slice(0, visibleCount).map((s) => (
                    <StoryCard key={s.id} story={s} showListen />
                  ))}
                  {latest.length > visibleCount && visibleCount < MAX_LATEST && (
                    <button
                      onClick={() =>
                        setVisibleCount((c) => Math.min(c + PAGE_SIZE, MAX_LATEST))
                      }
                      className="w-full mt-2 py-3 text-[11px] uppercase tracking-[0.2em] text-foreground/80 hover:text-primary bg-white/5 hover:bg-white/10 border border-white/15 hover:border-primary/40 rounded-lg transition-colors"
                    >
                      Show more ({Math.min(PAGE_SIZE, latest.length - visibleCount)} more)
                    </button>
                  )}
                </>
              )}
            </div>
          </section>


          <section>
            <h3 className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              ── Today's stories (in the morning brief) ──
            </h3>
            <div className="space-y-3">
              {loading ? (
                <div className="glass rounded-xl h-24 animate-pulse" />
              ) : (
                today.map((s) => (
                  <StoryCard
                    key={s.id}
                    story={s}
                    stripeAccent={s.source.toLowerCase() === "stripe"}
                  />
                ))
              )}
            </div>
          </section>

          <div className="pt-2 pb-6 text-center">
            <FeedbackModal />
          </div>
        </div>
    </aside>
  );
};
