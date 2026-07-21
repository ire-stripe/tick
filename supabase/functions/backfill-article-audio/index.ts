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

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  } catch {
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
  for (const row of rows ?? []) {
    try {
      const langCode = (row as any).language ?? "en";
      let spoken = (row as any).spoken_summary as string | null;
      if (!spoken) {
        spoken = await generateSpokenSummary(
          row.title, row.summary ?? "", row.full_text ?? null, langCode,
        );
        if (!spoken) { failed++; await new Promise(r => setTimeout(r, TTS_DELAY_MS)); continue; }
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
      console.warn(`[backfill ${row.id}] failed:`, (e as Error).message);
    }
    await new Promise(r => setTimeout(r, TTS_DELAY_MS));
  }

  return new Response(JSON.stringify({
    ok: true, processed, ttsGenerated, failed,
    remainingBefore, remainingAfter: Math.max(0, (remainingBefore ?? 0) - processed),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
