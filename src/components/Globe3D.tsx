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

const EXTRA_TERRITORY_COUNTRIES: Record<string, string[]> = {
  benelux: ["lu"],
  "middle-east": ["om", "kw", "qa", "bh", "jo"],
  nordics: ["is"],
};

const ADMIN_NAME_TO_TERRITORY: Record<string, string> = {
  Norway: "nordics",
  France: "france",
  "Northern Cyprus": "middle-east",
  Kosovo: "cee",
  Somaliland: "middle-east",
};

type CountryFeature = {
  properties?: {
    ISO_A2?: string;
    [key: string]: any;
  };
  _territoryId?: RegionId | null;
  [key: string]: any;
};

type LabelDatum = {
  text: string;
  lat: number;
  lng: number;
};

type TooltipPos = {
  x: number;
  y: number;
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
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  const [ready, setReady] = useState(false);
  const [hoveredTerritory, setHoveredTerritory] = useState<RegionId | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const [animFrame, setAnimFrame] = useState(0);
  const resumeTimer = useRef<number | null>(null);

  // Keep the latest select handler in a ref so globe callbacks do not need to be
  // invalidated on every parent render.
  const onSelectRef = useRef(onSelectRegion);
  useEffect(() => {
    onSelectRef.current = onSelectRegion;
  }, [onSelectRegion]);

  const territoryIndexById = useMemo(() => {
    const m = new Map<string, number>();
    ACTIVE_TERRITORIES.forEach((t, i) => m.set(t.id, i));
    return m;
  }, []);

  const countryToTerritory = useMemo(() => {
    const m = new Map<string, RegionId>();

    for (const t of ACTIVE_TERRITORIES) {
      if (enabledSet && !enabledSet.has(t.id)) continue;

      for (const code of t.gnews_countries ?? []) {
        m.set(code.toLowerCase(), t.id);
      }

      for (const code of EXTRA_TERRITORY_COUNTRIES[t.id] ?? []) {
        m.set(code.toLowerCase(), t.id);
      }
    }

    return m;
  }, [enabledSet]);

  const polygonData = useMemo(
    () =>
      countries.map((feature) => {
        const iso = feature.properties?.ISO_A2?.toLowerCase();
        let territoryId: RegionId | null = null;

        if (iso && iso !== "-99") {
          territoryId = countryToTerritory.get(iso) ?? null;
        } else {
          // Fallback: match by ADMIN name for countries with broken ISO codes.
          const admin = feature.properties?.ADMIN;
          if (admin) {
            territoryId = ADMIN_NAME_TO_TERRITORY[admin] ?? null;
          }
        }

        // Only include if territory is enabled.
        if (territoryId && enabledSet && !enabledSet.has(territoryId)) {
          territoryId = null;
        }

        return { ...feature, _territoryId: territoryId };
      }),
    [countries, countryToTerritory, enabledSet],
  );

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
      .then((d) => {
        if (cancelled) return;
        setCountries((d.features ?? []) as CountryFeature[]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render the globe color functions often enough for the subtle territory
  // border pulse. This is intentionally lightweight: only territory polygons use
  // animated stroke color.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setAnimFrame((n) => n + 1);
    }, 80);

    return () => window.clearInterval(interval);
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
    if (size.w > 0 && countries.length) {
      const t = window.setTimeout(() => setReady(true), 60);
      return () => window.clearTimeout(t);
    }
  }, [size.w, countries.length]);

  const labels: LabelDatum[] = useMemo(
    () => [
      { text: "AMERICAS · COMING SOON", lat: 15, lng: -90 },
      { text: "APAC · COMING SOON", lat: 20, lng: 115 },
    ],
    [],
  );

  const htmlElement = useCallback((d: any) => {
    const l = d as LabelDatum;
    const el = document.createElement("div");

    el.setAttribute("data-coming-soon", "true");
    el.style.pointerEvents = "none";
    el.style.transform = "translate(-50%, -50%)";
    el.style.color = "#8A7F72";
    el.style.fontSize = "10px";
    el.style.letterSpacing = "0.2em";
    el.style.fontWeight = "600";
    el.style.whiteSpace = "nowrap";
    el.style.fontFamily = "Inter,system-ui,sans-serif";
    el.style.textShadow = "0 1px 6px rgba(0,0,0,0.6)";
    el.textContent = l.text;

    return el;
  }, []);

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

  const activeTooltipRegion = hoveredTerritory;
  const tooltipRegionMeta = activeTooltipRegion ? REGIONS[activeTooltipRegion] : null;
  const tooltipCount = activeTooltipRegion ? counts[activeTooltipRegion] ?? 0 : 0;

  // Keep tooltip anchored above the territory center while the globe rotates.
  useEffect(() => {
    if (!activeTooltipRegion || !tooltipRegionMeta) {
      setTooltipPos(null);
      return;
    }

    let raf = 0;

    const update = () => {
      const g = globeRef.current as any;
      const el = containerRef.current;

      if (!g || !el) {
        raf = requestAnimationFrame(update);
        return;
      }

      const coords = g.getScreenCoords(tooltipRegionMeta.lat, tooltipRegionMeta.lng, 0.03);

      if (coords) {
        setTooltipPos({
          x: Math.max(12, Math.min(size.w - 12, coords.x)),
          y: Math.max(12, Math.min(size.h - 12, coords.y - 24)),
        });
      }

      raf = requestAnimationFrame(update);
    };

    update();

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeTooltipRegion, tooltipRegionMeta, size.w, size.h]);

  const isFocusedTerritory = (territoryId?: RegionId | null) =>
  !!territoryId && (territoryId === hoveredTerritory || territoryId === activeRegion);

  const getPolygonCapColor = (d: any) => {
    void animFrame; // ensure re-eval on tick

    const territoryId = (d as CountryFeature)._territoryId;

    // Hovered or selected → bright teal glow
    if (isFocusedTerritory(territoryId)) {
      return "rgba(15, 95, 122, 0.35)";
    }

    // Territory polygon at rest → pulsating teal fill
    if (territoryId) {
      const territoryIndex = territoryIndexById.get(territoryId) ?? 0;
      const phase = (Date.now() / 3500 + territoryIndex * 0.114) * Math.PI * 2;
      const opacity = 0.10 + 0.15 * (0.5 + 0.5 * Math.sin(phase));
      return `rgba(15, 95, 122, ${opacity.toFixed(3)})`;
    }

    // Non-territory country → warm gray-brown
    return "rgba(168, 155, 138, 0.85)";
  };

  const getPolygonStrokeColor = (d: any) => {
    void animFrame;

    const territoryId = (d as CountryFeature)._territoryId;

    // Non-territory country → warm gray border
    if (!territoryId) {
      return "#B8AFA3";
    }

    // Hovered or selected → strong teal border
    if (isFocusedTerritory(territoryId)) {
      return "rgba(15, 95, 122, 0.9)";
    }

    // Territory polygon at rest → pulsating teal border
    const territoryIndex = territoryIndexById.get(territoryId) ?? 0;
    const phase = (Date.now() / 3500 + territoryIndex * 0.114) * Math.PI * 2;
    const opacity = 0.10 + 0.40 * (0.5 + 0.5 * Math.sin(phase));

    return `rgba(15, 95, 122, ${opacity.toFixed(3)})`;
  };

  const getPolygonAltitude = (d: any) => {
    const territoryId = (d as CountryFeature)._territoryId;
    return isFocusedTerritory(territoryId) ? 0.012 : 0.005;
  };

  const handlePolygonHover = useCallback((polygon: any | null) => {
    const territoryId = (polygon as CountryFeature | null)?._territoryId ?? null;
    setHoveredTerritory(territoryId);
  }, []);

  const handlePolygonClick = useCallback((polygon: any | null) => {
    const territoryId = (polygon as CountryFeature | null)?._territoryId ?? null;
    if (!territoryId) return;

    onSelectRef.current?.(territoryId);
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
    if (hoveredTerritory) return;

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
        cursor: hoveredTerritory ? "pointer" : "grab",
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
          atmosphereColor="#B8A89A"
          atmosphereAltitude={0.12}
          globeMaterial={
            new THREE.MeshPhongMaterial({
              color: new THREE.Color("#C8BFB0"),
              emissive: new THREE.Color("#A89F94"),
              shininess: 8,
            })
          }
          polygonsData={polygonData}
          polygonCapColor={getPolygonCapColor}
          polygonSideColor={() => "rgba(168, 155, 138, 0.4)"}
          polygonStrokeColor={getPolygonStrokeColor}
          polygonAltitude={getPolygonAltitude}
          polygonsTransitionDuration={0}
          onPolygonHover={handlePolygonHover}
          onPolygonClick={handlePolygonClick}
          arcsData={arcs}
          arcColor={() => "rgba(15, 95, 122, 0.25)"}
          arcStroke={0.4}
          arcAltitudeAutoScale={0.5}
          arcDashLength={0.15}
          arcDashGap={3.5}
          arcDashInitialGap={(d: any) => d.dashInitialGap}
          arcDashAnimateTime={5000}
          arcsTransitionDuration={0}
          htmlElementsData={labels}
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

      {tooltipRegionMeta && tooltipPos && (
        <div
          className="pointer-events-none absolute z-50 rounded-md border border-border bg-slate-950/95 px-2 py-1 text-[11px] text-white shadow-lg"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: "translate(-50%, -100%)",
            fontFamily: "Inter, system-ui, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          <span>
            {tooltipRegionMeta.name}{" "}
            <span className="ml-0.5">{tooltipRegionMeta.flags}</span> ·{" "}
            {tooltipCount} {tooltipCount === 1 ? "story" : "stories"}
          </span>
          <div
            className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-border bg-slate-950/95"
            aria-hidden="true"
          />
        </div>
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