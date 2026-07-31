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
  stripe_play?: string | null;
  stripe_products?: string[] | null;
  proof_point_text?: string | null;
  success_story_id?: string | null;
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
  proofPointUrl,
}: {
  story: Story;
  showListen?: boolean;
  stripeAccent?: boolean;
  proofPointUrl?: string;
}) => {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return subscribeArticleAudio(({ id, playing }) => {
      setPlaying(id === story.id && playing);
    });
  }, [story.id]);

  const canListen = !!story.article_audio_url;
  const hasStripePlay = !!story.stripe_play?.trim();
  const stripeProducts = story.stripe_products?.filter(Boolean) ?? [];
  const proofPoint = story.proof_point_text?.trim();

  const handleListen = () => {
    if (!story.article_audio_url) return;
    toggleArticleAudio(story.id, story.article_audio_url);
  };

  return (
    <article
      className={`glass rounded-xl p-5 transition-all duration-200 hover:border-foreground/20 ${
        stripeAccent ? "border-l-4 !border-l-[hsl(var(--stripe))]" : ""
      }`}
    >
      <div className="mb-2 flex items-start gap-2">
        {story.is_breaking && (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
            Hot
          </span>
        )}

        <h3 className="font-serifDisplay text-lg leading-snug text-foreground">
          {story.title}
        </h3>
      </div>

      {story.summary && (
        <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
          {story.summary}
        </p>
      )}

      {hasStripePlay && (
        <div className="mb-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 dark:border-[rgba(218,165,32,0.22)] dark:bg-zinc-950/35">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary dark:text-[rgba(218,165,32,0.95)]">
            ⚡ Stripe Play
          </div>

          <p className="text-xs leading-relaxed text-foreground/85 dark:text-zinc-100/90">
            {story.stripe_play}
          </p>

          {stripeProducts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stripeProducts.map((product) => (
                <span
                  key={product}
                  className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground/75 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-300"
                >
                  {product}
                </span>
              ))}
            </div>
          )}

          {proofPoint && (
            <p className="mt-2 border-l border-primary/30 pl-2 text-[11px] leading-relaxed text-muted-foreground dark:border-[rgba(218,165,32,0.35)] dark:text-zinc-400">
              {proofPointUrl ? (
                <a
                  href={proofPointUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 transition-colors hover:text-foreground hover:underline dark:hover:text-zinc-300"
                >
                  📊 “{proofPoint}”
                </a>
              ) : (
                <>📊 “{proofPoint}”</>
              )}
            </p>
          )}
        </div>
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
              className="h-8 text-xs"
            >
              {playing ? "⏸ Pause" : "▶ Listen"}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            asChild
            className="h-8 border-border bg-transparent text-xs hover:bg-secondary"
          >
            <a href={story.url} target="_blank" rel="noreferrer">
              ↗ Read
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
};