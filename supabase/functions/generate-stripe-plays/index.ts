import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED_INDUSTRIES = [
  "Technology",
  "Agriculture",
  "Auto",
  "Construction",
  "Consumer Packaged Goods",
  "Education",
  "Energy, Utilities & Waste",
  "Financial Services",
  "Food & Beverage",
  "Gambling",
  "Gaming",
  "Healthcare",
  "Holding Companies",
  "Hospitality",
  "Insurance",
  "Manufacturing & Heavy Industry",
  "Media",
  "Non-Profits",
  "Organizations",
  "Professional Services",
  "Public Sector",
  "Real Estate",
  "Retail",
  "Ticketing & Events",
  "Transportation & Logistics",
  "Travel & Leisure",
  "Wellness & Fitness",
] as const;

const ALLOWED_INDUSTRY_SET = new Set<string>(ALLOWED_INDUSTRIES);

function cleanIndustries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const cleaned = value
    .map((industry) => String(industry).trim())
    .filter((industry) => ALLOWED_INDUSTRY_SET.has(industry));

  return Array.from(new Set(cleaned)).slice(0, 3);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    async function callGemini(prompt: string): Promise<string> {
    const serviceAccount = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);
    
    // Create JWT for Google OAuth
    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
    }));

    // Import the private key and sign
    const pemKey = serviceAccount.private_key;
    const pemContents = pemKey.replace(/-----BEGIN PRIVATE KEY-----/, "")
        .replace(/-----END PRIVATE KEY-----/, "")
        .replace(/\n/g, "");
    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
    
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signatureInput);
    const jwt = `${header}.${payload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

    // Exchange JWT for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Call Vertex AI
    const PROJECT_ID = "tick-502812";
    const LOCATION = "us-central1";
    const MODEL = "gemini-2.0-flash";
    
    const res = await fetch(
        `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`,
        {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
        }
    );
    
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

serve(async (req) => {
    const cronHeader = req.headers.get("x-cron-secret");
    if (cronHeader !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

// Fetch brief articles from the last 72h that either need a play or need target industries.
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: candidateArticles, error: artErr } = await supabase
    .from("articles")
    .select("id, title, summary, region, spoken_summary, stripe_play, target_industries")
    .eq("is_in_brief", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false });

  const articles = (candidateArticles ?? []).filter((article) => {
    const hasPlay = !!article.stripe_play;
    const hasIndustries = Array.isArray(article.target_industries) && article.target_industries.length > 0;
    return !hasPlay || !hasIndustries;
  });

  if (artErr || !articles.length) {
    return new Response(JSON.stringify({ message: "No articles to process", error: artErr }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch products and success stories
  const { data: products } = await supabase.from("stripe_products").select("*");
  const { data: stories } = await supabase.from("success_stories").select("*");

  // Group articles by region
  const byRegion: Record<string, typeof articles> = {};
  for (const art of articles) {
    if (!byRegion[art.region]) byRegion[art.region] = [];
    byRegion[art.region].push(art);
  }

  let totalProcessed = 0;

  for (const region of Object.keys(byRegion)) {
    const regionArticles = byRegion[region];

    // Filter products relevant to this region
    const regionProducts = products?.filter(
      (p) => p.region_relevance.includes("all") || p.region_relevance.includes(region)
    ) || [];

    // Sort success stories: same region first, then by product relevance
    const regionStories = stories?.sort((a, b) => {
      const aScore = a.region === region ? 2 : (a.region === "americas" ? 0 : 1);
      const bScore = b.region === region ? 2 : (b.region === "americas" ? 0 : 1);
      return bScore - aScore;
    }) || [];

    const productContext = regionProducts.map(
      (p) => `- ${p.name} (${p.id}): ${p.description}. Use cases: ${p.use_cases.join(", ")}. Pitch: ${p.pitch_angle}. Phase: ${p.availability_phase || "ga"}`
    ).join("\n");

    const storiesContext = regionStories.slice(0, 30).map(
      (s) => `- ${s.company} [${s.region}/${s.industry}] uses ${s.products.join(", ")}. ${s.metric ? "Result: " + s.metric + ". " : ""}${s.summary}`
    ).join("\n");

    const articlesContext = regionArticles.map(
      (a, i) => `[${i}] "${a.title}" — ${a.summary || a.spoken_summary || ""}`
    ).join("\n\n");

    const prompt = `You are a Stripe SDR prospecting strategist for EMEA fintech and technology market signals.

    Your job is to convert public news into useful outbound plays for Stripe SDRs.

    You are NOT a general GTM strategist.
    You are NOT writing product marketing copy.
    You are NOT trying to force a Stripe angle onto every article.

    For each article, decide whether the news creates a credible reason for an SDR to contact a company in a relevant industry today.

    A good Stripe Play must have all 4:
    1. A concrete news trigger: something specific happened, such as a launch, funding round, expansion, regulation, outage, partnership, fraud issue, product shift, or market movement.
    2. A commercial pain: the news points to a real operational, payments, billing, fraud, compliance, money movement, conversion, or expansion problem.
    3. A Stripe-relevant angle: one or more available Stripe products plausibly help with that pain.
    4. SDR usability: the play is specific enough that an SDR could use it as an outreach hook without sounding generic.

    Reject the article if:
    - The Stripe connection is weak or speculative.
    - The article is only about executive moves, awards, vague funding, opinion, internal drama, or generic market commentary.
    - The play would sound like “you are growing, use Stripe.”
    - The article is interesting but does not create an actionable prospecting trigger.

    REGION: ${region}

    STRIPE PRODUCTS AVAILABLE IN THIS REGION:
    ${productContext}

    SUCCESS STORIES FOR PROOF POINTS:
    Use these only as supporting evidence. Do not force a proof point if none fits.
    ${storiesContext}

    ALLOWED TARGET INDUSTRIES:
    ${ALLOWED_INDUSTRIES.map((industry) => `- ${industry}`).join("\n")}

    ARTICLES:
    ${articlesContext}

    For each article, respond with a valid JSON array. Each element must have this exact shape:
    {
      "index": <article index number>,
      "has_play": true/false,
      "stripe_play": "<If has_play is true: 1-2 sharp sentences describing the outbound play. Name the target account type/persona, the pain created by the news, why now, and the Stripe-relevant angle. If has_play is false: empty string.>",
      "products": ["<product_id>", ...],
      "target_industries": ["<1-3 allowed target industries>"],
      "proof_point": "<One concise sentence referencing the best matching success story. Include the company name and result/metric if available. Empty string if no credible match.>",
      "proof_story_company": "<company name from success stories list, or empty>"
    }

    Stripe Play writing rules:
    - Make the play useful to an SDR deciding who to prospect.
    - Start from the news trigger, not from the Stripe product.
    - Be specific about the account type: e.g. fintechs expanding internationally, marketplaces adding seller services, retailers improving checkout conversion, SaaS companies moving upmarket.
    - Explain the “why now” clearly.
    - Do not use generic phrasing like “streamline payments”, “enhance customer experience”, or “unlock growth” unless tied to a specific pain.
    - Do not write fluffy product marketing copy.
    - Do not mention unsupported Stripe products.
    - Products must be from the available product list and available in this region.

    Industry tagging rules:
    - target_industries must contain 1-3 values from ALLOWED TARGET INDUSTRIES exactly.
    - Do not invent, rename, abbreviate, or pluralize industries.
    - Choose industries based on which account types an SDR should use this play with, not merely the article publisher's industry.
    - If the article is about a fintech infrastructure issue, likely industries include Financial Services and Technology.
    - If the article is about checkout, ecommerce, consumer demand, loyalty, or payments conversion, consider Retail, Food & Beverage, Travel & Leisure, Hospitality, or Ticketing & Events where relevant.
    - If the article is about platforms, marketplaces, embedded finance, seller onboarding, or payouts, consider Technology, Professional Services, Retail, Transportation & Logistics, or Financial Services depending on the use case.
    - If no target industry is clear, return has_play: false.

    Proof point rules:
    - Match proof points by product first, then use case, then industry.
    - The proof point should support the play, not become the whole play.
    - Do not use a proof point if it feels unrelated.
    - proof_story_company must exactly match the company name from the success stories list when used.

    Quality bar:
    Before returning has_play: true, silently ask:
    - Would this help an SDR know which account type to contact?
    - Could this become a credible first sentence in an email?
    - Is the Stripe angle grounded in the article, not invented?
    - Is the proof point actually relevant?

    Return ONLY the JSON array. No markdown fences. No commentary.`;

    const response = await callGemini(prompt);

    // Parse response
    let plays: any[];
    try {
      const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      plays = JSON.parse(cleaned);
    } catch {
      console.error(`Failed to parse plays for ${region}:`, response.slice(0, 200));
      continue;
    }

    // Update articles with plays
    for (const play of plays) {
      if (!play.has_play) continue;

      const article = regionArticles[play.index];
      if (!article) continue;

      // Find matching success story ID
      let storyId = null;
      if (play.proof_story_company) {
        const match = stories?.find(
          (s) => s.company.toLowerCase() === play.proof_story_company.toLowerCase()
        );
        if (match) storyId = match.id;
      }

      const targetIndustries = cleanIndustries(play.target_industries);

            const { error: updateErr } = await supabase
              .from("articles")
              .update({
                stripe_play: play.stripe_play,
                stripe_products: play.products,
                target_industries: targetIndustries,
                success_story_id: storyId,
                proof_point_text: play.proof_point || null,
              })
              .eq("id", article.id);

      if (!updateErr) totalProcessed++;
    }
  }

  return new Response(
    JSON.stringify({ success: true, processed: totalProcessed, total_articles: articles.length }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
