#!/usr/bin/env node

/**
 * Scrape Stripe public customer story pages into tick's success_stories CSV schema.
 *
 * Usage:
 *   node scripts/scrape-stripe-success-stories.mjs --existing success_stories_rows.csv
 *
 * Outputs:
 *   success_stories_expanded.csv  -> existing + newly scraped rows, deduped by URL
 *   success_stories_new_only.csv  -> only rows not already in --existing
 *
 * No npm dependencies required. Uses Node 18+ global fetch.
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";

const args = new Map(
  process.argv.slice(2).map((arg, i, arr) => {
    if (!arg.startsWith("--")) return [arg, true];
    const key = arg.slice(2);
    const next = arr[i + 1];
    return [key, next && !next.startsWith("--") ? next : true];
  }),
);

const EXISTING_PATH = args.get("existing") || "success_stories_rows.csv";
const OUT_ALL = args.get("out") || "success_stories_expanded.csv";
const OUT_NEW = args.get("new") || "success_stories_new_only.csv";
const LIMIT = Number(args.get("limit") || 0);

const NOW = new Date().toISOString();
const STRIPE_ORIGIN = "https://stripe.com";

const SEED_URLS = [
  "https://stripe.com/customers/all",
  "https://stripe.com/customers",
  "https://stripe.com/us/customers/all",
  "https://stripe.com/gb/customers",
  "https://stripe.com/in/customers/all",
  "https://stripe.com/jp/customers",
  "https://stripe.com/en-jp/customers",
  "https://stripe.com/en-sg/customers",
  "https://stripe.com/en-ca/customers",
  "https://stripe.com/en-fr/customers/all",
  "https://stripe.com/en-de/customers",
  "https://stripe.com/en-se/customers",
  "https://stripe.com/en-no/customers",
  "https://stripe.com/en-li/customers",
  "https://stripe.com/en-be/customers",
  "https://stripe.com/en-br/customers",
  "https://stripe.com/ae/customers/all",
  "https://stripe.com/sitemap",
  "https://stripe.com/sitemap.xml",
];

const PRODUCT_KEYWORDS = [
  ["adaptive-pricing", ["Adaptive Pricing"]],
  ["authorization-boost", ["Authorization Boost", "Authorisation Boost"]],
  ["billing", ["Billing", "subscription", "subscriptions", "Smart Retries"]],
  ["capital", ["Capital"]],
  ["checkout", ["Checkout"]],
  ["climate", ["Climate"]],
  ["connect", ["Connect", "marketplace", "platform payments", "payouts"]],
  ["data-pipeline", ["Data Pipeline"]],
  ["elements", ["Elements", "Payment Element"]],
  ["financial-connections", ["Financial Connections", "Instant Bank Payments"]],
  ["identity", ["Identity"]],
  ["invoicing", ["Invoicing", "Invoice"]],
  ["issuing", ["Issuing"]],
  ["link", ["Link"]],
  ["payments", ["Payments", "payment processing", "payment methods", "cards"]],
  ["radar", ["Radar", "fraud"]],
  ["revenue-recognition", ["Revenue Recognition"]],
  ["sigma", ["Sigma"]],
  ["tax", ["Stripe Tax", "Tax"]],
  ["terminal", ["Terminal", "Tap to Pay", "in-person payments"]],
  ["treasury", ["Treasury"]],
];

const INDUSTRY_KEYWORDS = [
  ["AI", ["AI", "artificial intelligence", "LLM"]],
  ["SaaS", ["SaaS", "software", "subscription software"]],
  ["marketplace", ["marketplace", "two-sided"]],
  ["ecommerce", ["ecommerce", "e-commerce", "online store", "retail"]],
  ["fintech", ["fintech", "financial", "banking", "investment"]],
  ["travel", ["travel", "airline", "hotel", "hospitality"]],
  ["food delivery", ["restaurant", "food delivery", "grocery"]],
  ["healthcare", ["health", "healthcare", "medical", "wellness"]],
  ["education", ["education", "learning", "school"]],
  ["nonprofit", ["nonprofit", "donation", "charity", "union"]],
  ["mobility", ["mobility", "rideshare", "transportation", "parking"]],
  ["creator economy", ["creator", "publishing", "newsletter", "content"]],
];

const LOCALE_REGION_HINTS = [
  [/\/jp\//, "apac"],
  [/\/en-jp\//, "apac"],
  [/\/en-sg\//, "apac"],
  [/\/in\//, "apac"],
  [/\/au\//, "apac"],
  [/\/gb\//, "uk-ireland"],
  [/\/en-gb\//, "uk-ireland"],
  [/\/en-ie\//, "uk-ireland"],
  [/\/fr\//, "france"],
  [/\/en-fr\//, "france"],
  [/\/de\//, "germany"],
  [/\/en-de\//, "germany"],
  [/\/en-se\//, "nordics"],
  [/\/en-no\//, "nordics"],
  [/\/en-fi\//, "nordics"],
  [/\/en-dk\//, "nordics"],
  [/\/en-be\//, "benelux"],
  [/\/en-nl\//, "benelux"],
  [/\/es\//, "iberia"],
  [/\/en-es\//, "iberia"],
  [/\/ae\//, "middle-east"],
  [/\/mx\//, "americas"],
  [/\/br\//, "americas"],
  [/\/us\//, "americas"],
];

function htmlDecode(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html = "") {
  return htmlDecode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out;
}

async function readExistingRows(path) {
  try {
    const raw = await fs.readFile(path, "utf8");
    const lines = raw.trim().split(/\r?\n/);
    const headers = parseCsvLine(lines.shift());
    return lines.filter(Boolean).map((line) => {
      const vals = parseCsvLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
    });
  } catch {
    return [];
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "tick-success-story-scraper/1.0 (+internal prototype)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

function normalizeUrl(rawHref) {
  if (!rawHref) return null;

  let url;
  try {
    url = new URL(rawHref, STRIPE_ORIGIN);
  } catch {
    return null;
  }

  if (url.hostname !== "stripe.com") return null;
  url.hash = "";
  url.search = "";

  return url.toString().replace(/\/$/, "");
}

function isCustomerStoryUrl(url) {
  if (!url) return false;
  const u = new URL(url);
  const path = u.pathname;

  if (!path.includes("/customers")) return false;
  if (/\/customers\/?$/.test(path)) return false;
  if (/\/customers\/all\/?$/.test(path)) return false;

  const exclude = [
    "/docs/",
    "/api/",
    "/legal/",
    "/privacy",
    "/files/",
    "/sessions/",
    "/payments/",
    "/billing/customer",
    "/support/",
    "/marketplace/",
  ];

  return !exclude.some((x) => path.includes(x));
}

function extractUrlsFromHtml(html) {
  const urls = new Set();

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = normalizeUrl(match[1]);
    if (isCustomerStoryUrl(url)) urls.add(url);
  }

  // Sitemaps may be XML text without href attributes.
  for (const match of html.matchAll(/https:\/\/stripe\.com\/[^\s<>"']*\/customers\/[^\s<>"']*/gi)) {
    const url = normalizeUrl(match[0]);
    if (isCustomerStoryUrl(url)) urls.add(url);
  }

  return urls;
}

