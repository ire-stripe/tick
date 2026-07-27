// One-time backfill: generate spoken_summary + article_audio_url for
// articles from the last 48h missing enrichment. Processes BATCH_SIZE per
// invocation with a 3s gap between items; call repeatedly until "remaining" is 0.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronAuth } from "../_shared/auth.ts";
import { synthesizeToWav, hasServiceAccount } from "../_shared/google-tts.ts";

const BATCH_SIZE = 5;
const TTS_DELAY_MS = 3000;
const LANG_TTS_CODE: Record<string, string> = {
  en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT",
  es: "es-ES", pt: "pt-PT", nl: "nl-NL", no: "nb-NO",
};
const LANG_NAME: Record<string, string> = {
  en: "English", fr: "French", de: "German", it: "Italian",
  es: "Spanish", pt: "Portuguese", nl: "Dutch", no: "Norwegian",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let vertexAccessToken: string | null = null;
let vertexAccessTokenExpiresAt = 0;
let vertexPrivateKey: CryptoKey | null = null;

function base64url(data: string | ArrayBuffer): string {
  const str = typeof data === "string"
    ? btoa(data)
    : btoa(String.fromCharCode(...new Uint8Array(data)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getVertexAccessToken(): Promise<string | null> {
  if (vertexAccessToken && Date.now() < vertexAccessTokenExpiresAt - 60_000) {
    return vertexAccessToken;
  }

  const serviceAccount = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  if (!vertexPrivateKey) {
    const pemContents = serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\n/g, "");
    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
    vertexPrivateKey = await crypto.subtle.importKey(
      "pkcs8", binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["sign"]
    );
  }

  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", vertexPrivateKey, signatureInput);
  const jwt = `${header}.${payload}.${base64url(signature)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    console.warn(`Vertex token ${tokenRes.status}: ${t.slice(0, 200)}`);
    return null;
  }

  const tokenData = await tokenRes.json();
  vertexAccessToken = tokenData.access_token ?? null;
  vertexAccessTokenExpiresAt = Date.now() + ((tokenData.expires_in ?? 3600) * 1000);
  return vertexAccessToken;
}

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const accessToken = await getVertexAccessToken();
    if (!accessToken) return null;

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
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
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

async function generateSpokenSummary(
  title: string, summary: string, fullText: string | null, langCode: string,
): Promise<string | null> {
  const langName = LANG_NAME[langCode] ?? "English";
  const ctx = fullText && fullText.length > 100 ? fullText.slice(0, 1500) : summary;
  const prompt =
    `Rewrite this into a natural 3-4 sentence spoken summary for an audio news briefing. ` +
    `Keep it conversational and informative. No bullet points or formatting. ` +
    `Write it in ${langName}.\n\n` +
    `Headline: ${title}\n\nSummary: ${summary}\n\nFull text: ${ctx}`;
  return await callGemini(prompt);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) {
    return new Response(authFail.body, {
      status: authFail.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!hasServiceAccount()) {
    return new Response(JSON.stringify({ ok: false, error: "no service account" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("articles")
    .select("id,title,summary,full_text,language,spoken_summary,article_audio_url")
    .gte("published_at", since)
    .or("spoken_summary.is.null,article_audio_url.is.null")
    .order("published_at", { ascending: false })
    .limit(BATCH_SIZE);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { count: remainingBefore } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .gte("published_at", since)
    .or("spoken_summary.is.null,article_audio_url.is.null");

  let processed = 0, ttsGenerated = 0, failed = 0;
  const errors: Array<{ id: string; title: string; message: string }> = [];
  for (const row of rows ?? []) {
    try {
      const langCode = (row as any).language ?? "en";
      let spoken = (row as any).spoken_summary as string | null;
      if (!spoken) {
        spoken = await generateSpokenSummary(
          row.title, row.summary ?? "", row.full_text ?? null, langCode,
        );
        if (!spoken) {
          failed++;
          errors.push({ id: row.id, title: row.title, message: "No spoken summary returned from Gemini" });
          await new Promise(r => setTimeout(r, TTS_DELAY_MS));
          continue;
        }
        await supabase.from("articles").update({ spoken_summary: spoken }).eq("id", row.id);
      }
      if (!(row as any).article_audio_url) {
        const ttsLang = LANG_TTS_CODE[langCode] ?? "en-GB";
        const wav = await synthesizeToWav(spoken, ttsLang, "Leda");
        const path = `${row.id}.wav`;
        const { error: upErr } = await supabase.storage
          .from("articles").upload(path, wav, { contentType: "audio/wav", upsert: true });
        if (upErr) throw upErr;
        const { data: signed, error: signErr } = await supabase.storage
          .from("articles").createSignedUrl(path, 60 * 60 * 24 * 30);
        if (signErr) throw signErr;
        await supabase.from("articles")
          .update({ article_audio_url: signed.signedUrl }).eq("id", row.id);
        ttsGenerated++;
      }
      processed++;
      console.log(`[backfill ${row.id}] ok`);
    } catch (e) {
      failed++;
      const message = (e as Error).message;
      errors.push({ id: row.id, title: row.title, message });
      console.warn(`[backfill ${row.id}] failed:`, message);
    }
    await new Promise(r => setTimeout(r, TTS_DELAY_MS));
  }

  return new Response(JSON.stringify({
    ok: true, processed, ttsGenerated, failed,
    remainingBefore, remainingAfter: Math.max(0, (remainingBefore ?? 0) - processed),
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
