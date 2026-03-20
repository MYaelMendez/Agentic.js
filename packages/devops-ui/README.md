# `@agentic/devops-ui` — DevOps Edge Node UI

A DevOps-focused agentic dashboard built with React + Vite.  
It connects to an AI model through a **server-side proxy** so the API key is
never exposed in the browser.

---

## Layout

| Panel | Purpose |
|---|---|
| **Left** | Telemetry / incident feed (sys events, errors, verification results) |
| **Center** | Diagnosis / proposal workspace + command input |
| **Right** | VFS / system-state file browser |
| **Drawer** | Approval gate for deployment operations |

**Workflow stages:** `Observe → Diagnose → Propose → Approve → Execute → Verify`

---

## Quick Start

### 1. Install dependencies

```bash
# from the repo root
pnpm install
```

Or inside this package:

```bash
cd packages/devops-ui
pnpm install
```

### 2. Set environment variables

Copy the example file and fill in your key:

```bash
cp packages/devops-ui/.env.example packages/devops-ui/.env
```

`.env.example`:
```
# Required – never commit the real key
GEMINI_API_KEY=your-google-ai-api-key-here

# Optional
GEMINI_MODEL=gemini-2.0-flash
PORT=3001
```

> **Important:** The `.env` file is in `.gitignore` and must not be committed.

### 3. Run in development

```bash
cd packages/devops-ui
pnpm dev
```

This starts two processes concurrently:
- **Vite dev server** on `http://localhost:5173`
- **Proxy server** on `http://localhost:3001`

Vite proxies `/api/*` requests to the proxy server, so the frontend always
calls `/api/proxy` and never talks directly to Gemini.

### 4. Build for production

```bash
pnpm build          # outputs to dist/
pnpm start          # runs the proxy server (serve dist/ separately or from a CDN)
```

---

## How the proxy works

```
Browser → POST /api/proxy → proxy (server/index.js) → Gemini API
                                ↑
                        GEMINI_API_KEY read here
                        (never in browser bundle)
```

1. The browser sends the Gemini request body to `POST /api/proxy`.
2. `server/index.js` reads `GEMINI_API_KEY` from the process environment and
   passes it as the `x-goog-api-key` request header to Gemini (never in the
   URL, to keep it out of server access logs).
3. The response is forwarded back to the browser as-is.
4. If the key is missing the proxy returns **503** immediately.

### Timeout & retry behaviour

| Layer | Behaviour |
|---|---|
| **Browser** | 20 s hard timeout; retries up to 2× on 5xx/network errors with exponential back-off |
| **Browser** | No retry on 4xx (auth / validation / rate-limit failures) |
| **Proxy** | 25 s upstream timeout; returns 504 on timeout, 502 on connection failure |

---

## Approval flow

Deployment operations proposed by the agent enter an **approval queue**.
- Each approval item carries `risk` and `rollback` metadata displayed in the drawer.
- Navigation arrows cycle through pending items without consuming them.
- **Authorize** / **Deny** operates on the _currently displayed_ item only.
- After an item is processed the queue index is clamped to remain valid.
- After a deployment is authorized a **verification stage** runs automatically.
  If verification fails, a rollback recommendation is surfaced.

---

## VFS safety

- Paths must be non-empty absolute strings (`/foo/bar.js`) — invalid paths are
  rejected before queuing.
- File content is clamped to 64 KB for preview/write; larger payloads are
  truncated with a `[truncated]` marker.
- The file inspector guards against inspecting a file that has been removed
  from the VFS.

---

## Accessibility

- Approval drawer and file inspector both carry `role="dialog"` and
  `aria-modal="true"`.
- Press **Escape** to close the file inspector.
- Clicking the inspector backdrop also closes it.
- Empty command submissions are ignored.