function titleFromSlug(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/ Ai\b/g, " AI")
    .replace(/ Aws\b/g, " AWS")
    .replace(/ Ibm\b/g, " IBM")
    .replace(/ Api\b/g, " API");
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"),
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return htmlDecode(m[1]);
  }

  return "";
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return htmlDecode(stripTags(h1 || title || ""));
}

function extractCompany(html, url) {
  const ogTitle = extractMeta(html, "og:title");
  const title = extractTitle(html) || ogTitle;
  const slugName = titleFromSlug(url);

  let candidate = ogTitle || title || slugName;
  candidate = candidate
    .replace(/\s*\|\s*Stripe\s*$/i, "")
    .replace(/\s*case study\s*$/i, "")
    .replace(/^How\s+/i, "")
    .replace(/\s+uses Stripe[\s\S]*$/i, "")
    .replace(/\s+with Stripe[\s\S]*$/i, "")
    .replace(/\s+on Stripe[\s\S]*$/i, "")
    .replace(/\s+and Stripe[\s\S]*$/i, "")
    .replace(/\s+case study$/i, "")
    .trim();

  // If the extracted title is a marketing sentence, prefer the slug.
  if (candidate.length > 48 || /\b(increases|improves|expands|scales|builds|launches|partners|selects|drives|supports|saves|collects)\b/i.test(candidate)) {
    candidate = slugName;
  }

  return candidate || slugName;
}

