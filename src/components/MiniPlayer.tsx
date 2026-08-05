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
      className={
        "fixed bottom-20 left-1/2 z-50 w-[360px] max-w-[calc(100vw-32px)] transition-all duration-300 ease-out " +
        (show
          ? "pointer-events-auto -translate-x-1/2 translate-y-0 opacity-100"
          : "pointer-events-none -translate-x-1/2 translate-y-3 opacity-0")
      }
    >
      {episode && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/90 px-4 py-3 text-foreground shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90">
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between gap-3">
              <button
                onClick={() => onExpand?.(episode.regionId)}
                className="min-w-0 truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
              >
                {episode.regionName} <span className="ml-0.5">{episode.regionFlags}</span>
              </button>
              <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
