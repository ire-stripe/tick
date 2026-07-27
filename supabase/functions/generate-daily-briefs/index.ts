// Generates one daily audio briefing per (territory, language).
// Scheduled via pg_cron to run at 05:30 UTC.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ACTIVE_TERRITORIES, type Territory, type Language } from "../_shared/territories.ts";
import { checkCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Per-language metadata. TTS is Gemini Flash "Leda" only — no Studio/Neural fallback.
const LANG_META: Record<
  string,
  {
    name: string;
    tts_language_code: string;
    chars_per_second: number;
  }
> = {
  en: { name: "English", tts_language_code: "en-GB", chars_per_second: 14 },
  fr: { name: "French", tts_language_code: "fr-FR", chars_per_second: 12 },
  de: { name: "German", tts_language_code: "de-DE", chars_per_second: 13 },
  es: { name: "Spanish", tts_language_code: "es-ES", chars_per_second: 12 },
  pt: { name: "Portuguese", tts_language_code: "pt-PT", chars_per_second: 12 },
  it: { name: "Italian", tts_language_code: "it-IT", chars_per_second: 12 },
};

const GEMINI_STYLE_PROMPT =
  "Read as a professional news anchor delivering a morning fintech briefing. Warm, authoritative, and conversational. Speak with a British English accent.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Voice = "female" | "male";

function languagesFor(t: Territory): Language[] {
  return t.languages && t.languages.length > 0 ? t.languages : [{ code: "en", label: "EN" }];
}

function buildPrompt(
  t: Territory,
  langCode: string,
  articles: any[],
  otherHeadlines: { territory: string; headlines: string[] }[] = [],
): string {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const stories = articles
    .map((a, i) => {
      const ctx = (a.full_text && a.full_text.length > 100)
        ? a.full_text.slice(0, 1500)
        : (a.summary ?? "");
      return `Headline: ${a.title}\nSource: ${a.source ?? "unknown"}\nFull context: ${ctx}\n---`;
    })
    .join("\n\n");

  const otherBlock = otherHeadlines.length
    ? `\n\nHeadlines from other regions (for zoom-out context only, do not cover these as stories):\n\n${
      otherHeadlines
        .map((o) => `${o.territory}:\n- ${o.headlines.join("\n- ")}`)
        .join("\n\n")
    }`
    : "";

  const zoomOutRule = `- Before your closing line, add a brief "zooming out" moment:
  - Look at the headlines from ALL territories provided below
  - Identify the single most dominant theme or trend appearing in 3+ regions today
  - Add one sentence like: "And zooming out, the big story across markets this week is [theme]. We're seeing it in [region], [region], and [region]."
  - Keep it to 1-2 sentences max.
  - If no clear cross-territory theme exists today, skip this section entirely. Do not force it.
- After the zoom-out section, add a brief closing line like: "And something worth asking your prospects this week:" followed by ONE specific, open-ended question that a sales rep could use in an email or on a call.
  The question must be:
  - Maximum 20 words. No exceptions.
  - Written like you're casually asking a peer over coffee, not presenting at a conference.
  - One short sentence. No compound clauses, no semicolons, no "given that X, how is Y..." structures.
  - Specific to today's news, not a dressed-up generic question.
  - MUST name a specific company, event, product, or number from today's stories. Never reference abstract themes or trends like "digital sovereignty", "innovation", or "AI adoption". Ground it in something concrete that happened today.
  Examples of GOOD questions:
    * "HSBC just joined an agentic AI working group. Are your competitors moving faster on AI than you?"
    * "EPI is migrating iDeal to Wero. How ready is your checkout for the next wave of European payment rails?"
    * "Cyclops just raised $20M for stablecoin infra. Are cross-border payouts still a pain point for you?"
  Examples of BAD questions:
    * "With digital sovereignty paramount, how are you balancing control and innovation?"
    * "How is your organization thinking about AI adoption?"
    * Anything that doesn't mention a specific company, product, number, or event from today.
    * Any question over 20 words.

- Then close with your usual sign-off.`;

  if (langCode === "en") {
    return `You are a professional fintech news anchor. Write a 4-5 minute audio briefing script covering these stories for the ${t.name} fintech market.

Rules:
- Open with: "Good morning. Here's your tick for ${t.name}, ${dateStr}."
- Cover each story in 45-60 seconds: headline, context, why it matters for someone in payments/fintech
- Use natural, conversational language — like a knowledgeable colleague briefing you over coffee
- Add brief transitions between stories: "Moving on...", "In other news...", "And finally..."
${zoomOutRule}
- Close with: "That's your tick for today. Back tomorrow with more."
- Do NOT use markdown, bullet points, or any formatting — this is pure spoken text
- Add [pause] markers between stories where a 1-second pause should go

Stories to cover:

${stories}${otherBlock}`;
  }

  const langName = LANG_META[langCode]?.name ?? langCode;
  return `You are a professional fintech news anchor. Write a 4-5 minute audio briefing script IN ${langName} covering these stories for the ${t.name} fintech market.

Rules:
- Write the ENTIRE script in ${langName} — natural, fluent, native-speaker quality
- Open with the local equivalent of: "Good morning. Here's your tick for ${t.name}, ${dateStr}."
- Cover each story in 45-60 seconds: headline, context, why it matters for someone in payments/fintech
- Use natural, conversational language — like a knowledgeable colleague briefing you over coffee
- Add brief transitions between stories (in ${langName})
${zoomOutRule}
- CRITICAL: The "zooming out" sentence AND the closing prospect question MUST be written in ${langName}, not English. The headlines from other regions are provided in English only as source material for you to identify the cross-territory theme — but your closing zoom-out line and prospect question must be phrased naturally in ${langName} (not a literal translation — it should feel native). For example, in French: "Et en prenant du recul, le grand sujet cette semaine sur les marchés européens est [thème]. On le retrouve en [région], [région], et [région]. Et une question à poser à vos prospects cette semaine : [question spécifique liée à une actualité du jour]." Use the equivalent natural phrasing in ${langName}.
- Translate region names into ${langName} where natural (e.g. "France", "Allemagne", "Italie", "Espagne", "Royaume-Uni" in French).
- Close with the local equivalent of: "That's your tick for today. Back tomorrow with more."
- Keep company names, product names, and technical terms in their original form (don't translate "Stripe", "Revolut", "open banking", etc.)
- Do NOT use markdown, bullet points, or any formatting — this is pure spoken text
- Add [pause] markers between stories where a 1-second pause should go

Stories to cover:

${stories}${otherBlock}`;
}

async function fetchOtherTerritoryHeadlines(
  currentId: string,
  sinceHours: number,
): Promise<{ territory: string; headlines: string[] }[]> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const others = ACTIVE_TERRITORIES.filter((t) => t.id !== currentId);
  const out: { territory: string; headlines: string[] }[] = [];
  for (const t of others) {
    const { data } = await supabase
      .from("articles")
      .select("title")
      .eq("region", t.id)
      .eq("language", "en")
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(3);
    if (data && data.length) {
      out.push({ territory: t.name, headlines: data.map((d: any) => d.title) });
    }
  }
  return out;
}