function inferProducts(text) {
  const found = [];
  for (const [product, keys] of PRODUCT_KEYWORDS) {
    if (keys.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) {
      found.push(product);
    }
  }

  // Payments is often implied; keep it only if explicitly found or no other payment product found.
  return Array.from(new Set(found));
}

function inferIndustry(text) {
  const hit = INDUSTRY_KEYWORDS.find(([, keys]) => keys.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)));
  return hit ? hit[0] : "";
}

function inferRegion(url, text) {
  const path = new URL(url).pathname;
  for (const [regex, region] of LOCALE_REGION_HINTS) {
    if (regex.test(path)) return region;
  }

  if (/\b(Japan|Singapore|Australia|India|APAC|Asia)\b/i.test(text)) return "apac";
  if (/\b(UK|United Kingdom|Ireland|London)\b/i.test(text)) return "uk-ireland";
  if (/\b(France|Paris)\b/i.test(text)) return "france";
  if (/\b(Germany|Berlin)\b/i.test(text)) return "germany";
  if (/\b(Sweden|Norway|Denmark|Finland|Nordic)\b/i.test(text)) return "nordics";
  if (/\b(Belgium|Netherlands|Luxembourg|Amsterdam)\b/i.test(text)) return "benelux";
  if (/\b(Spain|Portugal|Madrid|Lisbon)\b/i.test(text)) return "iberia";
  if (/\b(UAE|United Arab Emirates|Saudi|Middle East|Dubai)\b/i.test(text)) return "middle-east";
  if (/\b(United States|US|Canada|Mexico|Brazil|Americas)\b/i.test(text)) return "americas";

  return "global";
}

function extractMetric(text) {
  const candidates = [];
  const patterns = [
    /(?:[$£€¥]\s?\d[\d,.]*(?:\s?(?:K|M|B|million|billion))?\+?)/gi,
    /(?:\d[\d,.]*\s?%\s?(?:increase|decrease|reduction|uplift|improvement|conversion|authorization|authorisation|growth|more|less|faster|saved|recovered)?)/gi,
    /(?:\d[\d,.]*\s?(?:x|×)\s?(?:growth|increase|faster|more)?)/gi,
    /(?:\d[\d,.]*\+?\s?(?:customers|users|countries|accounts|merchants|transactions|businesses|attendees|downloads|subscribers|flight attendants|chapters))/gi,
    /(?:\d[\d,.]*\s?(?:days|weeks|months|years)\s?(?:to|faster|saved|reduction|launch|implementation|integration)?)/gi,
  ];

  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const val = htmlDecode(m[0]).trim();
      if (val.length >= 3 && val.length <= 90) candidates.push(val);
    }
  }

  return Array.from(new Set(candidates)).slice(0, 2).join("; ");
}

function summarize(company, products, industry, metric) {
  const productText = products.length ? products.map((p) => p.replace(/-/g, " ")).join(", ") : "Stripe";
  const metricText = metric ? `, with reported impact including ${metric}` : "";
  const industryText = industry ? ` ${industry}` : "";
  return `${company} uses ${productText} to support its${industryText} business${metricText}.`;
}

