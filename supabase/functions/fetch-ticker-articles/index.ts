// Scheduled every 30 minutes. Pulls fintech news from a small, high-quality
// English-language pool and inserts them into public.articles tagged with
// ticker_source=true so the BREAKING NEWS ticker can source only from these.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type FeedKind = "standard" | "newsletter";
const TICKER_FEEDS: { url: string; source: string; kind: FeedKind }[] = [
  { url: "https://www.finextra.com/rss/headlines.aspx", source: "Finextra", kind: "standard" },
  { url: "https://techcrunch.com/category/fintech/feed/", source: "TechCrunch", kind: "standard" },
  { url: "https://www.connectingthedotsinfin.tech/rss/", source: "Connecting the Dots in Fintech", kind: "newsletter" },
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "\u201C", rdquo: "\u201D", lsquo: "\u2018", rsquo: "\u2019",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; } })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function extractTagRaw(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

type Item = { title: string; url: string; source: string; description: string; published_at: string; rawContent?: string };

function parseRss(xml: string, source: string, kind: FeedKind): Item[] {
  const items: Item[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    const description = extractTag(block, "description") || extractTag(block, "summary") || "";
    const pub = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || new Date().toISOString();
    if (!title || !link) continue;
    const publishedIso = new Date(pub).toISOString();
    const ageMs = Date.now() - new Date(publishedIso).getTime();
    const maxAge = kind === "newsletter" ? 7 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    if (ageMs > maxAge) {
      if (source === "TechCrunch") {
        console.log(`[TechCrunch] SKIP too old (${Math.round(ageMs / 3600000)}h): ${title}`);
      }
      continue;
    }
    if (source === "TechCrunch") {
      console.log(`[TechCrunch] KEEP (${Math.round(ageMs / 3600000)}h): ${title}`);
    }
    const rawContent = kind === "newsletter"
      ? (extractTagRaw(block, "content:encoded") || extractTagRaw(block, "description") || extractTagRaw(block, "summary") || "")
      : undefined;
    items.push({
      title: title.slice(0, 500),
      url: link.trim(),
      source,
      description: description.slice(0, 1200),
      published_at: publishedIso,
      rawContent: rawContent ?? undefined,
    });
  }
  return items.slice(0, 20);
}

async function fetchFeed(url: string, source: string, kind: FeedKind): Promise<Item[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "tick-news-bot/1.0 (+https://tick.app)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.warn(`RSS ${url} → ${res.status}`); return []; }
    return parseRss(await res.text(), source, kind);
  } catch (e) {
    console.warn(`RSS ${url} failed`, (e as Error).message);
    return [];
  }
}

type ExtractedStory = { title: string; url: string | null };

