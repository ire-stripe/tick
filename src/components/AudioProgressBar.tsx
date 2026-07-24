import { useEffect, useRef, useState } from "react";

interface Props {
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  compact?: boolean;
}

export const AudioProgressBar = ({ currentTime, duration, onSeek, compact }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pct = duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const barH = compact ? 3 : 4;
  const dotSize = compact ? 10 : 12;

  const seekFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(p * duration);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => seekFromEvent(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, duration]);

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setDragging(true);
        seekFromEvent(e.clientX);
      }}
      className="relative cursor-pointer group select-none"
      style={{ height: Math.max(barH, dotSize), display: "flex", alignItems: "center" }}
    >
      <div
        className="absolute inset-x-0 rounded-full bg-muted"
        style={{ height: barH, top: "50%", transform: "translateY(-50%)" }}
      />
      <div
        className="absolute rounded-full bg-primary"
        style={{
          height: barH,
          width: `${pct}%`,
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          transition: dragging ? "none" : "width 75ms linear",
        }}
      />
      <div
        className="absolute rounded-full bg-primary ring-2 ring-card shadow-[0_1px_4px_rgba(26,26,26,0.18)]"
        style={{
          width: dotSize,
          height: dotSize,
          left: `${pct}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          transition: dragging ? "none" : "left 75ms linear",
        }}
      />
    </div>
  );
};
