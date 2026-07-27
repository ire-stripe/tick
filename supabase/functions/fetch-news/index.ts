// Scheduled function: fetches RSS + GNews per territory, dedupes, AI-summarizes
// and AI-classifies global articles, then inserts into public.articles.
// Driven entirely by the shared territories config — no hardcoded lists here.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronAuth } from "../_shared/auth.ts";
import { synthesizeToWav, hasServiceAccount } from "../_shared/google-tts.ts";
import {
  ACTIVE_TERRITORIES,
  GLOBAL_RSS_FEEDS,
  PAN_EMEA_RSS_FEEDS,
  REGION_IDS,
  type Territory,
} from "../_shared/territories.ts";

// Per-article spoken-summary/TTS config.
const MAX_TTS_PER_RUN = 10;
const TTS_DELAY_MS = 3000;
const LANG_TTS_CODE: Record<string, string> = {
  en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES", pt: "pt-PT", nl: "nl-NL", no: "nb-NO",
};
const LANG_NAME: Record<string, string> = {
  en: "English", fr: "French", de: "German", it: "Italian", es: "Spanish", pt: "Portuguese", nl: "Dutch", no: "Norwegian",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
// Strip whitespace AND invisible unicode separators (U+2028/U+2029/BOM) that
// can sneak in when a key is pasted from a rich-text source.
const GNEWS_API_KEY = (Deno.env.get("GNEWS_API_KEY") ?? "").replace(/[\s\u2028\u2029\uFEFF]+/g, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type FetchedArticle = {
  title: string;
  url: string;
  source: string;
  description: string;
  published_at: string;
  territory_id: string; // may be "__global__" for global-feed items pending classification
};

function hasArticlePath(url: string): boolean {
  try {
    const urlPath = new URL(url).pathname;
    return !!urlPath && urlPath !== "/" && urlPath.length >= 5;
  } catch {
    return false;
  }
}

function isSiftedUrl(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "").endsWith("sifted.eu");
  } catch {
    return false;
  }
}

// ── RSS parsing (tolerant regex — no external deps) ────────────────────────
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "\u201C", rdquo: "\u201D", lsquo: "\u2018", rsquo: "\u2019",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", trade: "\u2122",
  copy: "\u00A9", reg: "\u00AE", euro: "\u20AC", pound: "\u00A3",
  cent: "\u00A2", yen: "\u00A5", deg: "\u00B0", middot: "\u00B7",
  laquo: "\u00AB", raquo: "\u00BB", bull: "\u2022",
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; }
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function parseRss(xml: string, sourceHost: string): Array<Omit<FetchedArticle, "territory_id">> {
  const items: Array<Omit<FetchedArticle, "territory_id">> = [];
  const itemRegex = /<(item|entry)[\s\S]*?<\/(item|entry)>/gi;
  const blocks = xml.match(itemRegex) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      // Atom style: <link href="..." />
      const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    const description =
      extractTag(block, "description") ||
      extractTag(block, "summary") ||
      extractTag(block, "content:encoded") ||
      "";
    const pub =
      extractTag(block, "pubDate") ||
      extractTag(block, "published") ||
      extractTag(block, "updated") ||
      new Date().toISOString();
    if (!title || !link) continue;
    if (!hasArticlePath(link)) {
      console.warn(`RSS ${sourceHost} skipped homepage-only URL: ${link}`);
      continue;
    }
    const publishedIso = new Date(pub).toISOString();
    // Skip items with a pubDate older than 3 days — keeps the feed fresh
    // and prevents stale RSS backlogs from polluting the ticker.
    const ageMs = Date.now() - new Date(publishedIso).getTime();
    if (ageMs > 3 * 24 * 60 * 60 * 1000) continue;
    items.push({
      title: title.slice(0, 500),
      url: link,
      source: sourceHost,
      description: description.slice(0, 1200),
      published_at: publishedIso,
    });
  }
  return items;
}

