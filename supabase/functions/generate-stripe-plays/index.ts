import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  // Fetch brief articles from the last 24h that don't have a play yet
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: articles, error: artErr } = await supabase
    .from("articles")
    .select("id, title, summary, region, spoken_summary")
    .eq("is_in_brief", true)
    .is("stripe_play", null)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false });

  if (artErr || !articles?.length) {
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

    const prompt = `You are a Stripe GTM strategist. For each news article below, determine if there's a genuine Stripe product opportunity. If yes, write a short "Stripe Play" and match it to the best proof point from our success stories.

REGION: ${region}

STRIPE PRODUCTS AVAILABLE IN THIS REGION:
${productContext}

SUCCESS STORIES (for proof points):
${storiesContext}

ARTICLES:
${articlesContext}

For each article, respond with valid JSON array. Each element:
{
  "index": <article index number>,
  "has_play": true/false,
  "stripe_play": "<2-3 sentence actionable play connecting the news to a Stripe product. Include target persona and why now. Empty string if no play.>",
  "products": ["<product_id>", ...],
  "proof_point": "<One sentence referencing a success story that proves this works. Include the company name and metric. Empty string if no match.>",
  "proof_story_company": "<company name from success stories list, or empty>"
}

Rules:
- Only return has_play: true if the connection is GENUINE and actionable for an SDR.
- Do NOT force weak connections. If an article is about a CEO appointment or internal company drama with no payment/fintech angle, return has_play: false.
- Products must be from the available list and available in this region.
- Proof points should match by product AND ideally by industry/use case.
- Return ONLY the JSON array, no markdown fences.`;

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

      const { error: updateErr } = await supabase
        .from("articles")
        .update({
          stripe_play: play.stripe_play,
          stripe_products: play.products,
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
