import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PROMPT_VERSION = "v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function base64url(data: string | ArrayBuffer): string {
  const str = typeof data === "string"
    ? btoa(data)
    : btoa(String.fromCharCode(...new Uint8Array(data)));

  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;
let cachedPrivateKey: CryptoKey | null = null;

async function getVertexAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  if (!cachedPrivateKey) {
    const pemContents = serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\n/g, "");

    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    cachedPrivateKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cachedPrivateKey,
    signatureInput,
  );

  const jwt = `${header}.${payload}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Vertex token failed: ${tokenRes.status} ${body.slice(0, 300)}`);
  }

  const tokenData = await tokenRes.json();

  cachedAccessToken = tokenData.access_token;
  cachedAccessTokenExpiresAt = Date.now() + ((tokenData.expires_in ?? 3600) * 1000);

  return cachedAccessToken!;
}

async function callGemini(prompt: string): Promise<string> {
  const accessToken = await getVertexAccessToken();

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
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );

  const responseText = await res.text();

  if (!res.ok) {
    throw new Error(`Gemini failed: ${res.status} ${responseText.slice(0, 500)}`);
  }

  const data = JSON.parse(responseText);

  return data.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim() ?? "";
}

function parseDraft(raw: string): { subject: string; body: string } {
  const cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_error) {
    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 300)}`);
  }

  const body = Array.isArray(parsed.body_lines)
    ? parsed.body_lines.map((line: unknown) => String(line)).join("\n")
    : String(parsed.body ?? "").trim();

  const normalizedBody = body.trim();

  if (!normalizedBody) {
    throw new Error("Gemini returned an empty body");
  }

  return {
    subject: "From Stripe",
    body: normalizedBody,
  };
}

function buildPrompt(article: any): string {
  const products = Array.isArray(article.stripe_products)
    ? article.stripe_products.filter(Boolean).join(", ")
    : "";

  const industries = Array.isArray(article.target_industries)
    ? article.target_industries.filter(Boolean).join(", ")
    : "";

  return `You write concise, high-quality cold prospecting emails for Stripe SDRs.

Generate one email using this article as the hook, the Stripe Play as the commercial angle, and the proof point as light social proof.

ARTICLE
Title: ${article.title}
Source: ${article.source ?? "Unknown"}
Summary: ${article.summary ?? article.spoken_summary ?? ""}
URL: ${article.url ?? ""}

STRIPE PLAY
${article.stripe_play}

TARGET INDUSTRIES
${industries || "Not specified"}

INTERNAL PRODUCT CONTEXT — do not mention these names in the email body:
${products || "Not specified"}

PROOF POINT
${article.proof_point_text ?? ""}

Required output:
Return valid JSON only, no markdown fences, with this exact shape:
{
  "subject": "From Stripe",
  "body_lines": [
    "Hey {{first_name}},",
    "",
    "First paragraph line.",
    "",
    "Would you be open to a quick 15 minutes to explore if there's a fit?",
    "",
    "Talk soon,",
    "{{sender_name}}"
  ]
}

Hard rules:
- subject must be exactly: From Stripe
- body_lines[0] must be exactly: Hey {{first_name}},
- Use {{company}} as the prospect company merge tag where useful. Do not invent a specific prospect company.
- Opening sentence must reference the specific news event: company, event, and product/context from the article. No vague openers.
- Let the observation breathe for a full sentence before connecting to pain.
- Body must be 2-3 sentences before the CTA.
- Connect the news to prospect pain.
- Weave the proof point naturally. Paraphrase it; do not quote it verbatim.
- Build toward one DIQ.
- DIQ must be one open-ended question, genuinely curious, not yes/no, not a pitch, no Stripe product names, and connected to the pain.
- CTA line must be exactly: Would you be open to a quick 15 minutes to explore if there's a fit?
- Sign-off lines must be exactly:
Talk soon,
{{sender_name}}
- Total length must be 80-100 words excluding the subject and sign-off.
- Tone: conversational, warm, knowledgeable peer, short sentences.
- Use natural connectors like “But the more X, the messier Y gets”.
- No analyst language.
- No filler.
- No em dashes as sentence connectors.
- Do not mention Stripe product names in the body.
- Do not mention internal labels like “Stripe Play”, “proof point”, or “target industries”.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { article_id } = await req.json();

    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cached, error: cacheErr } = await supabase
      .from("article_email_drafts")
      .select("id, article_id, prompt_version, subject, body, created_at")
      .eq("article_id", article_id)
      .eq("prompt_version", PROMPT_VERSION)
      .maybeSingle();

    if (cacheErr) throw cacheErr;

    if (cached) {
      return new Response(JSON.stringify({ draft: cached, cached: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: article, error: articleErr } = await supabase
      .from("articles")
      .select("id,title,source,url,summary,spoken_summary,region,stripe_play,stripe_products,target_industries,proof_point_text")
      .eq("id", article_id)
      .maybeSingle();

    if (articleErr) throw articleErr;

    if (!article) {
      return new Response(JSON.stringify({ error: "Article not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!article.stripe_play) {
      return new Response(JSON.stringify({ error: "Article has no Stripe Play" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await callGemini(buildPrompt(article));
    const draft = parseDraft(raw);

    const { data: inserted, error: insertErr } = await supabase
      .from("article_email_drafts")
      .insert({
        article_id,
        prompt_version: PROMPT_VERSION,
        subject: draft.subject,
        body: draft.body,
      })
      .select("id, article_id, prompt_version, subject, body, created_at")
      .single();

    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({ draft: inserted, cached: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("draft-prospecting-email failed", error);

    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
