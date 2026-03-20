/**
 * packages/terminal-ui/server.js
 *
 * Server-side proxy for Gemini API calls.
 *
 * WHY: Injecting the GEMINI_API_KEY in server-side code keeps it out of the
 * browser bundle entirely.  The client calls POST /api/gen and never sees
 * the key.
 *
 * SECURITY:
 *  - Origin validation: only origins listed in ALLOWED_ORIGINS are accepted.
 *  - Request body size is limited to 128 KB.
 *  - The upstream Gemini request has a 15-second AbortSignal timeout.
 *
 * ENV VARS:
 *  - GEMINI_API_KEY   (required) — your Gemini API key
 *  - ALLOWED_ORIGINS  (optional, comma-separated) — default: http://localhost:5173
 *  - PORT             (optional) — default: 3001
 */

import express from 'express';
import process from 'process';

const app = express();
app.use(express.json({ limit: '128kb' }));

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/* ── CORS + origin guard ──────────────────────────────────────────────────── */

app.use((req, res, next) => {
    const origin = req.headers.origin;

    // Validate origin when present (browser requests always send it).
    if (origin) {
        if (!ALLOWED_ORIGINS.includes(origin)) {
            res.status(403).json({ error: 'Origin not permitted' });
            return;
        }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }

    next();
});

/* ── POST /api/gen ────────────────────────────────────────────────────────── */

/**
 * Proxy a generateContent request to the Gemini API.
 *
 * Request body:
 *   { model?: string, contents: GeminiContent[] }
 *
 * The GEMINI_API_KEY is appended as a query parameter server-side and is
 * never included in any response to the client.
 */
app.post('/api/gen', async (req, res) => {
    if (!GEMINI_API_KEY) {
        res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
        return;
    }

    const { model = 'gemini-2.0-flash', contents } = req.body ?? {};

    if (!Array.isArray(contents) || contents.length === 0) {
        res.status(400).json({ error: 'contents must be a non-empty array.' });
        return;
    }

    try {
        const upstream = await fetch(
            `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Use a header so the API key is not logged in URLs or
                    // forwarded by intermediate proxies that record query strings.
                    'x-goog-api-key': GEMINI_API_KEY,
                },
                body: JSON.stringify({ contents }),
                // 15-second upstream timeout (server-side AbortSignal).
                signal: AbortSignal.timeout(15_000),
            },
        );

        const text = await upstream.text();
        res.status(upstream.status).set('Content-Type', 'application/json').send(text);
    } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            res.status(504).json({ error: 'Upstream Gemini request timed out.' });
            return;
        }
        res.status(500).json({ error: err.message });
    }
});

/* ── Start ────────────────────────────────────────────────────────────────── */

app.listen(PORT, () => {
    console.log(`[proxy] Gemini API proxy listening on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
        console.warn('[proxy] WARNING: GEMINI_API_KEY is not set — /api/gen will return 500.');
    }
});

export default app;
