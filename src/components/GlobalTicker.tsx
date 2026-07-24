import { useEffect, useRef, useState } from "react";

interface Headline {
  id: string;
  title: string;
  url: string;
  is_breaking: boolean;
}

const DURATION_SEC = 60; // baseline: full loop across half the duplicated track
const DRAG_THRESHOLD_PX = 5;
const DECAY_TAU = 0.35; // seconds; ~1.5s to settle back to baseline

export const GlobalTicker = ({ headlines }: { headlines: Headline[] }) => {
  const fallback: Headline[] = Array.from({ length: 6 }, (_, i) => ({
    id: `fallback-${i}`,
    title: "The city sleeps. Check back later.",
    url: "#",
    is_breaking: false,
  }));
  const source = headlines.length ? headlines : fallback;
  const loop = [...source, ...source];
  const isFallback = headlines.length === 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const halfWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // velocity in px/sec (negative = leftward = normal direction)
  const velocityRef = useRef(0);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const dragMovedRef = useRef(false);
  const lastMoveXRef = useRef(0);
  const lastMoveTsRef = useRef(0);
  const instantVelocityRef = useRef(0);

  const [isDragging, setIsDragging] = useState(false);

  const baselineVelocity = () =>
    halfWidthRef.current > 0 ? -halfWidthRef.current / DURATION_SEC : 0;

  // Measure half of the duplicated track width
  useEffect(() => {
    const measure = () => {
      if (trackRef.current) {
        halfWidthRef.current = trackRef.current.scrollWidth / 2;
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [loop.length]);

  const wrapOffset = (v: number) => {
    const half = halfWidthRef.current;
    if (half <= 0) return v;
    let x = v % half;
    if (x > 0) x -= half;
    return x; // keeps x in (-half, 0]
  };

  // Animation loop
  useEffect(() => {
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const base = baselineVelocity();
      if (draggingRef.current) {
        // Position is driven directly by pointer move; nothing to do here.
      } else if (halfWidthRef.current > 0) {
        // Exponential decay of velocity toward baseline
        const k = 1 - Math.exp(-dt / DECAY_TAU);
        velocityRef.current += (base - velocityRef.current) * k;
        offsetRef.current = wrapOffset(offsetRef.current + velocityRef.current * dt);
        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, []);

  const pointerActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  const handleWindowMove = (e: PointerEvent) => {
    if (!pointerActiveRef.current || e.pointerId !== pointerIdRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    if (!draggingRef.current) {
      if (Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      dragMovedRef.current = true;
      setIsDragging(true);
    }
    e.preventDefault();
    offsetRef.current = wrapOffset(dragStartOffsetRef.current + dx);
    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
    }
    const now = performance.now();
    const stepDt = (now - lastMoveTsRef.current) / 1000;
    if (stepDt > 0) {
      const stepDx = e.clientX - lastMoveXRef.current;
      const inst = stepDx / stepDt;
      instantVelocityRef.current =
        instantVelocityRef.current * 0.6 + inst * 0.4;
    }
    lastMoveXRef.current = e.clientX;
    lastMoveTsRef.current = now;
  };

  const handleWindowUp = (e: PointerEvent) => {
    if (!pointerActiveRef.current || e.pointerId !== pointerIdRef.current) return;
    pointerActiveRef.current = false;
    pointerIdRef.current = null;
    window.removeEventListener("pointermove", handleWindowMove);
    window.removeEventListener("pointerup", handleWindowUp);
    window.removeEventListener("pointercancel", handleWindowUp);
    if (draggingRef.current) {
      draggingRef.current = false;
      setIsDragging(false);
      velocityRef.current = instantVelocityRef.current;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointerActiveRef.current = true;
    pointerIdRef.current = e.pointerId;
    draggingRef.current = false;
    dragMovedRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = offsetRef.current;
    lastMoveXRef.current = e.clientX;
    lastMoveTsRef.current = performance.now();
    instantVelocityRef.current = 0;
    window.addEventListener("pointermove", handleWindowMove, { passive: false });
    window.addEventListener("pointerup", handleWindowUp);
    window.addEventListener("pointercancel", handleWindowUp);
  };

  // Cleanup window listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", handleWindowUp);
      window.removeEventListener("pointercancel", handleWindowUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClickCapture = (e: React.MouseEvent) => {
    if (dragMovedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      dragMovedRef.current = false;
    }
  };

  return (
    <div className="ticker-perspective border-t border-white/10 bg-card/40">
      <div className="ticker-tilt max-w-7xl mx-auto flex items-center gap-4 px-4 py-3">
        <span className="shrink-0 font-bold text-xs tracking-widest text-primary">BREAKING NEWS</span>
        <div
          className="flex-1 overflow-hidden touch-pan-y select-none"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
        >
          <div
            ref={trackRef}
            className="flex gap-8 whitespace-nowrap w-max will-change-transform"
          >
            {loop.map((h, i) => {
              const content = (
                <>
                  {h.is_breaking && <span className="text-destructive mr-1.5">🔴</span>}
                  {h.title}
                  <span className="text-muted-foreground/50 ml-8">·</span>
                </>
              );
              const className = isFallback
                ? "text-sm text-muted-foreground"
                : "text-sm text-foreground/90 hover:text-primary transition-colors";
              return isFallback ? (
                <span key={`${h.id}-${i}`} className={className}>{content}</span>
              ) : (
                <a
                  key={`${h.id}-${i}`}
                  href={h.url}
                  target="_blank"
                  rel="noreferrer"
                  draggable={false}
                  className={className}
                >
                  {content}
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
