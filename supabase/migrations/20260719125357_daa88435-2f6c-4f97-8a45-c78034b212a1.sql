
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'en';
CREATE UNIQUE INDEX IF NOT EXISTS episodes_region_lang_date_uniq ON public.episodes (region, language_code, date);
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