function hostFromUrl(u: string): string {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length > 1 ? parts[parts.length - 2] : host;
  } catch {
    return "unknown";
  }
}

function niceSourceName(host: string): string {
  const map: Record<string, string> = {
    finextra: "Finextra",
    sifted: "Sifted",
    "tech": "Tech.eu",
    nrc: "NRC",
    nos: "NOS",
    nu: "NU.nl",
    ilsole24ore: "Il Sole 24 Ore",
    repubblica: "La Repubblica",
    expansion: "Expansión",
    "emerging-europe": "Emerging Europe",
    techcrunch: "TechCrunch",
    theguardian: "The Guardian",
  };
  return map[host] ?? host.charAt(0).toUpperCase() + host.slice(1);
}

const rssSourceStats: Record<string, { attempts: number; articles: number }> = {};

function recordRssSource(source: string, count: number) {
  const current = rssSourceStats[source] ?? { attempts: 0, articles: 0 };
  current.attempts += 1;
  current.articles += count;
  rssSourceStats[source] = current;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function fetchRss(url: string): Promise<Array<Omit<FetchedArticle, "territory_id">>> {
  const sourceName = niceSourceName(hostFromUrl(url));
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "tick-news-bot/1.0 (+https://tick.app)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`RSS ${url} → ${res.status}`);
      recordRssSource(sourceName, 0);
      return [];
    }
    const xml = await res.text();
    const items = parseRss(xml, sourceName).slice(0, 15);
    recordRssSource(sourceName, items.length);
    return items;
  } catch (e) {
    console.warn(`RSS ${url} failed`, (e as Error).message);
    recordRssSource(sourceName, 0);
    return [];
  }
}

async function fetchGNews(country: string): Promise<Array<Omit<FetchedArticle, "territory_id">>> {
  if (!GNEWS_API_KEY) {
    console.warn("GNews skipped: GNEWS_API_KEY not set");
    return [];
  }
  const params = new URLSearchParams({
    q: '("fintech" OR "payments" OR "neobank" OR "digital banking") AND (Europe OR EU OR UK OR EMEA)',
    lang: "en",
    country: country.toLowerCase(),
    max: "5",
    apikey: GNEWS_API_KEY,
  });
  const url = `https://gnews.io/api/v4/search?${params.toString()}`;
  const safeUrl = url.replace(GNEWS_API_KEY, "***");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`GNews ${country} → ${res.status} ${safeUrl} :: ${body.slice(0, 300)}`);
      return [];
    }
    const data = await res.json();
    // Exclude non-EMEA sources that GNews sometimes surfaces even with a country filter.
    const NON_EMEA_HOST_RE = /(economictimes|moneycontrol|livemint|business-standard|ndtv|hindustantimes|timesofindia|thehindu|zeebiz|financialexpress|deccanherald|indiatimes|cnbctv18|outlookindia|devdiscourse|abc17news|foxnews|nbcnews|cbsnews|usatoday|nypost|latimes|chicagotribune|bostonglobe|houstonchronicle|scmp|straitstimes|channelnewsasia|abc\.net\.au|smh\.com\.au|theage|nzherald|globeandmail|torontosun|thestar\.com)/i;
    return (data.articles ?? [])
      .filter((a: any) => {
        const host = (() => { try { return new URL(a.url).hostname; } catch { return ""; } })();
        return host && !NON_EMEA_HOST_RE.test(host);
      })
      .map((a: any) => ({
        title: (a.title ?? "").slice(0, 500),
        url: a.url,
        source: a.source?.name ?? "GNews",
        description: (a.description ?? a.content ?? "").slice(0, 1200),
        published_at: a.publishedAt ?? new Date().toISOString(),
      }));
  } catch (e) {
    console.warn(`GNews ${country} failed ${safeUrl}`, (e as Error).message);
    return [];
  }
}

