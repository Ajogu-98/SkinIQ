import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a world-class skincare chemist and dermatology safety expert. Your job is to analyze skincare ingredient lists and provide accurate, science-backed safety assessments.

For every ingredient found, provide a thorough JSON analysis. Use the following safety tiers:
- "safe": well-tolerated, low concern, backed by strong safety data
- "caution": use with care — may irritate sensitive skin, potential sensitizer, some conflicting evidence, or requires certain precautions (e.g. use SPF)
- "flag": significant concern — known allergen, endocrine disruptor, banned in major regions (EU/UK/Japan), carcinogen, or strong irritant

Return ONLY a valid JSON object — no markdown, no explanation, no code fences. Structure:
{
  "productName": "string or null",
  "extractedIngredientText": "the raw ingredient list as extracted",
  "ingredients": [
    {
      "name": "common name (string)",
      "inci": "INCI / scientific name (string)",
      "safety": "safe | caution | flag",
      "category": ["array of categories e.g. Humectant, Preservative, Sunscreen, Fragrance, Emollient, Exfoliant, Antioxidant, Retinoid, Surfactant, Emulsifier, Colorant, Occlusive, Anti-acne, Brightener, Soothing, Anti-aging, Vitamin, Mineral"],
      "description": "2–3 sentence explanation of what this ingredient is and what it does in skincare",
      "benefits": ["array of specific benefits"],
      "concerns": ["array of specific concerns, or empty array if none"],
      "comedogenic": 0,
      "pregnancySafe": true,
      "bannedRegions": ["array of regions where restricted/banned e.g. EU, UK, Japan, Hawaii, California"],
      "ewgScore": 1
    }
  ],
  "summary": {
    "overallSafety": "safe | caution | flag",
    "safeCount": 0,
    "cautionCount": 0,
    "flagCount": 0,
    "topConcerns": ["top 2-3 concerns as short strings"],
    "skinTypeNotes": "1–2 sentences about suitability across skin types",
    "pregnancyNote": "1 sentence about pregnancy safety"
  }
}

comedogenic scale: 0 = won't clog pores, 5 = highly comedogenic
ewgScore: 1 (low hazard) to 10 (high hazard) per EWG Skin Deep database norms
pregnancySafe: true / false / null (if unknown)`;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { mode, content, mimeType } = body;

  if (!mode || !content) {
    return new Response(JSON.stringify({ error: "Missing required fields: mode, content" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey });

  let messages = [];

  if (mode === "image") {
    messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType || "image/jpeg",
              data: content,
            },
          },
          {
            type: "text",
            text: `Extract the complete ingredient list from this product label image. 
Then analyze EVERY ingredient found for safety, benefits, and concerns.
If you can identify the product name/brand, include it.
Return the full structured JSON analysis as specified.`,
          },
        ],
      },
    ];
  } else if (mode === "product") {
    messages = [
      {
        role: "user",
        content: `Analyze this skincare product: "${content}"

If you recognize this as a specific product (e.g. "CeraVe Moisturizing Cream"), use its known ingredient list.
If it's a product type (e.g. "basic moisturizer"), analyze typical ingredients for that category.
Set "productName" to the product name if identifiable.
Return the full structured JSON analysis.`,
      },
    ];
  } else {
    // mode === "text"
    messages = [
      {
        role: "user",
        content: `Analyze this skincare input: "${content}"

IMPORTANT:
- If this looks like a product name or brand (e.g. "The Ordinary Niacinamide 10%"), identify it and use its known ingredient list. Set "productName" accordingly.
- If this is already an ingredient list (separated by commas, newlines, slashes, or bullets), parse and analyze those exact ingredients. Set "productName" to null.

Analyze EVERY ingredient found and return the full structured JSON analysis.`,
      },
    ];
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
    });

    const rawText = response.content[0].text;

    // Parse JSON — strip any accidental markdown fences
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not extract JSON from Claude response");
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(analysis), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Analysis error:", err);
    return new Response(
      JSON.stringify({ error: "Analysis failed", details: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const config = {
  path: "/api/analyze",
};
