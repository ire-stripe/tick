
-- Subscriptions: lock down. Only service_role can access (managed via Slack backend).
DROP POLICY IF EXISTS "subscriptions open" ON public.subscriptions;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT ALL ON public.subscriptions TO service_role;

-- Feedback: drop submitted_by column to remove PII risk; keep public insert-only.
ALTER TABLE public.feedback DROP COLUMN IF EXISTS submitted_by;
