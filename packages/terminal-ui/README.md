# Agentic.js Terminal UI

React V20 terminal UI for the agentic.js runtime with a secure server-side
Gemini API proxy.

## Features

| Area | What was implemented |
|---|---|
| **Secure API calls** | `GEMINI_API_KEY` is injected server-side in `server.js`; the key is never exposed in the browser bundle. |
| **Fetch reliability** | `fetchWithRetry` distinguishes `TimeoutError` (AbortError) from HTTP errors and surfaces a dedicated terminal line for timeouts; exponential back-off for transient failures. |
| **Response validation** | `extractGeminiText` checks `candidates / parts / text` before returning; emits a friendly error when the shape is missing or malformed. |
| **Approval queue** | `isProcessing` stays `true` while outstanding approvals exist even after the neural fetch completes. Each approval step uses `crypto.randomUUID()` for collision-free IDs. |
| **Accessibility** | `ApprovalCard` uses `role="alertdialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, and moves focus to the first action button on mount. Every button (including the close ✕) responds to **Enter** and **Space** key events. History navigation (↑/↓) works while the input is disabled via a window-level listener. |
| **Data safety** | VFS writes are sanitised with `sanitizeVfsValue`: coerced to `string`, clamped to 10 KB. |
| **UX** | Each VFS node has an **Inspect** button that prints its contents to the terminal. |

---

## Setup

### 1. Install dependencies

```bash
cd packages/terminal-ui
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Open .env and replace the placeholder with your real Gemini API key.
```

`.env` is listed in `.gitignore` — never commit a file containing real secrets.

### 3. Start

Open **two** terminals:

```bash
# Terminal 1 — proxy server (port 3001)
pnpm dev:server

# Terminal 2 — Vite dev server (port 5173)
pnpm dev:ui
```

Then open <http://localhost:5173>.

---

## Proxy endpoint

### `POST /api/gen`

Proxies a `generateContent` request to the Gemini API, injecting
`GEMINI_API_KEY` from the server environment.  The key is **never** sent to
the client.

**Request body**

```json
{
  "model": "gemini-2.0-flash",
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello, Gemini!" }] }
  ]
}
```

`model` is optional and defaults to `gemini-2.0-flash`.

**Responses**

| Status | Meaning |
|---|---|
| `200` | Gemini response forwarded as-is |
| `400` | `contents` is missing or empty |
| `403` | Request origin is not in `ALLOWED_ORIGINS` |
| `500` | `GEMINI_API_KEY` not configured |
| `504` | Upstream Gemini request timed out |

> **Note:** The proxy sends the API key via the `x-goog-api-key` request header
> (not in the URL) to avoid it appearing in server access logs or proxy logs.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | — | Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:5173` | Comma-separated list of permitted origins |
| `PORT` | ❌ | `3001` | Port the proxy server listens on |

---

## Build for production

```bash
pnpm build
```

The static assets are output to `dist/`.  In production, run the Express
proxy on a server and set `ALLOWED_ORIGINS` to your deployed frontend URL.