async function generateScript(prompt: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(
    "https://aiplatform.googleapis.com/v1/projects/tick-502812/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    },
  );

  const responseText = await res.text();

  if (!res.ok) {
    throw new Error(`AI script failed: ${res.status} ${responseText}`);
  }

  const j = JSON.parse(responseText);
  return j.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim() ?? "";
}

function scriptToPlainText(script: string): string {
  // Gemini TTS takes plain text; "..." is a natural pause.
  return script.replace(/\[pause\]/gi, "...").trim();
}

// Split plain text into conservative chunks for Gemini Flash TTS, preferring sentence boundaries.
function chunkText(text: string, maxChars = 1800): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+\s*|\S+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

const SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "";

let cachedToken: { token: string; exp: number } | null = null;

function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  if (!SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const sa = JSON.parse(SERVICE_ACCOUNT_JSON);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const toSign = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign)));
  const jwt = `${toSign}.${b64urlEncode(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return cachedToken.token;
}

async function callGoogleTts(body: unknown): Promise<Uint8Array> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const responseText = await res.text();
  console.log(`[tts/v1beta1] status=${res.status} body_first_100=${JSON.stringify(responseText.slice(0, 100))}`);
  if (!res.ok) throw new Error(`Gemini Flash TTS failed ${res.status}: ${responseText}`);
  const j = JSON.parse(responseText);
  const bin = atob(j.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function synthesizeChunk(
  text: string,
  languageCode: string,
  voiceName = "Leda",
): Promise<Uint8Array> {
  return await callGoogleTts({
    input: { prompt: GEMINI_STYLE_PROMPT, text },
    voice: { languageCode, name: voiceName, model_name: "gemini-2.5-flash-tts" },
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, pitch: 0, speakingRate: 1 },
  });
}

// Wrap raw 16-bit signed little-endian mono PCM in a WAV RIFF header.
function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

async function listBriefFiles(prefix = ""): Promise<string[]> {
  const { data, error } = await supabase.storage.from("briefs").list(prefix, { limit: 1000 });
  if (error) throw error;

  const files: string[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      files.push(path);
    } else {
      files.push(...(await listBriefFiles(path)));
    }
  }
  return files;
}

async function purgeBriefArtifacts() {
  const files = await listBriefFiles();
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    if (batch.length) {
      const { error } = await supabase.storage.from("briefs").remove(batch);
      if (error) throw error;
    }
  }

  const { error: epErr } = await supabase.from("episodes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (epErr) throw epErr;
  console.log(`[purge] deleted ${files.length} brief audio files and all episode rows`);
  return { filesDeleted: files.length };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function synthesizeFull(
  script: string,
  languageCode: string,
  voiceName: string,
): Promise<Uint8Array> {
const plain = scriptToPlainText(script);
  const chunks = chunkText(plain);
  const audios = await Promise.all(
    chunks.map((c) => synthesizeChunk(c, languageCode, voiceName)),
  );
  return pcmToWav(concatBytes(audios), 24000);
}

async function uploadAndSign(path: string, wav: Uint8Array): Promise<string> {
  const { error: upErr } = await supabase.storage
    .from("briefs")
    .upload(path, wav, { contentType: "audio/wav", upsert: true });
  if (upErr) throw upErr;
  const { data: signed, error: signErr } = await supabase.storage
    .from("briefs")
    .createSignedUrl(path, 60 * 60 * 24 * 30);
  if (signErr) throw signErr;
  return signed.signedUrl;
}

async function processOne(t: Territory, lang: Language, todayIso: string, sinceHours = 24, voice: Voice = "female") {
  const meta = LANG_META[lang.code] ?? LANG_META.en;

  if (voice === "male") {
    if (!SERVICE_ACCOUNT_JSON) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
    }

    const { data: episode, error: episodeErr } = await supabase
      .from("episodes")
      .select("script,duration_seconds")
      .eq("region", t.id)
      .eq("language_code", lang.code)
      .eq("date", todayIso)
      .maybeSingle();

    if (episodeErr) throw episodeErr;

    const script = episode?.script?.trim();
    if (!script) {
      throw new Error(
        `[${t.id}/${lang.code}] voice=male requires an existing episode script for ${todayIso}. Run voice=female first.`,
      );
    }

    const { data: existing } = await supabase.storage
      .from("briefs")
      .list(todayIso, { limit: 100 });

    const stale = (existing ?? [])
      .filter((f) => f.name === `${t.id}-${lang.code}-male.wav`)
      .map((f) => `${todayIso}/${f.name}`);

    if (stale.length) {
      await supabase.storage.from("briefs").remove(stale);
    }

    console.log(`[${t.id}/${lang.code}] synthesizing male (Charon) from saved script`);
    const wav = await synthesizeFull(script, meta.tts_language_code, "Charon");
    const maleUrl = await uploadAndSign(`${todayIso}/${t.id}-${lang.code}-male.wav`, wav);

    const { error: updateErr } = await supabase
      .from("episodes")
      .update({ male_audio_url: maleUrl })
      .eq("region", t.id)
      .eq("language_code", lang.code)
      .eq("date", todayIso);

    if (updateErr) throw updateErr;

    console.log(`[${t.id}/${lang.code}] male saved`);

    return {
      territory: t.id,
      lang: lang.code,
      voice,
      reusedScript: true,
      male: true,
    };
  }

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id,title,source,summary,full_text,published_at")
    .eq("region", t.id)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(7);
  if (error) throw error;

  if (articles && articles.length < 3) {
    const { data: globals, error: globalsError } = await supabase
      .from("articles")
      .select("id,title,source,summary,full_text,published_at")
      .eq("region", "global")
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(3 - articles.length);
    if (globalsError) throw globalsError;
    if (globals?.length) {
      articles.push(...globals);
    }
  }

  if (!articles || articles.length < 1) {
    console.log(`[${t.id}/${lang.code}] skip — only ${articles?.length ?? 0} articles`);
    return { territory: t.id, lang: lang.code, skipped: true };
  }

  const otherHeadlines = await fetchOtherTerritoryHeadlines(t.id, sinceHours);
  const prompt = buildPrompt(t, lang.code, articles, otherHeadlines);
  const script = await generateScript(prompt);
  if (!script) throw new Error("empty script");

// Clear only the prior female file for this territory/lang so signed URLs don't collide.
  // Do not remove the male file; male generation runs in a separate invocation.
  const { data: existing } = await supabase.storage.from("briefs").list(todayIso, { limit: 100 });
  const stale = (existing ?? [])
    .filter((f) => f.name === `${t.id}-${lang.code}-female.wav`)
    .map((f) => `${todayIso}/${f.name}`);
  if (stale.length) await supabase.storage.from("briefs").remove(stale);

  const durationSeconds = Math.round(script.length / meta.chars_per_second);
  let femaleUrl: string | null = null;
  let maleUrl: string | null = null;

  // Insert/update the episode row up-front with the script so it exists even
  // before any audio is ready.
  const upsertEpisode = async (patch: Record<string, unknown>) => {
    const { error: epErr } = await supabase.from("episodes").upsert(
      {
        region: t.id,
        language_code: lang.code,
        date: todayIso,
        script,
        duration_seconds: durationSeconds,
        ...patch,
      },
      { onConflict: "region,language_code,date" },
    );
    if (epErr) throw epErr;
  };

  await upsertEpisode({});

if (SERVICE_ACCOUNT_JSON) {
    // Free-tier Edge Functions have a 150s timeout. Generate only one voice per
    // invocation so script generation + TTS + upload can complete reliably.
    try {
      console.log(`[${t.id}/${lang.code}] synthesizing female (Leda)`);
      const wav = await synthesizeFull(script, meta.tts_language_code, "Leda");
      femaleUrl = await uploadAndSign(`${todayIso}/${t.id}-${lang.code}-female.wav`, wav);
      await upsertEpisode({ audio_url: femaleUrl });
      console.log(`[${t.id}/${lang.code}] female saved`);
    } catch (e) {
      console.error(`[${t.id}/${lang.code}] female TTS failed:`, e);
    }
  } else {
    console.warn("GOOGLE_SERVICE_ACCOUNT_JSON not set — saving script only.");
  }

  const ids = articles.map((a) => a.id);
  await supabase.from("articles").update({ is_in_brief: true }).in("id", ids);

return {
    territory: t.id,
    lang: lang.code,
    voice,
    articles: ids.length,
    female: !!femaleUrl,
    male: !!maleUrl,
  };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const todayIso = new Date().toISOString().slice(0, 10);
  const results: any[] = [];

  const url = new URL(req.url);
  const territoryFilter = url.searchParams.get("territory");
  const langFilter = url.searchParams.get("lang");

  const voiceParam = url.searchParams.get("voice") ?? "female";
  if (voiceParam !== "female" && voiceParam !== "male") {
    return new Response(
      JSON.stringify({ error: "Invalid voice. Use voice=female or voice=male." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  const voice = voiceParam as Voice;

  const shouldPurge = url.searchParams.get("purge") === "true";

  const sinceHours = Number(url.searchParams.get("since_hours") ?? 24);

  let purgeResult: { filesDeleted: number } | null = null;
  if (shouldPurge) {
    purgeResult = await purgeBriefArtifacts();
  }

  const territories = territoryFilter
    ? ACTIVE_TERRITORIES.filter((t) => t.id === territoryFilter)
    : ACTIVE_TERRITORIES;

  for (const t of territories) {
    const langs = langFilter
      ? languagesFor(t).filter((l) => l.code === langFilter)
      : languagesFor(t);
    for (const lang of langs) {
      try {
        results.push(await processOne(t, lang, todayIso, sinceHours, voice));
      } catch (e) {
        console.error(`[${t.id}/${lang.code}] error:`, e);
        results.push({ territory: t.id, lang: lang.code, error: String(e) });
      }
      // Space out AI calls to respect gateway rate limits.
      await sleep(5000);
    }
  }

  return new Response(JSON.stringify({ date: todayIso, purge: purgeResult, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
