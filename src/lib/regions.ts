// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for territories.
// Adding a new territory = add ONE object to this array. Nothing else.
// Consumed by the client AND by supabase/functions/fetch-news via relative import.
// ─────────────────────────────────────────────────────────────────────────────

export type Language = {
  code: string;
  label: string;
  name?: string;
  tts_voice?: string;
  tts_language_code?: string;
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

/** Global RSS feeds fetched for every territory. Articles are AI-classified to the best-matching territory. */
export const GLOBAL_RSS_FEEDS: string[] = [
  "https://www.finextra.com/rss/channel.aspx?channel=payments",
  "https://techcrunch.com/category/fintech/feed/",
  "https://tech.eu/feed",
  "https://www.eu-startups.com/feed/",
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
      "https://www.finextra.com/rss/channel.aspx?channel=payments",
      "https://techcrunch.com/category/fintech/feed/",
      "https://thefintechtimes.com/feed/",
      "https://irishtechnews.ie/feed/",
      "https://www.eu-startups.com/feed/",
      "https://tech.eu/feed",
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
      "https://tech.eu/feed",
      "https://www.eu-startups.com/feed/",
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
      "https://financefwd.com/feed/",
      "https://paymentandbanking.com/feed/",
      "https://www.it-finanzmagazin.de/feed/",
      "https://www.deutsche-startups.de/feed/",
      "https://www.fintechnews.ch/feed/",
      "https://tech.eu/feed",
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
      "https://fintechnordics.com/feed/",
      "https://arcticstartup.com/feed/",
      "https://tech.eu/feed",
      "https://www.eu-startups.com/feed/",
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
      "https://www.eu-startups.com/feed/",
      "https://www.emerce.nl/feed",
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
      "https://www.eu-startups.com/feed/",
      "https://tech.eu/feed",
      "https://elreferente.es/feed/",
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
      "https://therecursive.com/feed/",
      "https://www.eu-startups.com/feed/",
      "https://tech.eu/feed",
      "https://mamstartup.pl/feed/",
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
      "https://startupitalia.eu/feed/",
      "https://www.economyup.it/feed/",
      "https://www.pagamentidigitali.it/feed/",
      "https://www.eu-startups.com/feed/",
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
      "https://www.arabnews.com/cat/2/rss.xml",
      "https://www.wamda.com/feed",
      "https://www.menabytes.com/feed",
      "https://fintechnews.media/feed/",
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
