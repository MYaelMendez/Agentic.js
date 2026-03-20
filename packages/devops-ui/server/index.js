/**
 * Agentic DevOps Node – Server-side model proxy
 *
 * Reads GEMINI_API_KEY from environment variables and forwards model requests
 * to the Gemini API. The API key is never exposed to the browser.
 *
 * Environment variables:
 *   GEMINI_API_KEY   (required) – your Google AI / Gemini API key
 *   GEMINI_MODEL     (optional, default: gemini-2.0-flash)
 *   PORT             (optional, default: 3001)
 */

import express from 'express';
import { createServer } from 'node:http';

const app = express();

// Parse JSON bodies up to 2 MB
app.use(express.json({ limit: '2mb' }));

// Reject payloads that are not JSON
app.use('/api/proxy', (req, _res, next) => {
  const ct = req.headers['content-type'] ?? '';
  if (req.method === 'POST' && !ct.includes('application/json')) {
    return _res.status(415).json({ error: 'Content-Type must be application/json.' });
  }
  next();
});

const UPSTREAM_TIMEOUT_MS = 25_000;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

/**
 * POST /api/proxy
 * Forwards the request body to the Gemini generateContent endpoint.
 */
app.post('/api/proxy', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured on the server. Set it as an environment variable.',
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes;
  try {
    upstreamRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send the key in a request header instead of the URL to keep it
        // out of server access logs and any intermediate proxy logs.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream Gemini request timed out after 25 s.' });
    }
    console.error('[proxy] fetch error:', err.message);
    return res.status(502).json({ error: `Upstream connection failed: ${err.message}` });
  }

  clearTimeout(timer);

  let body;
  try {
    body = await upstreamRes.json();
  } catch {
    return res.status(502).json({ error: 'Upstream returned non-JSON response.' });
  }

  return res.status(upstreamRes.status).json(body);
});

// Health check (useful for orchestrators / load balancers)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL });
});

// Catch-all 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

const PORT = Number(process.env.PORT ?? 3001);
const server = createServer(app);
server.listen(PORT, () => {
  console.log(`[proxy] Agentic DevOps proxy server listening on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[proxy] WARNING: GEMINI_API_KEY is not set. /api/proxy will return 503.');
  }
});

export default app;
