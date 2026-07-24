import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { subscribeArticleAudio, toggleArticleAudio } from "@/lib/articleAudio";

export interface Story {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string | null;
  is_breaking: boolean;
  created_at: string;
  published_at: string;
  article_audio_url?: string | null;
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export const StoryCard = ({
  story,
  showListen,
  stripeAccent,
}: {
  story: Story;
  showListen?: boolean;
  stripeAccent?: boolean;
}) => {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return subscribeArticleAudio(({ id, playing }) => {
      setPlaying(id === story.id && playing);
    });
  }, [story.id]);

  const canListen = !!story.article_audio_url;

  const handleListen = () => {
    if (!story.article_audio_url) return;
    toggleArticleAudio(story.id, story.article_audio_url);
  };

  return (
    <article
      className={`rounded-xl border border-border-subtle bg-card p-5 shadow-sm transition-all duration-200 hover:border-border hover:shadow-md ${
        stripeAccent ? "border-l-4 !border-l-primary" : ""
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        {story.is_breaking && (
          <span className="shrink-0 mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
            Hot
          </span>
        )}
        <h3 className="font-serifDisplay text-xl leading-snug text-foreground">
          {story.title}
        </h3>
      </div>

      {story.summary && (
        <p className="text-sm leading-relaxed text-muted-foreground mb-3 line-clamp-2">
          {story.summary}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {story.source} · {relTime(story.published_at)}
        </span>
        <div className="flex gap-2">
          {showListen && canListen && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleListen}
              className="h-8 text-xs bg-muted text-foreground hover:bg-border"
            >
              {playing ? "⏸ Pause" : "▶ Listen"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="h-8 text-xs border-border bg-card hover:bg-muted hover:text-primary"
          >
            <a href={story.url} target="_blank" rel="noreferrer">↗ Read</a>
          </Button>
        </div>
      </div>
    </article>
  );
};

