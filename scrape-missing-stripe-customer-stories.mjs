#!/usr/bin/env node

/**
 * Scrape a known list of Stripe customer story URLs into the success_stories CSV schema.
 *
 * This is intended for the second pass after extracting rendered links from
 * https://stripe.com/customers/all with filters removed.
 *
 * Usage:
 *   node scrape-missing-stripe-customer-stories.mjs \
 *     --urls missing_stripe_customer_story_urls.txt \
 *     --out missing_success_stories_raw.csv
 *
 * Notes:
 * - This is deliberately conservative. It uses page title/meta description and
 *   a focused “Products used” text window when available, rather than scanning
 *   the entire page/footer for product keywords.
 * - Treat output as raw. Run a manual/data-quality pass before importing.
 */

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const args = new Map(
  process.argv.slice(2).map((arg, i, arr) => {
    if (!arg.startsWith('--')) return [arg, true];
    const key = arg.slice(2);
    const next = arr[i + 1];
    return [key, next && !next.startsWith('--') ? next : true];
  }),
);

const URLS_PATH = args.get('urls') || 'missing_stripe_customer_story_urls.txt';
const OUT = args.get('out') || 'missing_success_stories_raw.csv';
const NOW = new Date().toISOString();
const STRIPE_ORIGIN = 'https://stripe.com';

const PRODUCT_KEYWORDS = [
  ['adaptive-pricing', ['Adaptive Pricing']],
  ['authorization-boost', ['Authorization Boost', 'Authorisation Boost']],
  ['billing', ['Billing', 'Smart Retries', 'subscription', 'subscriptions']],
  ['capital', ['Capital']],
  ['checkout', ['Checkout']],
  ['climate', ['Climate']],
  ['connect', ['Connect']],
  ['data-pipeline', ['Data Pipeline']],
  ['elements', ['Elements', 'Payment Element']],
  ['financial-connections', ['Financial Connections', 'Instant Bank Payments']],
  ['identity', ['Identity']],
  ['invoicing', ['Invoicing', 'Invoice']],
  ['issuing', ['Issuing']],
  ['link', ['Link']],
  ['payments', ['Payments']],
  ['radar', ['Radar']],
  ['revenue-recognition', ['Revenue Recognition']],
  ['sigma', ['Sigma']],
  ['tax', ['Stripe Tax']],
  ['terminal', ['Terminal', 'Tap to Pay']],
  ['treasury', ['Treasury']],
];

const REGION_HINTS = [
  [/\b(Japan|Singapore|Australia|India|APAC|Asia|Hong Kong|New Zealand|Malaysia|Indonesia)\b/i, 'apac'],
  [/\b(UK|United Kingdom|Ireland|London|Scotland|England|Wales)\b/i, 'uk-ireland'],
  [/\b(France|Paris)\b/i, 'france'],
  [/\b(Germany|Berlin|Munich)\b/i, 'germany'],
  [/\b(Sweden|Norway|Denmark|Finland|Nordic|Copenhagen|Stockholm|Oslo|Helsinki)\b/i, 'nordics'],
  [/\b(Belgium|Netherlands|Luxembourg|Amsterdam|Brussels)\b/i, 'benelux'],
  [/\b(Spain|Portugal|Madrid|Lisbon|Barcelona)\b/i, 'iberia'],
  [/\b(UAE|United Arab Emirates|Saudi|Middle East|Dubai|Israel)\b/i, 'middle-east'],
  [/\b(United States|US|USA|Canada|Mexico|Brazil|Americas|New York|San Francisco|California|Texas)\b/i, 'americas'],
];

const INDUSTRY_HINTS = [
  ['AI', ['AI', 'artificial intelligence', 'LLM']],
  ['SaaS', ['SaaS', 'software', 'subscription software']],
  ['marketplace', ['marketplace', 'two-sided']],
  ['ecommerce', ['ecommerce', 'e-commerce', 'online store', 'retail']],
  ['fintech', ['fintech', 'financial', 'banking', 'investment']],
  ['travel', ['travel', 'airline', 'hotel', 'hospitality']],
  ['food and beverage', ['restaurant', 'food delivery', 'grocery', 'food']],
  ['healthcare', ['health', 'healthcare', 'medical', 'wellness']],
  ['education', ['education', 'learning', 'school']],
  ['nonprofit', ['nonprofit', 'donation', 'charity', 'union']],
  ['mobility', ['mobility', 'transportation', 'parking', 'car sharing']],
  ['creator economy', ['creator', 'publishing', 'newsletter', 'content']],
];