// ── Article body extraction ────────────────────────────────────────────────
// Fetch the article URL and pull the main body text. Strips scripts/styles
// and prefers <article> or <main>; falls back to concatenated <p> tags.
// Returns null on any failure (timeout, non-200, paywall, empty body).
async function extractFullText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    let html = await res.text();
    // Strip noisy blocks first
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<form[\s\S]*?<\/form>/gi, " ");

    const pickBlock = (tag: string): string | null => {
      const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1] : null;
    };

    let candidate = pickBlock("article") ?? pickBlock("main");
    if (!candidate) {
      // Fallback: collect all <p> tags in the page and use the longest run.
      const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
      candidate = paras.join(" ");
    }
    if (!candidate) return null;

    const text = decodeEntities(candidate)
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 200) return null;
    return text.slice(0, 2000);
  } catch (_e) {
    return null;
  }
}

// ── Lovable AI Gateway (Gemini) ────────────────────────────────────────────
async function callGemini(prompt: string): Promise<string | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn(`AI gateway ${res.status}: ${t.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.warn("AI gateway failed", (e as Error).message);
    return null;
  }
}

async function summarize(title: string, description: string): Promise<string | null> {
  const prompt =
    `Summarize this fintech news article in 2-3 concise sentences for a sales professional. ` +
    `Focus on what happened and why it matters for the payments/fintech industry:\n\n` +
    `Title: ${title}\n\nDescription: ${description}`;
  return await callGemini(prompt);
}

async function classifyTerritory(title: string, description: string): Promise<string> {
  const options = REGION_IDS.join(", ");
  const prompt =
    `Classify which market this fintech news story is most relevant to. ` +
    `Reply with ONE token only from this list: ${options}, global. ` +
    `Use "global" only if genuinely cross-region.\n\n` +
    `Title: ${title}\nDescription: ${description}`;
  const out = (await callGemini(prompt))?.toLowerCase().trim().replace(/[.\s"'`]+$/g, "");
  if (!out) return "global";
  for (const id of REGION_IDS) if (out.includes(id)) return id;
  return "global";
}

// Quick fintech-relevance gate. Returns true if the story is about fintech,
// payments, banking, or financial technology. Uses a cheap AI call so junk
// from broad feeds (general news, sports, entertainment) never gets inserted.
async function isFintechRelevant(title: string, description: string): Promise<boolean> {
  // Cheap keyword pre-pass: obvious fintech terms skip the AI call.
  const hay = `${title}\n${description}`.toLowerCase();
  const KW = [
    "fintech", "payment", "payments", "neobank", "open banking", "banking",
    "bank ", "banks ", "stripe", "paypal", "visa", "mastercard", "adyen",
    "klarna", "revolut", "wise", "monzo", "n26", "starling", "checkout.com",
    "crypto", "stablecoin", "cbdc", "regtech", "insurtech", "wealthtech",
    "lending", "loan", "mortgage", "credit card", "debit card", "acquirer",
    "issuer", "merchant", "pos ", "psp ", "swift", "sepa", "iso 20022",
    "embedded finance", "bnpl", "buy now pay later", "kyc", "aml",
    "fca", "occ", "ecb", "federal reserve", "central bank", "ipo",
    "series a", "series b", "series c", "series d", "funding round",
    "raised $", "raises $", "acquires", "acquisition", "merger",
  ];
  if (KW.some((k) => hay.includes(k))) return true;

  const prompt =
    `Is this news article about fintech, payments, banking, or financial technology? ` +
    `Answer with ONLY "yes" or "no". No explanation.\n\n` +
    `Title: ${title}\nDescription: ${description}`;
  const out = (await callGemini(prompt))?.toLowerCase().trim() ?? "";
  return out.startsWith("yes");
}

