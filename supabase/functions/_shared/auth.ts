// Shared authorization for scheduled/admin edge functions.
// Returns null when the caller presents CRON_SECRET (via `x-cron-secret`
// header or `Authorization: Bearer <secret>`); otherwise returns an
// {status, body} pair the caller can wrap in a Response with its own headers.
export function checkCronAuth(
  req: Request,
): { status: number; body: string } | null {
  const expected = Deno.env.get("CRON_SECRET");
  const expectedAlt = Deno.env.get("CRON_ADMIN_TOKEN");
  if (!expected && !expectedAlt) {
    return {
      status: 500,
      body: JSON.stringify({ error: "Server misconfigured: CRON_SECRET not set" }),
    };
  }
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const matches = (v: string) =>
    !!v && ((expected && v === expected) || (expectedAlt && v === expectedAlt));
  if (!matches(header) && !matches(bearer)) {
    return { status: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  return null;
}