function htmlDecode(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html = '') {
  return htmlDecode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return htmlDecode(m[1]);
  }
  return '';
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return htmlDecode(stripTags(h1 || title || ''));
}

function slugFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('customers');
  return i >= 0 && parts[i + 1] ? parts[i + 1] : parts.at(-1);
}

function titleFromSlug(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bAws\b/g, 'AWS')
    .replace(/\bApi\b/g, 'API')
    .replace(/\bUs\b/g, 'US');
}

function extractCompany(html, url) {
  const title = extractTitle(html) || extractMeta(html, 'og:title');
  const slugName = titleFromSlug(slugFromUrl(url));
  let candidate = (extractMeta(html, 'og:title') || title || slugName)
    .replace(/\s*\|\s*Stripe\s*$/i, '')
    .replace(/\s*case study\s*$/i, '')
    .trim();
  if (candidate.length > 55 || /\b(increases|improves|expands|scales|builds|launches|partners|selects|drives|supports|saves|collects|automates|boosts|grows|reduces|recovers|helps)\b/i.test(candidate)) {
    candidate = slugName;
  }
  return candidate || slugName;
}

function focusedProductText(html) {
  const text = stripTags(html);
  const idx = text.search(/Products used|Products|Solutions/i);
  if (idx >= 0) return text.slice(idx, idx + 1800);
  return `${extractTitle(html)} ${extractMeta(html, 'description')} ${extractMeta(html, 'og:description')}`;
}

function inferProducts(html) {
  const text = focusedProductText(html);
  const found = [];
  for (const [product, keys] of PRODUCT_KEYWORDS) {
    if (keys.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))) found.push(product);
  }
  return [...new Set(found)];
}

function inferIndustry(text) {
  const hit = INDUSTRY_HINTS.find(([, keys]) => keys.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)));
  return hit ? hit[0] : '';
}

function inferRegion(text) {
  const hit = REGION_HINTS.find(([regex]) => regex.test(text));
  return hit ? hit[1] : 'global';
}

function extractMetric(text) {
  const candidates = [];
  const patterns = [
    /(?:[$£€¥]\s?\d[\d,.]*(?:\s?(?:K|M|B|million|billion))?\+?)/gi,
    /(?:\d[\d,.]*\s?%\s?(?:increase|decrease|reduction|uplift|improvement|conversion|authorization|authorisation|growth|more|less|faster|saved|recovered)?)/gi,
    /(?:\d[\d,.]*\s?(?:x|×)\s?(?:growth|increase|faster|more)?)/gi,
    /(?:\d[\d,.]*\+?\s?(?:customers|users|countries|accounts|merchants|transactions|businesses|attendees|downloads|subscribers))/gi,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const val = htmlDecode(m[0]).trim();
      if (val.length >= 3 && val.length <= 90) candidates.push(val);
    }
  }
  return [...new Set(candidates)].slice(0, 2).join('; ');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'stripe-customer-story-known-url-scraper/2.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
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

async function scrape(url) {
  const html = await fetchText(url);
  const title = extractTitle(html);
  const description = extractMeta(html, 'description') || extractMeta(html, 'og:description');
  const focused = `${title}\n${description}\n${focusedProductText(html)}`;
  const company = extractCompany(html, url);
  const products = inferProducts(html);
  const industry = inferIndustry(focused);
  const region = inferRegion(focused);
  const metric = extractMetric(focused);
  return {
    id: crypto.randomUUID(),
    company,
    region,
    industry,
    products: JSON.stringify(products),
    metric,
    summary: description || `${company} uses Stripe to support its ${industry || 'business'}.`,
    url: url.replace('/us/customers/', '/customers/'),
    created_at: NOW,
  };
}

function toCsv(rows) {
  const headers = ['id','company','region','industry','products','metric','summary','url','created_at'];
  return [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n') + '\n';
}

const urls = (await fs.readFile(URLS_PATH, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
console.error(`[info] urls: ${urls.length}`);
const rows = (await mapLimit(urls, 6, async (url, i) => {
  try {
    console.error(`[scrape ${i+1}/${urls.length}] ${url}`);
    return await scrape(url);
  } catch (err) {
    console.error(`[warn] failed ${url}: ${err.message}`);
    return null;
  }
})).filter(Boolean);
await fs.writeFile(OUT, toCsv(rows));
console.error(`[done] wrote ${OUT}: ${rows.length} rows`);
