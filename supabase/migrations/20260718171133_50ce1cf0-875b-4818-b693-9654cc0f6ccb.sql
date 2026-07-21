
DROP POLICY IF EXISTS "anyone can submit feedback" ON public.feedback;
CREATE POLICY "anyone can submit feedback"
ON public.feedback
FOR INSERT
TO anon, authenticated
WITH CHECK (
  suggestion IS NOT NULL
  AND length(trim(suggestion)) BETWEEN 1 AND 1000
);
