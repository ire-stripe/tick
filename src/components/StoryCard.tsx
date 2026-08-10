import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
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
  target_industries?: string[] | null;
  proof_point_text?: string | null;
  success_story_id?: string | null;
}

type EmailDraft = {
  id: string;
  article_id: string;
  prompt_version: string;
  subject: string;
  body: string;
  created_at: string;
};

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";

  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} min ago`;

  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;

  return `${Math.floor(h / 24)} d ago`;
}

function formatEmail(draft: EmailDraft) {
  return `Subject: ${draft.subject}\n\n${draft.body}`;
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
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeArticleAudio(({ id, playing }) => {
      setPlaying(id === story.id && playing);
    });
  }, [story.id]);

  const canListen = !!story.article_audio_url;
  const hasStripePlay = !!story.stripe_play?.trim();
  const stripeProducts = story.stripe_products?.filter(Boolean) ?? [];
  const targetIndustries = story.target_industries?.filter(Boolean) ?? [];
  const proofPoint = story.proof_point_text?.trim();

  const handleListen = () => {
    if (!story.article_audio_url) return;
    toggleArticleAudio(story.id, story.article_audio_url);
  };

  const handleDraftEmail = async () => {
    if (draft) {
      setCopied(false);
      setDraftOpen(true);
      return;
    }

    setDraftLoading(true);
    setDraftError(null);
    setCopied(false);

    const { data, error } = await supabase.functions.invoke("draft-prospecting-email", {
      body: { article_id: story.id },
    });

    setDraftLoading(false);

    if (error) {
      setDraftError(error.message || "Could not generate email");
      return;
    }

    if (!data?.draft) {
      setDraftError("Could not generate email");
      return;
    }

    setDraft(data.draft as EmailDraft);
    setDraftOpen(true);
  };

  const handleCopyEmail = async () => {
    if (!draft) return;

    await navigator.clipboard.writeText(formatEmail(draft));
    setCopied(true);

    // Fire-and-forget analytics. Copy should still succeed even if tracking fails.
    void supabase.functions.invoke("track-email-copy", {
      body: {
        article_id: story.id,
        draft_id: draft.id,
      },
    });
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

          {targetIndustries.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {targetIndustries.map((industry) => (
                <span
                  key={industry}
                  className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200"
                >
                  {industry}
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

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleDraftEmail}
              disabled={draftLoading}
              className="h-8 text-xs"
            >
              {draftLoading ? "Generating..." : "✉️ Draft Email"}
            </Button>

            {draftError && (
              <span className="text-[11px] text-destructive">
                {draftError}
              </span>
            )}
          </div>
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

      {draftOpen && draft &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-6"
            onClick={() => setDraftOpen(false)}
          >
            <div
              className="glass flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-card/95 p-4 text-card-foreground shadow-2xl sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary dark:text-[rgba(218,165,32,0.95)]">
                  Draft Email
                </div>

                <button
                  type="button"
                  onClick={() => setDraftOpen(false)}
                  className="rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  aria-label="Close draft email"
                >
                  ×
                </button>
              </div>

              <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background/70 p-4 font-sans text-sm leading-relaxed text-foreground">
                {formatEmail(draft)}
              </pre>

              <div className="mt-4 flex shrink-0 justify-end">
                <Button onClick={handleCopyEmail} className="h-9 text-sm">
                  {copied ? "Copied" : "Copy email"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </article>
  );
};