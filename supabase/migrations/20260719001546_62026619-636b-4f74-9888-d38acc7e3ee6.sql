
CREATE OR REPLACE FUNCTION public._decode_html_entities(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r text := s;
  m text;
  cp int;
BEGIN
  IF r IS NULL THEN RETURN NULL; END IF;

  -- Numeric hex entities &#xNN;
  LOOP
    m := (regexp_match(r, '&#[xX]([0-9a-fA-F]+);'))[1];
    EXIT WHEN m IS NULL;
    BEGIN
      cp := ('x' || m)::bit(32)::int;
      r := regexp_replace(r, '&#[xX]' || m || ';', chr(cp), 'g');
    EXCEPTION WHEN OTHERS THEN
      r := regexp_replace(r, '&#[xX]' || m || ';', '', 'g');
    END;
  END LOOP;

  -- Numeric decimal entities &#NN;
  LOOP
    m := (regexp_match(r, '&#(\d+);'))[1];
    EXIT WHEN m IS NULL;
    BEGIN
      cp := m::int;
      r := regexp_replace(r, '&#' || m || ';', chr(cp), 'g');
    EXCEPTION WHEN OTHERS THEN
      r := regexp_replace(r, '&#' || m || ';', '', 'g');
    END;
  END LOOP;

  -- Named entities
  r := replace(r, '&lsquo;', E'\u2018');
  r := replace(r, '&rsquo;', E'\u2019');
  r := replace(r, '&ldquo;', E'\u201C');
  r := replace(r, '&rdquo;', E'\u201D');
  r := replace(r, '&mdash;', E'\u2014');
  r := replace(r, '&ndash;', E'\u2013');
  r := replace(r, '&hellip;', E'\u2026');
  r := replace(r, '&nbsp;', ' ');
  r := replace(r, '&quot;', '"');
  r := replace(r, '&apos;', '''');
  r := replace(r, '&lt;', '<');
  r := replace(r, '&gt;', '>');
  r := replace(r, '&trade;', E'\u2122');
  r := replace(r, '&copy;', E'\u00A9');
  r := replace(r, '&reg;', E'\u00AE');
  r := replace(r, '&euro;', E'\u20AC');
  r := replace(r, '&pound;', E'\u00A3');
  r := replace(r, '&bull;', E'\u2022');
  r := replace(r, '&laquo;', E'\u00AB');
  r := replace(r, '&raquo;', E'\u00BB');
  r := replace(r, '&amp;', '&');

  RETURN r;
END;
$$;

UPDATE public.articles
SET
  title = public._decode_html_entities(title),
  summary = public._decode_html_entities(summary)
WHERE title ~ '&(#[0-9a-fA-FxX]+|[a-zA-Z]+);'
   OR (summary IS NOT NULL AND summary ~ '&(#[0-9a-fA-FxX]+|[a-zA-Z]+);');

DROP FUNCTION public._decode_html_entities(text);
