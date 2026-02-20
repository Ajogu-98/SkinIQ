exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in environment variables' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { mode, content, mimeType } = body;
  if (!mode || !content) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing mode or content' }) };
  }

  // Build message content
  let userMessage;
  if (mode === 'image') {
    userMessage = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: content }
      },
      {
        type: 'text',
        text: 'Please read the ingredient list from this skincare product label image and analyze each ingredient. Extract all ingredients you can see, then analyze them.'
      }
    ];
  } else {
    const isProductName = content.trim().split(/[\n,]/).length <= 3 && content.trim().length < 80;
    userMessage = isProductName
      ? `Analyze the ingredients in this skincare product: "${content}". If you know this product, list and analyze its ingredients.`
      : `Analyze these skincare ingredients:\n\n${content}`;
  }

  const systemPrompt = `You are an expert skincare chemist and ingredient safety analyst. Analyze skincare ingredients and return ONLY a valid JSON object with no extra text, markdown, or code blocks.

Return this exact JSON structure:
{
  "productName": "string or null",
  "extractedIngredientText": "raw ingredient list as string",
  "ingredients": [
    {
      "name": "Common name",
      "inci": "INCI/scientific name",
      "safety": "safe|caution|flag",
      "category": ["array", "of", "categories"],
      "description": "Brief description of what this ingredient is and does",
      "benefits": ["benefit 1", "benefit 2"],
      "concerns": ["concern 1", "concern 2"],
      "comedogenic": 0,
      "pregnancySafe": true,
      "bannedRegions": [],
      "ewgScore": 1
    }
  ],
  "summary": {
    "overallSafety": "safe|caution|flag",
    "safeCount": 0,
    "cautionCount": 0,
    "flagCount": 0,
    "topConcerns": ["concern 1", "concern 2"],
    "skinTypeNotes": "Notes about which skin types this is suitable for",
    "pregnancyNote": "Overall pregnancy safety note"
  }
}

Safety ratings:
- safe: Generally recognized as safe, well-studied
- caution: Some concerns, use with awareness (e.g. retinol, acids, fragrance)
- flag: Known irritants, allergens, banned in some regions, or controversial (e.g. parabens, oxybenzone, formaldehyde releasers)

comedogenic: 0-5 scale (0=non-comedogenic, 5=highly comedogenic)
ewgScore: 1-10 (1=safest, 10=highest concern)
pregnancySafe: true, false, or null if unknown

Return ONLY the JSON. No explanation, no markdown, no code fences.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: 500, body: JSON.stringify({ error: `Anthropic API error: ${err}` }) };
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    // Strip any accidental markdown code fences
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to parse AI response as JSON', raw: clean.slice(0, 500) }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