async function extractNewsletterStories(item: Item): Promise<ExtractedStory[]> {
  if (!LOVABLE_API_KEY) {
    console.warn("LOVABLE_API_KEY missing; skipping newsletter extraction");
    return [];
  }
  const content = (item.rawContent || item.description || "").slice(0, 40000);
  if (!content.trim()) return [];

  const prompt = `This is a fintech newsletter edition. Extract ONLY the 2-3 most significant stories from it. A story qualifies if it meets at least 2 of these criteria:

- Involves >$100M in funding, acquisition, or market value
- New regulation or major policy change affecting payments/banking
- Product launch or partnership from a tier-1 company (Stripe, PayPal, Visa, Mastercard, Adyen, Klarna, Revolut, major banks)
- IPO, major expansion, or market-moving event
- Directly relevant to how merchants accept payments or manage financial infrastructure

For each qualifying story, return a JSON array with: { title: 'concise headline under 80 chars', url: 'source link if available, otherwise null' }

Ignore: people moves, minor partnerships, crypto speculation, community announcements, and newsletter meta-content.

Newsletter content (may contain HTML):
"""
${content}
"""

Respond with ONLY a JSON array, no prose.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`Newsletter AI extract failed ${res.status}:`, await res.text().catch(() => ""));
      return [];
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    // Try to find a JSON array in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    let parsed: any;
    if (arrayMatch) {
      parsed = JSON.parse(arrayMatch[0]);
    } else {
      const obj = JSON.parse(text);
      parsed = Array.isArray(obj) ? obj : (obj.stories || obj.items || obj.results || []);
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.title === "string" && s.title.trim().length > 0)
      .map((s) => ({
        title: String(s.title).slice(0, 200).trim(),
        url: typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : null,
      }))
      .slice(0, 3);
  } catch (e) {
    console.warn("Newsletter extraction error:", (e as Error).message);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authFail = checkCronAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const started = Date.now();

  try {
    const results = await Promise.all(TICKER_FEEDS.map((f) => fetchFeed(f.url, f.source, f.kind)));

    // Split standard vs newsletter items
    const standardItems: Item[] = [];
    const newsletterItems: Item[] = [];
    TICKER_FEEDS.forEach((f, i) => {
      const bucket = f.kind === "newsletter" ? newsletterItems : standardItems;
      bucket.push(...results[i]);
    });

    // Expand newsletter items into individual stories via AI
    const expandedFromNewsletter: Item[] = [];
    for (const nl of newsletterItems) {
      const stories = await extractNewsletterStories(nl);
      for (const s of stories) {
        expandedFromNewsletter.push({
          title: s.title,
          url: s.url || `${nl.url}#${encodeURIComponent(s.title.slice(0, 60))}`,
          source: nl.source,
          description: `From ${nl.source}: ${nl.title}`,
          published_at: nl.published_at,
        });
      }
    }

    const all = [...standardItems, ...expandedFromNewsletter];

    // In-batch dedupe
    const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const unique = all.filter((a) => {
      const t = normTitle(a.title);
      if (seenUrls.has(a.url) || seenTitles.has(t)) return false;
      seenUrls.add(a.url); seenTitles.add(t); return true;
    });

    // Dedupe vs. DB
    const urls = unique.map((a) => a.url);
    const [{ data: byUrl }, { data: recent }] = await Promise.all([
      urls.length ? supabase.from("articles").select("url").in("url", urls) : Promise.resolve({ data: [] as any[] }),
      supabase.from("articles")
        .select("title,url")
        .gte("published_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5000),
    ]);
    const existingUrls = new Set<string>([
      ...((byUrl ?? []).map((r: any) => r.url)),
      ...((recent ?? []).map((r: any) => r.url)),
    ]);
    const existingTitles = new Set<string>((recent ?? []).map((r: any) => normTitle(r.title)));
    const fresh = unique.filter((a) => !existingUrls.has(a.url) && !existingTitles.has(normTitle(a.title)));

    // Flag existing rows (scooped up by fetch-news first) as ticker_source=true
    // so curate-ticker can consider them.
    let flagged = 0;
    const existingTickerUrls = Array.from(existingUrls);
    if (existingTickerUrls.length) {
      const { error: upErr, count } = await supabase
        .from("articles")
        .update({ ticker_source: true }, { count: "exact" })
        .in("url", existingTickerUrls)
        .eq("ticker_source", false);
      if (upErr) console.warn("flag ticker_source update failed:", upErr.message);
      flagged = count ?? 0;
    }

    const rows = fresh.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.source,
      summary: a.description.slice(0, 400) || null,
      region: "global",
      language: "en",
      published_at: a.published_at,
      is_breaking: false,
      is_in_brief: false,
      global_ticker: false,
      ticker_source: true,
    }));

    let inserted = 0;
    if (rows.length) {
      const { error, count } = await supabase.from("articles").insert(rows, { count: "exact" });
      if (error) throw error;
      inserted = count ?? rows.length;
    }

    const summary = {
      ok: true,
      ms: Date.now() - started,
      collected: all.length,
      standard: standardItems.length,
      newsletterEditions: newsletterItems.length,
      newsletterStories: expandedFromNewsletter.length,
      unique: unique.length,
      fresh: fresh.length,
      inserted,
      flagged,
    };
    console.log("fetch-ticker-articles done", summary);
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("fetch-ticker-articles error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
