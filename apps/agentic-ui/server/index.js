/**
 * Agentic.js — Express proxy server
 *
 * Reads GEMINI_API_KEY from the environment and exposes a single endpoint:
 *   POST /api/model  { prompt: string }
 *
 * The client NEVER receives or touches the API key.
 */

import express from 'express';
import cors from 'cors';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '64kb' }));

// Allow Vite dev server to proxy here; in production serve from same origin
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173' }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Model proxy  POST /api/model
// ---------------------------------------------------------------------------
app.post('/api/model', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  const { prompt } = req.body ?? {};
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'prompt must be a non-empty string.' });
  }

  // Clamp prompt size
  const safePrompt = prompt.slice(0, 8000);

  const geminiUrl =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const body = JSON.stringify({
    contents: [{ parts: [{ text: safePrompt }] }],
  });

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 25_000);

  try {
    const upstream = await fetch(geminiUrl, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-goog-api-key':  apiKey,
      },
      body,
      signal:  controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      console.error('[proxy] Gemini error:', upstream.status, errBody.slice(0, 300));

      // Surface auth/quota errors clearly (do not expose raw API key info)
      if (upstream.status === 400) return res.status(400).json({ error: 'Invalid request sent to model API.' });
      if (upstream.status === 401 || upstream.status === 403)
        return res.status(502).json({ error: 'Model API authentication failed. Check GEMINI_API_KEY.' });
      if (upstream.status === 429)
        return res.status(429).json({ error: 'Model API rate limit exceeded. Please wait and retry.' });

      return res.status(502).json({ error: `Model API returned HTTP ${upstream.status}.` });
    }

    const data = await upstream.json().catch(() => null);

    // Extract text from Gemini response structure
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.output ??
      null;

    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(502).json({ error: 'Model returned an empty or unrecognised response.' });
    }

    return res.json({ text });
  } catch (err) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Request to model API timed out.' });
    }
    console.error('[proxy] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal proxy error. See server logs.' });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[agentic-ui] proxy listening on http://localhost:${PORT}`);
});
