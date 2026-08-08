import { useEffect, useRef, useState } from "react";
import { GlobeMethods } from "react-globe.gl";
import { REGIONS, RegionId } from "@/lib/regions";

export type AmbientItem = { title: string; region: RegionId };

interface Props {
  globeRef: React.MutableRefObject<GlobeMethods | undefined>;
  items: AmbientItem[];
  hidden: boolean;
}

const FADE_MS = 1000;
const HOLD_MS = 3500;
const GAP_MS = 2000;

/**
 * Cycles through today's headlines and pins each near its territory dot.
 * Uses CSS opacity transitions only. Position is tracked via rAF so the
 * label stays anchored to the (rotating) globe.
 */
export const AmbientHeadlines = ({ globeRef, items, hidden }: Props) => {
  const [current, setCurrent] = useState<AmbientItem | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isLight, setIsLight] = useState(false);
  const shuffleRef = useRef<AmbientItem[]>([]);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const readTheme = () => setIsLight(document.documentElement.classList.contains("light"));
    readTheme();

    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hidden || items.length < 5) {
      clearTimers();
      setVisible(false);
      const t = window.setTimeout(() => setCurrent(null), FADE_MS);
      timers.current.push(t);
      return () => clearTimers();
    }

    let cancelled = false;

    const pickNext = (): AmbientItem | null => {
      if (shuffleRef.current.length === 0) {
        shuffleRef.current = [...items].sort(() => Math.random() - 0.5);
      }
      return shuffleRef.current.shift() ?? null;
    };

    const cycle = () => {
      if (cancelled) return;
      const next = pickNext();
      if (!next) return;
      setCurrent(next);
      setVisible(false);
      // Kick fade-in on next frame so the transition applies from 0.
      const t1 = window.setTimeout(() => setVisible(true), 30);
      const t2 = window.setTimeout(() => setVisible(false), 30 + FADE_MS + HOLD_MS);
      const t3 = window.setTimeout(cycle, 30 + FADE_MS + HOLD_MS + FADE_MS + GAP_MS);
      timers.current.push(t1, t2, t3);
    };

    cycle();

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [items, hidden]);

  // Track screen position of the current headline
  useEffect(() => {
    if (!current) {
      setPos(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const g = globeRef.current as any;
      if (g?.getScreenCoords) {
        const r = REGIONS[current.region];
        const c = g.getScreenCoords(r.lat, r.lng);
        if (c && !Number.isNaN(c.x) && !Number.isNaN(c.y)) {
          setPos({ x: c.x, y: c.y });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current, globeRef]);

  if (!current || !pos) return null;

  const text =
    current.title.length > 60
      ? current.title.slice(0, 60).trimEnd() + "…"
      : current.title;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: pos.x,
        top: pos.y - 22,
        transform: "translate(-50%, -100%)",
        opacity: visible ? (isLight ? 0.46 : 0.24) : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        color: isLight ? "#334155" : "#fff",
        fontSize: "12px",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 500,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        textShadow: isLight
          ? "0 1px 2px rgba(255,255,255,0.95), 0 0 18px rgba(255,255,255,0.75)"
          : "0 1px 4px rgba(0,0,0,0.6), 0 0 18px rgba(0,0,0,0.35)",
        zIndex: 5,
      }}
    >
      {text}
    </div>
  );
};
