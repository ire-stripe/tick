import { useEffect, useRef, useState } from "react";

interface Headline {
  id: string;
  title: string;
  url: string;
  is_breaking: boolean;
}

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

  return (
    <div className="ticker-perspective border-t border-white/10 bg-card/40">
      <div className="ticker-tilt max-w-7xl mx-auto flex items-center gap-4 px-4 py-3">
        <span className="shrink-0 font-bold text-xs tracking-widest text-primary">
          BREAKING NEWS
        </span>

        <div className="flex-1 overflow-hidden select-none">
          <div className="ticker-track flex gap-8 whitespace-nowrap w-max">
            {loop.map((h, i) => {
              const content = (
                <>
                  {h.is_breaking && (
                    <span className="text-destructive mr-1.5">🔴</span>
                  )}
                  {h.title}
                  <span className="text-muted-foreground/50 ml-8">·</span>
                </>
              );

              const className = isFallback
                ? "text-sm text-muted-foreground"
                : "text-sm text-foreground/90 hover:text-primary transition-colors";

              return isFallback ? (
                <span key={`${h.id}-${i}`} className={className}>
                  {content}
                </span>
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