import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  core: number;
  glow: number;
  baseOpacity: number;
  phase: number;
  period: number;
  color: string;
  vx: number;
  vy: number;
};

interface Props {
  /** Kept for API compatibility; bursts are disabled for a calmer look. */
  burstKey?: number;
}

const COLORS = [
  { rgb: "255,255,255", weight: 0.7 },
  { rgb: "180,210,255", weight: 0.2 },
  { rgb: "255,245,224", weight: 0.1 },
];

const pickColor = () => {
  const r = Math.random();
  let acc = 0;
  for (const c of COLORS) {
    acc += c.weight;
    if (r <= acc) return c.rgb;
  }
  return COLORS[0].rgb;
};

export const StarField = (_props: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const seed = () => {
      // Fixed low count — barely-there ambience
      const count = Math.floor(Math.min(60, Math.max(50, (w * h) / 30000)));
      const drifters = Math.min(6, Math.floor(count * 0.1));
      const stars: Star[] = [];
      for (let i = 0; i < count; i++) {
        const core = 1 + Math.random(); // 1-2px
        const glow = 4 + Math.random() * 2; // 4-6px
        const drifts = i < drifters;
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          core,
          glow,
          baseOpacity: 0.15 + Math.random() * 0.1, // 0.15-0.25
          phase: Math.random() * Math.PI * 2,
          period: 4 + Math.random() * 4,
          color: pickColor(),
          vx: drifts ? (Math.random() - 0.5) * 0.6 : 0,
          vy: drifts ? (Math.random() - 0.5) * 0.6 : 0,
        });
      }
      starsRef.current = stars;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      const stars = starsRef.current;

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        if (s.vx || s.vy) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.x < -s.glow) s.x = w + s.glow;
          if (s.x > w + s.glow) s.x = -s.glow;
          if (s.y < -s.glow) s.y = h + s.glow;
          if (s.y > h + s.glow) s.y = -s.glow;
        }
        const wave = (Math.sin((t / s.period) * Math.PI * 2 + s.phase) + 1) / 2;
        // Extremely subtle twinkle between 0.1 and baseOpacity (max ~0.25)
        const opacity = 0.1 + (s.baseOpacity - 0.1) * wave;

        // Soft radial halo — barely perceptible
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.glow);
        grad.addColorStop(0, `rgba(${s.color},${(opacity * 0.6).toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(${s.color},${(opacity * 0.15).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${s.color},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.glow, 0, Math.PI * 2);
        ctx.fill();

        // Small soft core
        ctx.fillStyle = `rgba(${s.color},${opacity.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.core, 0, Math.PI * 2);
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
};

export default StarField;
