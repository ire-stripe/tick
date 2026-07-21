ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS spoken_summary text,
  ADD COLUMN IF NOT EXISTS article_audio_url text;