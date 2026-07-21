
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

UPDATE public.articles SET language = 'nl' WHERE source IN ('NOS','NRC','NU.nl');
UPDATE public.articles SET language = 'it' WHERE source IN ('La Repubblica','Il Sole 24 Ore');
UPDATE public.articles SET language = 'es' WHERE source IN ('Expansion','Expansión');
UPDATE public.articles SET language = 'no' WHERE source IN ('E24','e24.no');

CREATE INDEX IF NOT EXISTS articles_language_idx ON public.articles (language);
