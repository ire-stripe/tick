// Shared Google Cloud TTS (Gemini 2.5 Flash TTS via v1beta1) helper.
// Handles service-account JWT auth, chunking, and WAV wrapping.

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

export async function getAccessToken(): Promise<string> {
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

const STYLE_PROMPT =
  "Read as a professional news anchor delivering a fintech briefing. Warm, authoritative, conversational.";

export async function synthesizeChunkGemini(
  text: string,
  languageCode: string,
  voiceName = "Leda",
): Promise<Uint8Array> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: { prompt: STYLE_PROMPT, text },
        voice: { languageCode, name: voiceName, model_name: "gemini-2.5-flash-tts" },
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, pitch: 0, speakingRate: 1 },
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const responseText = await res.text();
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${responseText.slice(0, 200)}`);
  const j = JSON.parse(responseText);
  const bin = atob(j.audioContent);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
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

export async function synthesizeToWav(
  text: string,
  languageCode: string,
  voiceName = "Leda",
): Promise<Uint8Array> {
  const chunks = chunkText(text);
  const audios: Uint8Array[] = [];
  for (const c of chunks) audios.push(await synthesizeChunkGemini(c, languageCode, voiceName));
  const total = audios.reduce((n, a) => n + a.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const a of audios) { merged.set(a, off); off += a.length; }
  return pcmToWav(merged, 24000);
}

export function hasServiceAccount(): boolean {
  return !!SERVICE_ACCOUNT_JSON;
}
