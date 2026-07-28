// Scheduled hourly: picks 3-5 globally significant fintech stories from the
// last 12 hours and marks them for the global "BREAKING NEWS" ticker.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronAuth } from "../_shared/auth.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const serviceAccount = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);

    function base64url(data: string | ArrayBuffer): string {
      const str = typeof data === "string"
        ? btoa(data)
        : btoa(String.fromCharCode(...new Uint8Array(data)));
      return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));

    const pemContents = serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\n/g, "");
    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      "pkcs8", binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["sign"]
    );

    const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signatureInput);
    const jwt = `${header}.${payload}.${base64url(signature)}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const res = await fetch(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/tick-502812/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      console.warn(`Vertex AI ${res.status}: ${t.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (e) {
    console.warn("Gemini call failed:", (e as Error).message);
    return null;
  }
}

function extractJsonArray(s: string): any[] | null {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const started = Date.now();
  try {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const MIN_TICKER = 3;

    // Heuristic: reject non-English EMEA scripts (accented Latin, Cyrillic, Arabic, Hebrew, CJK)
    // OR any text containing common Italian/French/German/Dutch/Spanish/Portuguese stopwords.
    const NON_ENGLISH_RE = /[\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u3000-\u9FFF]/;
    const FOREIGN_STOPWORDS = new Set([
      // Italian
      "il","la","lo","gli","le","di","da","dei","delle","della","dello","degli","che","con","per","del","alla","alle","allo","agli","non","sono","questo","questa","anche","come","cosa","dalla","dallo","dagli","dalle","essere","ecco","ancora","tra","fra","sulla","sullo","sugli","sulle","prezzo","banche","monito","scatta","divieto","distruzione","abiti","scarpe","accessori","invenduti",
      // French
      "les","des","une","dans","avec","pour","être","cette","cet","est","sont","aux","leur","leurs","nous","vous","mais","ils","elles","plus","tout","tous","toute","toutes","sur","sous",
      // German
      "der","die","das","und","mit","für","ist","nicht","zum","zur","auch","eine","einen","einem","einer","sich","werden","wird","dass","auf","bei","aus","über","zwischen","oder","aber","noch","im","ins","unsere","unser","ihre","ihr","seine","sein","branche","verharrt","hemmt","innovationen","status",
      // Dutch
      "de","het","van","een","voor","niet","gaat","blijkt","dicht","tweede","maar","zijn","nog","wordt","worden","tussen","bij","naar","onder","boven","hoe","aan","weer","krijgen","opperste","leider","schort","overeenkomst","haalt","uit",
      // Spanish
      "los","las","del","con","para","por","que","este","esta","esto","estos","estas","como","cuando","donde","porque","sino","hasta","desde","pero","sobre",
      // Portuguese
      "não","uma","umas","uns","dos","das","como","porque","quando","onde","sobre","entre","depois","antes","mesmo","também","pelo","pela","pelos","pelas",
      // Norwegian / Swedish / Danish
      "dro","inn","millioner","och","att","är","för","med","det","den","som","från","till","har","kan","kr","kroner","norske","svenska","danske","ikke","også","være","være","efter","före","før","hos",
    ]);
    const isEnglish = (a: any) => {
      const text = `${a.title ?? ""} ${a.summary ?? ""}`;
      if (NON_ENGLISH_RE.test(text)) return false;
      const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
      if (words.length === 0) return true;
      let hits = 0;
      for (const w of words) if (FOREIGN_STOPWORDS.has(w)) hits++;
      // 2+ foreign stopwords, or >8% of words → treat as non-English
      return hits < 2 && hits / words.length < 0.08;
    };

    // 1. Candidates: last 48h, dedicated ticker pool only, English, not already on ticker.
    const tickerCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: rawCandidates, error: candErr } = await supabase
      .from("articles")
      .select("id,title,summary,url,source,region,published_at,language,ticker_source")
      .gte("published_at", tickerCutoff)
      .eq("ticker_source", true)
      .eq("global_ticker", false)
      .eq("language", "en")
      .order("published_at", { ascending: false })
      .limit(200);
    if (candErr) throw candErr;
    const EXCLUDE_PATTERNS = [
      "webinar",
      "join this webinar",
      "register for this webinar",
      "register now",
      "event-info",
      "/event-info/",
      "/events/",
      "sponsored",
      "podcast",
      "opinion:",
      "how to",
      "why you should",
    ];

    const passesPreFilter = (a: any) => {
      const text = `${a.title ?? ""} ${a.summary ?? ""} ${a.url ?? ""}`.toLowerCase();
      return !EXCLUDE_PATTERNS.some((p) => text.includes(p));
    };
    const candidates = (rawCandidates ?? []).filter(isEnglish).filter(passesPreFilter);

    const STRONG_TICKER_RE =
      /\b(stripe|adyen|paypal|klarna|revolut|wise|checkout\.com|visa|mastercard|apple pay|google pay|open banking|embedded finance|payments?|wallet|bnpl|banking licence|banking license|acquisition|merger|funding|raises?|raised|series [a-f]|ipo|regulation|regulator|psd3|psr|stablecoin|digital euro|cbdc|merchant|checkout|fraud|fintech)\b/i;

    const isStrongTickerCandidate = (a: any) => {
      const text = `${a.title ?? ""} ${a.summary ?? ""}`;
      return STRONG_TICKER_RE.test(text);
    };

    // How many current ticker items are still fresh (<12h)?
    const { count: freshTicker } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("global_ticker", true)
      .gte("published_at", cutoff);
    const freshCount = freshTicker ?? 0;

    if (candidates.length === 0) {
      // Nothing new qualifies — preserve existing ticker items, expire nothing.
      return new Response(
        JSON.stringify({ ok: true, expired: 0, candidates: 0, selected: 0, breaking: 0, preserved: freshCount, ms: Date.now() - started }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // 3. Ask Gemini to pick the globally significant stories + breaking flags.
    const listText = candidates
      .map((a: any) => `- id=${a.id} | source=${a.source} | ${a.title}${a.summary ? " — " + a.summary.slice(0, 200) : ""}`)
      .join("\n");

    const prompt =
      `You are selecting headlines for a breaking news ticker aimed at Stripe's EMEA sales team ` +
      `(people who sell payment infrastructure to businesses). From the articles below, select ONLY ` +
      `the 5-8 that meet ALL of these criteria:\n\n` +
      `MUST be about:\n` +
      `- Payment companies (Stripe, Adyen, PayPal, Klarna, Revolut, Checkout.com, Square, Wise, etc.)\n` +
      `- Banking infrastructure or open banking\n` +
      `- Fintech fundraising/M&A above $50M\n` +
      `- New payment regulations or licensing\n` +
      `- Major fintech product launches or partnerships\n` +
      `- Digital wallets, BNPL, or embedded finance news\n\n` +
      `MUST NOT be:\n` +
      `- Webinars, events, or sponsored content (titles containing 'webinar', 'register', 'event-info', 'sponsored')\n` +
      `- Opinion/thought-leadership pieces (titles like 'The key to...', 'Why X matters...', 'How to...')\n` +
      `- Stock market or trading news (unless it's a fintech IPO)\n` +
      `- Political news that isn't directly about payment regulation\n` +
      `- Anything a payments sales rep couldn't reference in a customer conversation\n\n` +
      `Prefer a diverse source mix. Do not select more than 2 articles from the same source unless there are no other qualifying stories.\n` +
      `Return ONLY the IDs of qualifying articles as a JSON array of objects with shape ` +
      `[{"id":"<article id>","breaking":true|false}, ...]. Flag "breaking":true for stories with ` +
      `major breaking-news significance. No prose, no markdown. Return the best 3-8 qualifying articles. ` +
      `If only 1-2 genuinely strong articles qualify, return those rather than an empty array. Do not include weak filler.\n\n` +
      `Articles:\n${listText}`;

    const raw = await callGemini(prompt);
    console.log("Gemini raw:", raw?.slice(0, 500));
    const parsed = raw ? extractJsonArray(raw) : null;

    const candidateMap = new Map(candidates.map((c: any) => [c.id, c]));
    const selected: { id: string; breaking: boolean }[] = [];
    const selectedBySource = new Map<string, number>();

    if (parsed) {
      for (const item of parsed) {
        if (!item) continue;

        const id = typeof item === "string" ? item : item.id;
        if (typeof id !== "string") continue;

        const cand = candidateMap.get(id);
        if (!cand || !isEnglish(cand)) continue;

        const source = String((cand as any).source ?? "unknown");
        const sourceCount = selectedBySource.get(source) ?? 0;

        // Keep the ticker mixed: max 2 headlines from any one source.
        if (sourceCount >= 2) continue;

        const breaking = typeof item === "object" && !!item.breaking;

        selectedBySource.set(source, sourceCount + 1);
        selected.push({ id, breaking });

        if (selected.length >= 8) break;
      }
    }

    // Fallback: if Gemini is too conservative or returns unusable IDs,
    // pick strong recent candidates deterministically while preserving source diversity.
    if (selected.length === 0) {
      for (const cand of candidates.filter(isStrongTickerCandidate)) {
        const source = String((cand as any).source ?? "unknown");
        const sourceCount = selectedBySource.get(source) ?? 0;

        if (sourceCount >= 2) continue;

        selectedBySource.set(source, sourceCount + 1);
        selected.push({ id: cand.id, breaking: false });

        if (selected.length >= 8) break;
      }
    }

    // Only expire stale ticker items if the new English picks bring us to at least MIN_TICKER.
    // Otherwise keep the previous headlines visible.
    let expiredCount = 0;
    if (freshCount + selected.length >= MIN_TICKER) {
      const { data: expired, error: expireErr } = await supabase
        .from("articles")
        .update({ global_ticker: false })
        .lt("published_at", cutoff)
        .eq("global_ticker", true)
        .select("id");
      if (expireErr) throw expireErr;
      expiredCount = expired?.length ?? 0;
    }

    let markedTicker = 0;
    let markedBreaking = 0;
    if (selected.length) {
      const tickerIds = selected.map((s) => s.id);
      const { error: tErr, data: tData } = await supabase
        .from("articles")
        .update({ global_ticker: true })
        .in("id", tickerIds)
        .select("id");
      if (tErr) throw tErr;
      markedTicker = tData?.length ?? 0;

      const breakingIds = selected.filter((s) => s.breaking).map((s) => s.id);
      if (breakingIds.length) {
        const { error: bErr, data: bData } = await supabase
          .from("articles")
          .update({ is_breaking: true })
          .in("id", breakingIds)
          .select("id");
        if (bErr) throw bErr;
        markedBreaking = bData?.length ?? 0;
      }
    }

    const summary = {
      ok: true,
      ms: Date.now() - started,
      expired: expiredCount,
      candidates: candidates.length,
      selected: markedTicker,
      breaking: markedBreaking,
      preserved: freshCount,
    };
    console.log("curate-ticker done", summary);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("curate-ticker error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

