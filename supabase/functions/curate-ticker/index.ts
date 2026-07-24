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
    const rawServiceAccount = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!rawServiceAccount) {
      console.warn("Vertex AI failed: GOOGLE_SERVICE_ACCOUNT_JSON not set");
      return null;
    }

    const sa = JSON.parse(rawServiceAccount) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
      token_uri?: string;
    };

    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      console.warn("Vertex AI failed: service account JSON missing client_email, private_key, or project_id");
      return null;
    }

    const base64url = (input: string | ArrayBuffer | Uint8Array): string => {
      let bytes: Uint8Array;

      if (typeof input === "string") {
        bytes = new TextEncoder().encode(input);
      } else if (input instanceof Uint8Array) {
        bytes = input;
      } else {
        bytes = new Uint8Array(input);
      }

      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    };

    const pemToArrayBuffer = (pem: string): ArrayBuffer => {
      const b64 = pem
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/\s/g, "");

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    };

    const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);

    const jwtHeader = {
      alg: "RS256",
      typ: "JWT",
    };

    const jwtClaimSet = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    };

    const unsignedJwt = `${base64url(JSON.stringify(jwtHeader))}.${base64url(
      JSON.stringify(jwtClaimSet),
    )}`;

    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(sa.private_key),
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(unsignedJwt),
    );

    const signedJwt = `${unsignedJwt}.${base64url(signature)}`;

    const tokenRes = await fetch(tokenUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signedJwt,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const tokenText = await tokenRes.text();

    if (!tokenRes.ok) {
      console.warn(`Vertex AI token exchange ${tokenRes.status}: ${tokenText.slice(0, 300)}`);
      return null;
    }

    const tokenData = JSON.parse(tokenText);
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.warn("Vertex AI token exchange failed: response missing access_token");
      return null;
    }

    const vertexUrl =
      `https://europe-west1-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent`;

    const res = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    const responseText = await res.text();

    if (!res.ok) {
      console.warn(`Vertex AI ${res.status}: ${responseText.slice(0, 300)}`);
      return null;
    }

    const data = JSON.parse(responseText);

    return data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim() || null;
  } catch (e) {
    console.warn("Vertex AI failed", (e as Error).message);
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
      .select("id,title,summary,source,region,published_at,language,ticker_source")
      .gte("published_at", tickerCutoff)
      .eq("ticker_source", true)
      .eq("global_ticker", false)
      .eq("language", "en")
      .order("published_at", { ascending: false })
      .limit(200);
    if (candErr) throw candErr;
    const EXCLUDE_PATTERNS = [
      "webinar",
      "register now",
      "event-info",
      "sponsored",
      "podcast",
      "opinion:",
      "how to",
      "why you should",
    ];
    const passesPreFilter = (a: any) => {
      const title = (a.title ?? "").toLowerCase();
      return !EXCLUDE_PATTERNS.some((p) => title.includes(p));
    };
    const candidates = (rawCandidates ?? []).filter(isEnglish).filter(passesPreFilter);

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
    // Use stable numbered indices instead of UUIDs because Gemini can hallucinate
    // slightly-wrong IDs. We map 1-based indices back to real article IDs below.
    const listText = candidates
      .map((a: any, i: number) => `${i + 1}. ${a.title}${a.summary ? " — " + a.summary.slice(0, 200) : ""}`)
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
      `Return ONLY the NUMBERS of qualifying articles as a JSON array of objects with shape ` +
      `[{"n":1,"breaking":true}, {"n":3,"breaking":false}, ...]. The "n" value must be the ` +
      `number shown before the article in the list below. Flag "breaking":true for stories with ` +
      `major breaking-news significance. No prose, no markdown. If fewer than 3 articles qualify, ` +
      `return an empty array [] — do NOT lower the bar.\n\n` +
      `Articles:\n${listText}`;

    const raw = await callGemini(prompt);
    console.log("Gemini raw:", raw?.slice(0, 500));
    const parsed = raw ? extractJsonArray(raw) : null;

    const selected: { id: string; breaking: boolean }[] = [];
    const seenSelectedIds = new Set<string>();

    if (parsed) {
      for (const item of parsed) {
        if (!item) continue;

        const n =
          typeof item === "number"
            ? item
            : typeof item === "string"
              ? Number.parseInt(item, 10)
              : Number.parseInt(String(item.n), 10);

        if (!Number.isInteger(n) || n < 1 || n > candidates.length) continue;

        const cand = candidates[n - 1];
        if (!cand || !isEnglish(cand)) continue;
        if (seenSelectedIds.has(cand.id)) continue;

        const breaking = typeof item === "object" && !!item.breaking;
        selected.push({ id: cand.id, breaking });
        seenSelectedIds.add(cand.id);

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

