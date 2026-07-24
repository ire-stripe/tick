import { X } from "lucide-react";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { AudioProgressBar } from "@/components/AudioProgressBar";

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  visible: boolean;
  onExpand?: (regionId: string) => void;
}

export const MiniPlayer = ({ visible, onExpand }: Props) => {
  const { episode, playing, currentTime, duration, toggle, seek, stop } = useAudioPlayer();
  const show = !!episode && visible;

  return (
    <div
      className="fixed z-50"
      style={{
        right: 20,
        bottom: 80,
        width: 320,
        maxWidth: "calc(100vw - 40px)",
        pointerEvents: show ? "auto" : "none",
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 300ms ease-out, transform 300ms ease-out",
      }}
    >
      {episode && (
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{
            background: "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid var(--border-default)",
            boxShadow: "0 16px 44px rgba(26,26,26,0.14)",
          }}
        >
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <button
                onClick={() => onExpand?.(episode.regionId)}
                className="text-xs font-semibold truncate text-left hover:text-primary transition-colors"
              >
                {episode.regionName} <span className="ml-0.5">{episode.regionFlags}</span>
              </button>
              <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {fmt(currentTime)} / {fmt(duration || 0)}
              </div>
            </div>
            <AudioProgressBar
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
              compact
            />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              stop();
            }}
            aria-label="Close mini player"
            className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
