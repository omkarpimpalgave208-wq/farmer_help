// api/analyze-crop.js — Vercel Serverless Function
// Calls Google Gemini 2.0 Flash (vision) to analyze a crop image.
// The API key is read from process.env.GEMINI_API_KEY and never exposed to the browser.
//
// Verified model: gemini-2.0-flash
// Free-tier limits (as of 2025): 15 RPM / 1,500 RPD / 1,000,000 TPM
// Source: https://ai.google.dev/gemini-api/docs/models

'use strict';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Maximum base64 payload accepted (8 MB decoded ≈ ~10.7 MB base64 string)
const MAX_B64_CHARS = 11_000_000;

// Allowed MIME types — server-side re-validation independent of the client
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Prompt that instructs Gemini to return structured JSON only
const ANALYSIS_PROMPT = `You are an expert agricultural image analyst. Analyze the crop image provided and return ONLY a valid JSON object — no markdown, no prose, no code fences.

Return this exact structure (fill every field honestly based only on what is visible):

{
  "cropIdentification": {
    "mostLikelyCrop": "<crop name or 'Unknown'>",
    "alternatives": ["<alt1>", "<alt2>"],
    "uncertaintyLevel": "<low|moderate|high>",
    "visibleFeatures": ["<feature1>", "<feature2>"]
  },
  "visibleCondition": {
    "ripenessStage": "<unripe|nearly ripe|ripe|overripe|cannot assess>",
    "colorAndTexture": "<one concise sentence>",
    "damageOrDiseaseSymptoms": "<none visible|describe what you see>",
    "photoLimitations": "<list any limitations: blurry, single angle, poor lighting, etc.>"
  },
  "suggestedNextSteps": ["<step1>", "<step2>"],
  "decisionSummary": {
    "recommendedAction": "<sell|store|process|wait|redirect|insufficient data>",
    "reasoning": "<one or two sentences using only visible evidence>",
    "risks": ["<risk1>", "<risk2>"],
    "missingInformation": ["<item1>", "<item2>"]
  },
  "imageQuality": "<good|acceptable|poor — brief reason>"
}

Rules you must follow:
- If the image does not clearly show a crop or agricultural produce, set mostLikelyCrop to "Not a crop image" and explain in imageQuality.
- Do NOT infer exact prices, weights, shelf life in days, or pesticide requirements from the image.
- Do NOT diagnose a disease definitively. Say "visible symptoms consistent with X; expert verification recommended."
- Do NOT fabricate data. If something cannot be determined from the image, say so explicitly.
- Return only the JSON object. Any extra text will break the parser.`;

module.exports = async function handler(req, res) {
  // Only POST is accepted
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Check API key is configured before doing any work
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_gemini_api_key_here') {
    return res.status(200).json({
      configured: false,
      error: 'GEMINI_API_KEY is not configured on this server. Image analysis is unavailable until the key is added to environment variables.'
    });
  }

  // Parse body — Vercel provides the raw body; we expect JSON
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }

  const { imageBase64, mimeType } = body || {};

  // Server-side MIME re-validation (do not trust the client alone)
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG, or WebP.' });
  }

  // Server-side size re-validation
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 field is required.' });
  }
  if (imageBase64.length > MAX_B64_CHARS) {
    return res.status(413).json({ error: 'Image exceeds the 8 MB server limit.' });
  }

  // Build the Gemini request payload
  const geminiPayload = {
    contents: [
      {
        parts: [
          { text: ANALYSIS_PROMPT },
          {
            inlineData: {
              mimeType,
              data: imageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,      // low temperature for consistent structured output
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };

  // Call Gemini with a 25-second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  let geminiResponse;
  try {
    geminiResponse = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === 'AbortError') {
      return res.status(504).json({ error: 'The image analysis request timed out (25 s). Please try again.' });
    }
    return res.status(502).json({ error: 'Network error reaching the Gemini API. Please try again.' });
  } finally {
    clearTimeout(timeout);
  }

  // Handle Gemini error status codes
  if (!geminiResponse.ok) {
    let errorBody;
    try { errorBody = await geminiResponse.json(); } catch { errorBody = {}; }
    const status = geminiResponse.status;
    const geminiMsg = errorBody?.error?.message || 'Unknown Gemini API error.';

    if (status === 429) {
      return res.status(429).json({ error: `Rate limit reached (free tier: 15 requests/min, 1,500/day). Please wait a moment and try again. Gemini: ${geminiMsg}` });
    }
    if (status === 400) {
      return res.status(400).json({ error: `Gemini rejected the request: ${geminiMsg}` });
    }
    if (status === 403) {
      return res.status(403).json({ error: 'Gemini API key is invalid or lacks permission. Check your GEMINI_API_KEY.' });
    }
    return res.status(502).json({ error: `Gemini API error ${status}: ${geminiMsg}` });
  }

  // Parse Gemini response
  let geminiData;
  try {
    geminiData = await geminiResponse.json();
  } catch {
    return res.status(502).json({ error: 'Gemini returned an unparseable response.' });
  }

  // Extract the text content from Gemini's candidates array
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    // Check for content filtering
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    if (finishReason === 'SAFETY') {
      return res.status(422).json({ error: 'The image was blocked by Gemini content filters. Please use a clear photo of agricultural produce.' });
    }
    return res.status(502).json({ error: 'Gemini returned an empty response. The image may be unclear or unsupported.' });
  }

  // Parse the structured JSON from Gemini's text output
  let report;
  try {
    // Strip any accidental markdown fences Gemini might add despite instructions
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    report = JSON.parse(cleaned);
  } catch {
    // Return the raw text so the client can show a graceful degradation message
    return res.status(422).json({
      error: 'Gemini returned a response that could not be parsed as structured JSON. The raw response is included for debugging.',
      rawResponse: rawText.slice(0, 500) // limit exposure
    });
  }

  // Validate minimum required fields to catch hallucinated structures
  if (!report.cropIdentification || !report.visibleCondition || !report.decisionSummary) {
    return res.status(422).json({ error: 'Gemini response was missing required report sections. Please try again.' });
  }

  // Success — return the normalized report
  return res.status(200).json({
    configured: true,
    model: GEMINI_MODEL,
    analysedAt: new Date().toISOString(),
    report
  });
};
