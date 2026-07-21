// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for territories.
// Adding a new territory = add ONE object to this array. Nothing else.
// Consumed by the client AND by supabase/functions/fetch-news via relative import.
// ─────────────────────────────────────────────────────────────────────────────

export type Language = {
  code: string;
  label: string;
  /** Full name used in prompts, e.g. "French". */
  name?: string;
  /** Google Cloud TTS voice name, e.g. "fr-FR-Journey-F". */
  tts_voice?: string;
  /** Google Cloud TTS BCP-47 language code, e.g. "fr-FR". */
  tts_language_code?: string;
  /** Approx characters per spoken second (for duration estimate). */
  chars_per_second?: number;
};

export type Territory = {
  id: string;
  name: string;
  flags: string;
  lat: number;
  lng: number;
  active: boolean;
  languages?: Language[];
  /** RSS feeds specific to this territory (global feeds are applied to every territory automatically). */
  rss_feeds?: string[];
  /** GNews country codes. Rotated through on each run to diversify coverage. */
  gnews_countries?: string[];
};

/** Pan-EMEA feed fanned out to every active territory (see fetch-news). */
export const PAN_EMEA_RSS_FEEDS: string[] = [
  "https://www.finextra.com/rss/headlines.aspx",
];

/** Global RSS feeds fetched once and AI-classified to the best-matching territory. */
export const GLOBAL_RSS_FEEDS: string[] = [
  "https://techcrunch.com/category/fintech/feed/",
  "https://www.theguardian.com/business/fintech/rss",
];

export const TERRITORIES: Territory[] = [
  {
    id: "uk-ireland",
    name: "UK & Ireland",
    flags: "🇬🇧🇮🇪",
    lat: 53.0,
    lng: -2.0,
    active: true,
    rss_feeds: [
      "https://sifted.eu/feed",
    ],
    gnews_countries: ["gb", "ie"],
  },
  {
    id: "france",
    name: "France",
    flags: "🇫🇷",
    lat: 48.86,
    lng: 2.35,
    active: true,
    languages: [{ code: "en", label: "EN" }, { code: "fr", label: "FR" }],
    rss_feeds: [
      "https://sifted.eu/feed",
      "https://tech.eu/feed",
    ],
    gnews_countries: ["fr"],
  },
  {
    id: "germany",
    name: "Germany",
    flags: "🇩🇪",
    lat: 52.52,
    lng: 13.41,
    active: true,
    languages: [{ code: "en", label: "EN" }, { code: "de", label: "DE" }],
    rss_feeds: [
      "https://sifted.eu/feed",
      "https://tech.eu/feed",
      "https://financefwd.com/feed/",
      "https://api.boerse-frankfurt.de/v1/feeds/news.rss",
    ],
    gnews_countries: ["de"],
  },
  {
    id: "nordics",
    name: "Nordics",
    flags: "🇸🇪🇩🇰🇳🇴🇫🇮",
    lat: 61.0,
    lng: 15.0,
    active: true,
    rss_feeds: [
      "https://sifted.eu/feed",
      "https://tech.eu/feed",
      "https://fintechnordics.com/feed/",
      "http://e24.no/rss2/?seksjon=boers-og-finans",
    ],
    gnews_countries: ["se", "dk", "no", "fi"],
  },
  {
    id: "benelux",
    name: "Benelux",
    flags: "🇳🇱🇧🇪🇱🇺",
    lat: 51.5,
    lng: 4.5,
    active: true,
    rss_feeds: [
      "https://tech.eu/feed",
    ],
    gnews_countries: ["nl", "be"],
  },
  {
    id: "iberia",
    name: "Iberia",
    flags: "🇪🇸🇵🇹",
    lat: 40.0,
    lng: -3.7,
    active: true,
    languages: [
      { code: "en", label: "EN" },
      { code: "es", label: "ES" },
      { code: "pt", label: "PT" },
    ],
    rss_feeds: [
      "https://www.expansion.com/rss/economia.xml",
    ],
    gnews_countries: ["es", "pt"],
  },
  {
    id: "cee",
    name: "CEE",
    flags: "🇵🇱🇨🇿🇷🇴🇭🇺",
    lat: 50.0,
    lng: 20.0,
    active: true,
    rss_feeds: [
      "https://emerging-europe.com/feed/",
      "https://tech.eu/feed",
    ],
    gnews_countries: ["pl", "cz", "ro", "hu"],
  },
  {
    id: "italy",
    name: "Italy",
    flags: "🇮🇹",
    lat: 41.9,
    lng: 12.5,
    active: true,
    languages: [{ code: "en", label: "EN" }, { code: "it", label: "IT" }],
    rss_feeds: [
      "https://www.ilsole24ore.com/rss/economia.xml",
      "https://www.repubblica.it/rss/economia/rss2.0.xml",
    ],
    gnews_countries: ["it"],
  },
  {
    id: "middle-east",
    name: "Middle East",
    flags: "🇦🇪🇮🇱🇸🇦",
    lat: 25.0,
    lng: 45.0,
    active: true,
    rss_feeds: [
      "https://fintechnews.media/feed/",
      "https://www.arabnews.com/cat/2/rss.xml",
    ],
    gnews_countries: ["ae", "sa", "il"],
  },
];

export type RegionId = string;

export const ACTIVE_TERRITORIES: Territory[] = TERRITORIES.filter((t) => t.active);
export const REGION_IDS: string[] = ACTIVE_TERRITORIES.map((t) => t.id);
export const REGIONS: Record<string, Territory> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
);
