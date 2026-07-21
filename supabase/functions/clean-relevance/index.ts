// Retroactively re-runs the fintech-relevance filter over existing articles
// and deletes anything that no longer qualifies. Uses the same logic as
// fetch-news' isFintechRelevant, plus a stricter negative pre-filter.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

// Strong positive keywords — obvious fintech, keep.
const POSITIVE_KW = [
  "fintech", "payment", "payments", "neobank", "open banking",
  "stripe", "paypal", "visa", "mastercard", "adyen", "klarna", "revolut",
  "wise ", "monzo", "n26", "starling", "checkout.com", "block inc", "square inc",
  "stablecoin", "cbdc", "regtech", "insurtech", "wealthtech",
  "acquirer", "issuer", "merchant acquiring", "psp ", "swift ", "sepa", "iso 20022",
  "embedded finance", "bnpl", "buy now pay later", "kyc", "aml",
  "core banking", "digital bank", "challenger bank", "banking-as-a-service", "baas",
  "cross-border payment", "remittance", "card network", "card issuer",
  "fca ", "occ ", "ecb ", "central bank digital",
];

// Hard negatives — clearly not fintech, drop without AI.
const NEGATIVE_KW = [
  "truth social", "trump media", "djt stock",
  "premier league", "world cup", "nba", "nfl", "olympics",
  "taylor swift", "kardashian", "netflix series", "movie review",
  "recipe", "restaurant review",
];

async function isRelevant(title: string, description: string): Promise<boolean> {
  const hay = `${title}\n${description ?? ""}`.toLowerCase();
  if (NEGATIVE_KW.some((k) => hay.includes(k))) return false;
  if (POSITIVE_KW.some((k) => hay.includes(k))) return true;

  const prompt =
    `Is this news article SPECIFICALLY about fintech, payments infrastructure, banking, ` +
    `lending, insurance-tech, or financial regulation of these industries? ` +
    `Say NO for: general stock market moves, politics, tech companies unrelated to finance, ` +
    `celebrity news, generic business news, or a company merely being publicly traded. ` +
    `Answer with ONLY "yes" or "no".\n\n` +
    `Title: ${title}\nDescription: ${description ?? ""}`;
  const out = (await callGemini(prompt))?.toLowerCase().trim() ?? "";
  return out.startsWith("yes");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10), 2000);

  const { data: articles, error } = await admin
    .from("articles")
    .select("id, title, summary, region")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const toDelete: string[] = [];
  const kept: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < (articles ?? []).length; i += CONCURRENCY) {
    const batch = (articles ?? []).slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (a) => ({ id: a.id, title: a.title, ok: await isRelevant(a.title, a.summary ?? "") })),
    );
    for (const r of results) {
      if (r.ok) kept.push(r.title);
      else {
        toDelete.push(r.id);
        console.log(`drop: ${r.title.slice(0, 100)}`);
      }
    }
  }

  let deleted = 0;
  if (toDelete.length) {
    const { error: delErr, count } = await admin
      .from("articles")
      .delete({ count: "exact" })
      .in("id", toDelete);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message, checked: articles?.length ?? 0 }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    deleted = count ?? toDelete.length;
  }

  return new Response(
    JSON.stringify({ checked: articles?.length ?? 0, deleted, kept: kept.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