async function discoverUrls() {
  const urls = new Set();

  for (const seed of SEED_URLS) {
    try {
      console.error(`[discover] ${seed}`);
      const html = await fetchText(seed);
      for (const url of extractUrlsFromHtml(html)) urls.add(url);
    } catch (err) {
      console.error(`[warn] failed seed ${seed}: ${err.message}`);
    }
  }

  return Array.from(urls).sort();
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

async function scrapeStory(url) {
  const html = await fetchText(url);
  const description = extractMeta(html, "description") || extractMeta(html, "og:description");
  const title = extractTitle(html);
  const text = `${title}\n${description}\n${stripTags(html)}`;
  const company = extractCompany(html, url);
  const products = inferProducts(text);
  const industry = inferIndustry(text);
  const region = inferRegion(url, text);
  const metric = extractMetric(text);

  return {
    id: crypto.randomUUID(),
    company,
    region,
    industry,
    products: JSON.stringify(products),
    metric,
    summary: description || summarize(company, products, industry, metric),
    url,
    created_at: NOW,
  };
}

function toCsv(rows) {
  const headers = ["id", "company", "region", "industry", "products", "metric", "summary", "url", "created_at"];
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n") + "\n";
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function storyKey(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const customersIndex = parts.indexOf("customers");
    const slug = customersIndex >= 0 ? parts[customersIndex + 1] : parts.at(-1);
    return slug || canonicalUrl(url);
  } catch {
    return url;
  }
}

function urlPreference(url) {
  const path = new URL(url).pathname;
  if (/^\/customers\//.test(path)) return 0;
  if (/^\/us\/customers\//.test(path)) return 1;
  if (/^\/gb\/customers\//.test(path)) return 2;
  return 3;
}

const existingRows = await readExistingRows(EXISTING_PATH);
const existingKeys = new Set(existingRows.map((r) => storyKey(r.url)).filter(Boolean));

let discovered = await discoverUrls();

// De-dupe locale duplicates by customer-story slug, preferring canonical /customers/<slug>.
const discoveredByStory = new Map();
for (const url of discovered.sort((a, b) => urlPreference(a) - urlPreference(b) || a.localeCompare(b))) {
  const key = storyKey(url);
  if (!discoveredByStory.has(key)) discoveredByStory.set(key, url);
}

discovered = Array.from(discoveredByStory.values());
if (LIMIT > 0) discovered = discovered.slice(0, LIMIT);

console.error(`[info] existing rows: ${existingRows.length}`);
console.error(`[info] discovered unique customer story urls: ${discovered.length}`);

const scraped = (await mapLimit(discovered, 6, async (url) => {
  try {
    console.error(`[scrape] ${url}`);
    return await scrapeStory(url);
  } catch (err) {
    console.error(`[warn] failed story ${url}: ${err.message}`);
    return null;
  }
})).filter(Boolean);

const newRows = scraped.filter((r) => !existingKeys.has(storyKey(r.url)));

const mergedByStory = new Map();
for (const row of existingRows) mergedByStory.set(storyKey(row.url), row);
for (const row of scraped) {
  const key = storyKey(row.url);
  if (!mergedByStory.has(key)) mergedByStory.set(key, row);
}

const expanded = Array.from(mergedByStory.values()).sort((a, b) => String(a.company).localeCompare(String(b.company)));
const newOnly = newRows.sort((a, b) => String(a.company).localeCompare(String(b.company)));

await fs.writeFile(OUT_ALL, toCsv(expanded));
await fs.writeFile(OUT_NEW, toCsv(newOnly));

console.error(`[done] wrote ${OUT_ALL}: ${expanded.length} rows`);
console.error(`[done] wrote ${OUT_NEW}: ${newOnly.length} rows`);
