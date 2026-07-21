DELETE FROM public.articles a
USING public.articles b
WHERE lower(btrim(a.title)) = lower(btrim(b.title))
  AND a.created_at > b.created_at;

DELETE FROM public.articles a
USING public.articles b
WHERE lower(btrim(a.title)) = lower(btrim(b.title))
  AND a.created_at = b.created_at
  AND a.id > b.id;