async function generateSpokenSummary(
  title: string,
  summary: string,
  fullText: string | null,
  langCode: string,
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


// ── Main ───────────────────────────────────────────────────────────────────
async function collectForTerritory(t: Territory, sources: "rss" | "gnews" | "all"): Promise<FetchedArticle[]> {
  const out: FetchedArticle[] = [];

  if (sources === "rss" || sources === "all") {
    const feeds = t.rss_feeds ?? [];
    const rssResults = await Promise.all(feeds.map((u) => fetchRss(u)));
    out.push(...rssResults.flat().map((a) => ({ ...a, territory_id: t.id })));
  }

  // GNews: results are ALWAYS tagged with this territory's id (never __global__),
  // because the search was scoped to that territory's country code. No AI
  // classification runs on GNews items.
  if (sources === "gnews" || sources === "all") {
    const countries = t.gnews_countries ?? [];
    if (countries.length) {
      const idx = Math.floor(Date.now() / (12 * 60 * 60 * 1000)) % countries.length;
      const country = countries[idx];
      const items = await fetchGNews(country);
      console.log(`GNews ${t.id} country=${country} returned ${items.length} items`);
      out.push(...items.map((a) => ({ ...a, territory_id: t.id })));
    }
  }

  return out;
}

async function collectGlobal(): Promise<FetchedArticle[]> {
  const results = await Promise.all(GLOBAL_RSS_FEEDS.map((u) => fetchRss(u)));
  return results.flat().map((a) => ({ ...a, territory_id: "__global__" }));
}

// Pan-EMEA feeds (Finextra, etc.) — fetched once, then fanned out to every
// active territory so every region gets pan-European fintech coverage and no
// territory shows 0 stories. Skips AI classification.
async function collectPanEmeaFanout(): Promise<FetchedArticle[]> {
  const results = await Promise.all(PAN_EMEA_RSS_FEEDS.map((u) => fetchRss(u)));
  const items = results.flat();
  const out: FetchedArticle[] = [];
  for (const t of ACTIVE_TERRITORIES) {
    for (const a of items) out.push({ ...a, territory_id: t.id });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Determine which sources to fetch. Body or query param: sources=rss|gnews|all (default: rss)
  let sources: "rss" | "gnews" | "all" = "rss";
  const urlObj = new URL(req.url);
  const qsSource = urlObj.searchParams.get("sources");
  if (qsSource === "gnews" || qsSource === "all" || qsSource === "rss") sources = qsSource;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.sources === "gnews" || body?.sources === "all" || body?.sources === "rss") {
        sources = body.sources;
      }
    } catch { /* ignore */ }
  }

  const started = Date.now();
  for (const key of Object.keys(rssSourceStats)) delete rssSourceStats[key];
  console.log(`fetch-news start; sources=${sources}; ${ACTIVE_TERRITORIES.length} territories`);

  // Collect from all territories + global (global is RSS only) in parallel
  // Collect from all territories + global. When GNews is involved, run
  // territories sequentially with a small delay to respect GNews rate limits
  // (free tier throttles bursts). RSS-only runs can go in parallel safely.
  let perTerritory: FetchedArticle[][];
  if (sources === "rss") {
    perTerritory = await Promise.all(ACTIVE_TERRITORIES.map((t) => collectForTerritory(t, sources)));
  } else {
    perTerritory = [];
    for (const t of ACTIVE_TERRITORIES) {
      perTerritory.push(await collectForTerritory(t, sources));
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  const globals = sources === "gnews" ? [] as FetchedArticle[] : await collectGlobal();
  const panEmea = sources === "gnews" ? [] as FetchedArticle[] : await collectPanEmeaFanout();
  const all: FetchedArticle[] = [...perTerritory.flat(), ...globals, ...panEmea];

  // Normalized title key: lowercase, collapse whitespace, trim.
  const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

  // Dedupe in-batch by (territory, url) and (territory, title) so pan-EMEA
  // articles can exist once per territory but never twice within the same one.
  const seenUrlKeys = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const unique = all.filter((a) => {
    const uKey = `${a.territory_id}::${a.url.trim()}`;
    const tKey = `${a.territory_id}::${normTitle(a.title)}`;
    if (seenUrlKeys.has(uKey) || seenTitleKeys.has(tKey)) return false;
    seenUrlKeys.add(uKey);
    seenTitleKeys.add(tKey);
    return true;
  });

  // Dedupe vs. DB — dedupe on (region, url) and (region, normalized title)
  // so the same Finextra URL can co-exist across territories.
  const urls = unique.map((a) => a.url);
  const [{ data: existingByUrl }, { data: existingRecent }] = await Promise.all([
    supabase.from("articles").select("url,region").in("url", urls),
    supabase
      .from("articles")
      .select("title,url,region")
      .gte("published_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5000),
  ]);
  const existingUrlKeys = new Set<string>([
    ...((existingByUrl ?? []).map((r: any) => `${r.region}::${r.url}`)),
    ...((existingRecent ?? []).map((r: any) => `${r.region}::${r.url}`)),
  ]);
  const existingTitleKeys = new Set<string>(
    (existingRecent ?? []).map((r: any) => `${r.region}::${normTitle(r.title)}`),
  );
  const fresh = unique.filter((a) => {
    // For items still pending AI classification (region will be resolved later),
    // fall back to plain URL/title dedupe against ANY region for those.
    if (a.territory_id === "__global__") {
      const anyRegionUrl = (existingByUrl ?? []).some((r: any) => r.url === a.url);
      const anyRegionTitle = (existingRecent ?? []).some(
        (r: any) => normTitle(r.title) === normTitle(a.title),
      );
      return !anyRegionUrl && !anyRegionTitle;
    }
    const uKey = `${a.territory_id}::${a.url}`;
    const tKey = `${a.territory_id}::${normTitle(a.title)}`;
    return !existingUrlKeys.has(uKey) && !existingTitleKeys.has(tKey);
  });

  console.log(`collected=${all.length} unique=${unique.length} fresh=${fresh.length}`);
  console.log("rss source distribution:", rssSourceStats);

  // Round-robin interleave by territory so every region gets a fair share within the cap.
  // Global-feed items (pending classification) go last.
  const buckets = new Map<string, FetchedArticle[]>();
  for (const a of fresh) {
    if (!buckets.has(a.territory_id)) buckets.set(a.territory_id, []);
    buckets.get(a.territory_id)!.push(a);
  }
  const orderedKeys = [
    ...ACTIVE_TERRITORIES.map((t) => t.id).filter((k) => buckets.has(k)),
    ...(buckets.has("__global__") ? ["__global__"] : []),
  ];
  const interleaved: FetchedArticle[] = [];
  let more = true;
  while (more) {
    more = false;
    for (const k of orderedKeys) {
      const list = buckets.get(k)!;
      if (list.length) {
        interleaved.push(list.shift()!);
        more = true;
      }
    }
  }

  // Cap per run to protect AI credits
  const MAX_PER_RUN = 60;
  const toProcess = interleaved.slice(0, MAX_PER_RUN);
  const perRegionCounts: Record<string, number> = {};
  for (const a of toProcess) perRegionCounts[a.territory_id] = (perRegionCounts[a.territory_id] ?? 0) + 1;
  console.log("per-territory queued:", perRegionCounts);

  // Classify + summarize (limit concurrency)
  const rows: any[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const done = await Promise.all(
      batch.map(async (a) => {
        const relevant = await isFintechRelevant(a.title, a.description);
        if (!relevant) {
          console.log(`skip (not fintech): ${a.title.slice(0, 80)}`);
          return null;
        }
        let region = a.territory_id;
        if (region === "__global__") {
          region = await classifyTerritory(a.title, a.description);
        }
        const skipFullText = isSiftedUrl(a.url);
        const [summary, fullText] = await Promise.all([
          summarize(a.title, a.description),
          skipFullText ? Promise.resolve(null) : extractFullText(a.url),
        ]);
        console.log(
          `extract ${skipFullText ? "skip(sifted)" : fullText ? `ok(${fullText.length})` : "miss"}: ${new URL(a.url).hostname}`,
        );
        const summaryText = (() => {
          const candidate = (summary ?? a.description ?? "").trim();
          if (!candidate || normTitle(candidate) === normTitle(a.title)) return a.title;
          return candidate;
        })();
        const SOURCE_LANG: Record<string, string> = {
          "NOS": "nl", "NRC": "nl", "NU.nl": "nl",
          "La Repubblica": "it", "Il Sole 24 Ore": "it",
          "Expansion": "es", "Expansión": "es",
          "E24": "no", "e24.no": "no",
          "Handelsblatt": "de", "Manager Magazin": "de", "Finanzen.net": "de",
        };
        return {
          title: a.title,
          url: a.url,
          source: a.source,
          summary: summaryText,
          full_text: fullText,
          region,
          language: SOURCE_LANG[a.source] ?? "en",
          published_at: a.published_at,
          is_breaking: false,
          is_in_brief: false,
          global_ticker: region === "global",
        };
      }),
    );
    rows.push(...done.filter((r): r is NonNullable<typeof r> => r !== null));
  }

  let inserted = 0;
  let ttsGenerated = 0;
  if (rows.length) {
    const { data: insertedRows, error } = await supabase
      .from("articles")
      .insert(rows)
      .select("id,title,summary,full_text,language");
    if (error) {
      console.error("Insert failed", error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message, collected: all.length }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    inserted = insertedRows?.length ?? 0;

    // Per-article spoken summary + TTS enrichment (rate-limited).
    if (hasServiceAccount() && insertedRows && insertedRows.length) {
      const toEnrich = insertedRows.slice(0, MAX_TTS_PER_RUN);
      console.log(`enriching ${toEnrich.length}/${insertedRows.length} articles with spoken summary + TTS`);
      for (const row of toEnrich) {
        try {
          const langCode = (row as any).language ?? "en";
          const spoken = await generateSpokenSummary(
            (row as any).title,
            (row as any).summary ?? "",
            (row as any).full_text ?? null,
            langCode,
          );
          if (!spoken) {
            console.warn(`[enrich ${row.id}] no spoken summary`);
            await new Promise((r) => setTimeout(r, TTS_DELAY_MS));
            continue;
          }
          await supabase.from("articles").update({ spoken_summary: spoken }).eq("id", row.id);

          const ttsLang = LANG_TTS_CODE[langCode] ?? "en-GB";
          const wav = await synthesizeToWav(spoken, ttsLang, "Leda");
          const path = `${row.id}.wav`;
          const { error: upErr } = await supabase.storage
            .from("articles")
            .upload(path, wav, { contentType: "audio/wav", upsert: true });
          if (upErr) throw upErr;
          const { data: signed, error: signErr } = await supabase.storage
            .from("articles")
            .createSignedUrl(path, 60 * 60 * 24 * 30);
          if (signErr) throw signErr;
          await supabase.from("articles").update({ article_audio_url: signed.signedUrl }).eq("id", row.id);
          ttsGenerated += 1;
          console.log(`[enrich ${row.id}] audio saved`);
        } catch (e) {
          console.warn(`[enrich ${row.id}] failed:`, (e as Error).message);
        }
        await new Promise((r) => setTimeout(r, TTS_DELAY_MS));
      }
    }
  }


  const summary = {
    ok: true,
    ms: Date.now() - started,
    territories: ACTIVE_TERRITORIES.length,
    collected: all.length,
    unique: unique.length,
    fresh: fresh.length,
    processed: toProcess.length,
    inserted,
    ttsGenerated,
    rssSourceStats,
  };
  console.log("fetch-news done", summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});