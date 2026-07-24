import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { ACTIVE_TERRITORIES, REGIONS, RegionId } from "@/lib/regions";
import { AmbientHeadlines, AmbientItem } from "./AmbientHeadlines";

interface Props {
  counts: Record<string, number>;
  activeRegion?: RegionId | null;
  onSelectRegion?: (id: RegionId) => void;
  onCloseRegion?: () => void;
  ambientHeadlines?: AmbientItem[];
  enabledRegions?: string[];
}

const COUNTRIES_URL =
  "https://unpkg.com/three-globe/example/country-polygons/ne_110m_admin_0_countries.geojson";

const DEFAULT_ALT = 2.5;
const FOCUS_ALT = 0.9;

type PointDatum = {
  id: RegionId;
  name: string;
  flags: string;
  lat: number;
  lng: number;
  count: number;
};

type LabelDatum = {
  text: string;
  lat: number;
  lng: number;
};

export const Globe3D = ({
  counts,
  activeRegion = null,
  onSelectRegion,
  onCloseRegion,
  ambientHeadlines = [],
  enabledRegions,
}: Props) => {
  const enabledSet = useMemo(
    () => (enabledRegions ? new Set(enabledRegions) : null),
    [enabledRegions],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [countries, setCountries] = useState<any>({ features: [] });
  const [ready, setReady] = useState(false);
  const resumeTimer = useRef<number | null>(null);

  // Keep the latest select handler in a ref so the memoized htmlElement
  // callback can call it without being invalidated on every parent render.
  const onSelectRef = useRef(onSelectRegion);
  useEffect(() => {
    onSelectRef.current = onSelectRegion;
  }, [onSelectRegion]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((d) => !cancelled && setCountries(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Init controls / auto-rotate once globe ready
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const controls: any = g.controls();
    controls.autoRotate = !activeRegion;
    controls.autoRotateSpeed = 0.3;
    controls.enableZoom = true;
    controls.minDistance = 130;
    controls.maxDistance = 500;
    controls.rotateSpeed = 0.9;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    const stop = () => {
      controls.autoRotate = false;
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [ready, activeRegion]);

  // Fly-to on region change
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const controls: any = g.controls();
    if (activeRegion) {
      const r = REGIONS[activeRegion];
      controls.autoRotate = false;
      g.pointOfView({ lat: r.lat, lng: r.lng, altitude: FOCUS_ALT }, 800);
    } else {
      g.pointOfView({ altitude: DEFAULT_ALT }, 800);
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
      resumeTimer.current = window.setTimeout(() => {
        const c: any = globeRef.current?.controls();
        if (c) c.autoRotate = true;
      }, 2000);
    }
  }, [activeRegion, ready]);

  // Fade-in once loaded
  useEffect(() => {
    if (size.w > 0 && countries.features?.length) {
      const t = window.setTimeout(() => setReady(true), 60);
      return () => window.clearTimeout(t);
    }
  }, [size.w, countries]);

  // Memoize points so react-globe.gl doesn't rebuild DOM elements on every
  // parent re-render (which was killing tooltip hover state during playback).
  const points: PointDatum[] = useMemo(
    () =>
      ACTIVE_TERRITORIES
        .filter((t) => !enabledSet || enabledSet.has(t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          flags: t.flags,
          lat: t.lat,
          lng: t.lng,
          count: counts[t.id] ?? 0,
        })),
    [counts, enabledSet],
  );

  const labels: LabelDatum[] = useMemo(
    () => [
      { text: "AMERICAS · COMING SOON", lat: 15, lng: -90 },
      { text: "APAC · COMING SOON", lat: 20, lng: 115 },
    ],
    [],
  );

  const htmlData = useMemo(() => [...points, ...labels], [points, labels]);

  // Arcs computed dynamically from the territories config: connect each
  // territory to its two nearest neighbors, dedup pairs. Memoized with
  // stable identity so switching regions never re-inits dash animation.
  const arcs = useMemo(() => {
    const ts = ACTIVE_TERRITORIES;
    const dist = (a: typeof ts[number], b: typeof ts[number]) => {
      const dLat = a.lat - b.lat;
      const dLng = a.lng - b.lng;
      return dLat * dLat + dLng * dLng;
    };
    const seen = new Set<string>();
    const pairs: Array<[string, string]> = [];
    ts.forEach((t) => {
      const others = ts
        .filter((o) => o.id !== t.id)
        .sort((a, b) => dist(t, a) - dist(t, b))
        .slice(0, 2);
      others.forEach((o) => {
        const key = [t.id, o.id].sort().join("|");
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push([t.id, o.id]);
      });
    });
    return pairs.map(([a, b], i) => ({
      startLat: REGIONS[a].lat,
      startLng: REGIONS[a].lng,
      endLat: REGIONS[b].lat,
      endLng: REGIONS[b].lng,
      dashInitialGap: (i * 0.9) % 4,
    }));
  }, []);

  const htmlElement = useCallback((d: any) => {
    const el = document.createElement("div");
    if ("id" in d) {
      const p = d as PointDatum;
      el.setAttribute("data-region-dot", "true");
      el.style.pointerEvents = "auto";
      el.style.cursor = "pointer";
      el.style.transform = "translate(-50%, -50%)";
      el.innerHTML = `
        <div style="position:relative;display:flex;align-items:center;justify-content:center;">
          <div class="region-dot" style="width:8px;height:8px;"></div>
          <div class="region-tooltip" style="
            position:absolute;left:50%;transform:translateX(-50%);
            background:hsl(215 42% 12% / 0.95);border:1px solid hsl(0 0% 100% / 0.1);
            color:#fff;font-size:11px;padding:4px 8px;border-radius:6px;white-space:nowrap;
            opacity:0;visibility:hidden;pointer-events:none;transition:opacity 120ms ease;
            font-family:Inter,system-ui,sans-serif;z-index:9999;
          ">
            <span>${p.name} <span style="margin-left:2px">${p.flags}</span> · ${p.count} ${p.count === 1 ? "story" : "stories"}</span>
            <div class="region-tooltip-caret" style="
              position:absolute;left:50%;width:8px;height:8px;
              background:hsl(215 42% 12% / 0.95);
              border-right:1px solid hsl(0 0% 100% / 0.1);
              border-bottom:1px solid hsl(0 0% 100% / 0.1);
            "></div>
          </div>
        </div>
      `;
      const tip = el.querySelector<HTMLElement>(".region-tooltip");
      const caret = el.querySelector<HTMLElement>(".region-tooltip-caret");
      const positionTip = () => {
        if (!tip || !caret) return;
        tip.style.top = "";
        tip.style.bottom = "16px";
        tip.style.left = "50%";
        tip.style.transform = "translateX(-50%)";
        caret.style.top = "";
        caret.style.bottom = "-5px";
        caret.style.transform = "translateX(-50%) rotate(45deg)";
        requestAnimationFrame(() => {
          const r = tip.getBoundingClientRect();
          if (r.top < 12) {
            tip.style.bottom = "";
            tip.style.top = "16px";
            caret.style.bottom = "";
            caret.style.top = "-5px";
            caret.style.transform = "translateX(-50%) rotate(225deg)";
          }
          const vw = window.innerWidth;
          const r2 = tip.getBoundingClientRect();
          let shift = 0;
          if (r2.right > vw - 8) shift = -(r2.right - (vw - 8));
          else if (r2.left < 8) shift = 8 - r2.left;
          const labels = document.querySelectorAll<HTMLElement>("[data-coming-soon]");
          const test = { left: r2.left + shift, right: r2.right + shift, top: r2.top, bottom: r2.bottom };
          labels.forEach((lab) => {
            const lr = lab.getBoundingClientRect();
            const overlap = !(test.right < lr.left || test.left > lr.right || test.bottom < lr.top || test.top > lr.bottom);
            if (overlap) {
              const shiftLeft = -(test.right - lr.left + 8);
              const shiftRight = lr.right - test.left + 8;
              const extra = Math.abs(shiftLeft) < Math.abs(shiftRight) ? shiftLeft : shiftRight;
              shift += extra;
              test.left += extra;
              test.right += extra;
            }
          });
          if (shift !== 0) {
            tip.style.transform = `translateX(calc(-50% + ${shift}px))`;
            caret.style.transform = `translateX(calc(-50% - ${shift}px)) rotate(${caret.style.transform.includes("225") ? "225" : "45"}deg)`;
          }
        });
      };
      el.addEventListener("mouseenter", () => {
        if (!tip) return;
        el.style.zIndex = "9999";
        tip.style.visibility = "visible";
        tip.style.opacity = "1";
        positionTip();
      });
      el.addEventListener("mouseleave", () => {
        if (!tip) return;
        tip.style.opacity = "0";
        tip.style.visibility = "hidden";
        el.style.zIndex = "";
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectRef.current?.(p.id);
      });
    } else {
      const l = d as LabelDatum;
      el.setAttribute("data-coming-soon", "true");
      el.style.pointerEvents = "none";
      el.style.transform = "translate(-50%, -50%)";
      el.style.color = "hsl(215 15% 55%)";
      el.style.fontSize = "10px";
      el.style.letterSpacing = "0.2em";
      el.style.fontWeight = "600";
      el.style.whiteSpace = "nowrap";
      el.style.fontFamily = "Inter,system-ui,sans-serif";
      el.style.textShadow = "0 1px 6px rgba(0,0,0,0.6)";
      el.textContent = l.text;
    }
    return el;
  }, []);

  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!activeRegion) return;
    pressRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!activeRegion) return;
    const p = pressRef.current;
    pressRef.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const dist = Math.hypot(dx, dy);
    const elapsed = Date.now() - p.t;
    if (dist > 5 || elapsed > 200) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-region-dot]")) return;
    onCloseRegion?.();
  };

  // Trackpad two-finger swipe → rotate globe. Pinch zoom (ctrlKey=true) is
  // left to OrbitControls. Momentum keeps the globe spinning briefly after
  // the swipe ends, decaying to zero.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;

    const vel = { lat: 0, lng: 0 };
    let raf = 0;
    let lastWheelTs = 0;

    const applyDelta = (dLat: number, dLng: number) => {
      const g = globeRef.current;
      if (!g) return;
      const pov = g.pointOfView();
      g.pointOfView(
        {
          lat: Math.max(-85, Math.min(85, pov.lat + dLat)),
          lng: pov.lng + dLng,
          altitude: pov.altitude,
        },
        0,
      );
    };

    const tick = () => {
      // decay
      vel.lat *= 0.92;
      vel.lng *= 0.92;
      if (Math.abs(vel.lat) < 0.002 && Math.abs(vel.lng) < 0.002) {
        raf = 0;
        return;
      }
      // Only run inertia after user has stopped scrolling for >80ms — otherwise
      // wheel deltas double-apply and the globe jitters.
      if (performance.now() - lastWheelTs > 80) {
        applyDelta(vel.lat, vel.lng);
      }
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom → let OrbitControls handle
      e.preventDefault();
      e.stopPropagation();
      const controls: any = globeRef.current?.controls();
      if (controls) controls.autoRotate = false;

      // Sensitivity: convert scroll pixels to degrees. Negative Y so pushing
      // two fingers up rotates the globe up (view tilts down).
      const k = 0.12;
      const dLng = e.deltaX * k;
      const dLat = -e.deltaY * k;
      applyDelta(dLat, dLng);

      // Blend into velocity for momentum after the gesture ends.
      vel.lat = vel.lat * 0.5 + dLat * 0.5;
      vel.lng = vel.lng * 0.5 + dLng * 0.5;
      lastWheelTs = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
    };

    // Capture phase + non-passive so we can preventDefault ahead of
    // OrbitControls' own wheel listener.
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true } as any);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ready]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{
        opacity: ready ? 1 : 0,
        transition: "opacity 500ms ease-out",
        touchAction: "none",
      }}
    >
      {size.w > 0 && (
        <Globe
          ref={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          showGlobe
          showAtmosphere
          atmosphereColor="#4a6fa5"
          atmosphereAltitude={0.18}
          globeMaterial={
            new THREE.MeshPhongMaterial({
              color: new THREE.Color("#0a1628"),
              emissive: new THREE.Color("#0a1628"),
              shininess: 4,
            })
          }
          polygonsData={countries.features}
          polygonCapColor={() => "rgba(26, 42, 63, 0.85)"}
          polygonSideColor={() => "rgba(10, 22, 40, 0.6)"}
          polygonStrokeColor={() => "#2a3a5f"}
          polygonAltitude={0.005}
          arcsData={arcs}
          arcColor={() => "rgba(74, 111, 165, 0.22)"}
          arcStroke={0.4}
          arcAltitudeAutoScale={0.5}
          arcDashLength={0.15}
          arcDashGap={3.5}
          arcDashInitialGap={(d: any) => d.dashInitialGap}
          arcDashAnimateTime={5000}
          arcsTransitionDuration={0}
          htmlElementsData={htmlData}
          htmlLat={(d: any) => d.lat}
          htmlLng={(d: any) => d.lng}
          htmlAltitude={0.01}
          htmlElement={htmlElement}
          onGlobeReady={() => {
            const g = globeRef.current;
            if (!g) return;
            g.pointOfView({ lat: 30, lng: 15, altitude: DEFAULT_ALT }, 0);
          }}
        />
      )}
      <AmbientHeadlines
        globeRef={globeRef}
        items={ambientHeadlines}
        hidden={!!activeRegion}
      />
    </div>
  );
};

export default Globe3D;
