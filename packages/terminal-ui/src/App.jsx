import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Eye, HardDrive, X, Activity, Cpu, Shield } from 'lucide-react';

/* ─── Constants ──────────────────────────────────────────────────────────── */

/** Maximum bytes allowed per VFS entry (prevents oversized / injected content). */
const MAX_VFS_BYTES = 10 * 1024;

/** Fetch timeout in milliseconds. */
const TIMEOUT_MS = 8_000;

/** Maximum number of retries for transient fetch errors. */
const MAX_RETRIES = 2;

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with retry and per-attempt AbortController timeout.
 *
 * On a timeout the AbortError is re-thrown as a `TimeoutError` so callers
 * can surface a distinct terminal message.  Transient HTTP/network failures
 * use exponential back-off up to `retries` attempts.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [retries]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init = {}, retries = MAX_RETRIES, timeoutMs = TIMEOUT_MS) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            clearTimeout(tid);
            if (!res.ok) {
                throw Object.assign(new Error(`HTTP ${res.status}: ${res.statusText}`), {
                    status: res.status,
                });
            }
            return res;
        } catch (err) {
            clearTimeout(tid);
            // Surface timeouts distinctly so the terminal can show a specific message.
            if (err.name === 'AbortError') {
                const te = new Error(`Request timed out after ${timeoutMs / 1000}s`);
                te.name = 'TimeoutError';
                throw te;
            }
            if (attempt === retries) throw err;
            // Exponential back-off: 500 ms, 1 000 ms, …
            await sleep(500 * 2 ** attempt);
        }
    }
}

/**
 * Validate a Gemini generateContent response and extract the text.
 *
 * Returns `null` when candidates, parts, or text are absent/malformed so
 * callers can emit a friendly error rather than crashing on `undefined`.
 *
 * @param {unknown} data
 * @returns {string|null}
 */
function extractGeminiText(data) {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) return null;
    return text.trim();
}

/**
 * Coerce `value` to a string and clamp it to `MAX_VFS_BYTES` characters to
 * prevent oversized or injected content in the virtual file system.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeVfsValue(value) {
    const s = String(value ?? '');
    return s.length > MAX_VFS_BYTES ? `${s.slice(0, MAX_VFS_BYTES)}…[truncated]` : s;
}

/* ─── ApprovalCard ───────────────────────────────────────────────────────── */

/**
 * Modal-style card for human-in-the-loop approval of agent tool calls.
 *
 * Accessibility:
 *  - `role="alertdialog"` with `aria-modal`, `aria-labelledby`, `aria-describedby`.
 *  - Focus moves to the first action button on mount.
 *  - All interactive elements respond to both click and Enter / Space key events.
 */
function ApprovalCard({ step, onApprove, onReject, onClose }) {
    const approveRef = useRef(null);

    // Move focus to the first action when the card appears.
    useEffect(() => {
        approveRef.current?.focus();
    }, []);

    /** Allow Enter or Space to activate any approval-card button. */
    function handleKeyDown(e, action) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
        }
    }

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`approval-title-${step.id}`}
            aria-describedby={`approval-desc-${step.id}`}
            style={{
                border: '1px solid #00ff88',
                borderRadius: 6,
                padding: '12px 16px',
                margin: '8px 0',
                background: '#0d1f18',
                position: 'relative',
            }}
        >
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                    id={`approval-title-${step.id}`}
                    style={{ color: '#00ff88', fontWeight: 'bold', fontSize: 14 }}
                >
                    ⚡ APPROVAL REQUIRED
                </span>
                {/* Close (X) button — keyboard-accessible via Enter / Space */}
                <button
                    aria-label="Dismiss approval card"
                    onClick={onClose}
                    onKeyDown={(e) => handleKeyDown(e, onClose)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#aaa',
                        cursor: 'pointer',
                        padding: '2px 6px',
                        lineHeight: 1,
                    }}
                >
                    <X size={14} />
                </button>
            </div>

            {/* Description */}
            <p
                id={`approval-desc-${step.id}`}
                style={{ color: '#ccc', margin: '8px 0', fontSize: 13 }}
            >
                {step.description}
            </p>

            {/* Command preview */}
            <code
                style={{
                    display: 'block',
                    color: '#fff',
                    background: '#111',
                    padding: '6px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    marginBottom: 10,
                    wordBreak: 'break-all',
                }}
            >
                {step.command}
            </code>

            {/* Action buttons — Enter / Space keyboard support */}
            <div style={{ display: 'flex', gap: 8 }}>
                <button
                    ref={approveRef}
                    onClick={onApprove}
                    onKeyDown={(e) => handleKeyDown(e, onApprove)}
                    style={{
                        background: '#004d28',
                        border: '1px solid #00ff88',
                        color: '#00ff88',
                        padding: '4px 14px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                    }}
                >
                    ✓ Approve
                </button>
                <button
                    onClick={onReject}
                    onKeyDown={(e) => handleKeyDown(e, onReject)}
                    style={{
                        background: '#3d0000',
                        border: '1px solid #ff4444',
                        color: '#ff4444',
                        padding: '4px 14px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                    }}
                >
                    ✗ Reject
                </button>
            </div>
        </div>
    );
}

/* ─── App ────────────────────────────────────────────────────────────────── */

const INITIAL_LINES = [
    '[SYS] PrivateClient.ai · agentic.js Runtime Initialized',
    '[SYS] Multi-Provider Bridge: Anthropic | OpenAI | Gemini: READY',
    '[SYS] Use /team to initialize multi-agent orchestration.',
];

const App = () => {
    const [command, setCommand] = useState('');
    const [lines, setLines] = useState(INITIAL_LINES);

    /**
     * `isFetching` — true only while the neural fetch call is in-flight.
     * `approvalQueue` — pending human-approval steps.
     *
     * `isProcessing` combines both: the orb / status indicator stays active
     * even after the fetch resolves if approvals are still outstanding.
     */
    const [isFetching, setIsFetching] = useState(false);
    const [approvalQueue, setApprovalQueue] = useState([]);
    const isProcessing = isFetching || approvalQueue.length > 0;

    const [activeTeam, setActiveTeam] = useState(null);
    const [vfs, setVfs] = useState({ '/sys/kernel': 'agentic.js_v1.2.0' });
    const [orbState, setOrbState] = useState('idle'); // idle | thinking | tool-call

    /** Command history for ↑/↓ navigation. */
    const [history, setHistory] = useState([]);
    const [historyIdx, setHistoryIdx] = useState(-1);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    /* ── Auto-scroll terminal ─────────────────────────────────────────────── */
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines, approvalQueue]);

    /* ── Keep orbState in sync with processing state ─────────────────────── */
    useEffect(() => {
        if (!isProcessing) setOrbState('idle');
    }, [isProcessing]);

    /* ── Helpers ──────────────────────────────────────────────────────────── */

    const pushLine = useCallback((...newLines) => {
        setLines((prev) => [...prev, ...newLines]);
    }, []);

    /**
     * Write a value to the VFS, enforcing the 10 KB size limit and coercing
     * to a plain string to prevent injected objects.
     */
    const vfsWrite = useCallback((path, value) => {
        setVfs((prev) => ({ ...prev, [path]: sanitizeVfsValue(value) }));
    }, []);

    /** Print VFS node contents to the terminal (Inspect action). */
    const inspectVfsNode = useCallback(
        (path) => {
            const content = vfs[path];
            if (content === undefined) {
                pushLine(`[VFS] ${path}: (not found)`);
            } else {
                pushLine(`[VFS:INSPECT] ${path}`, `  ${content}`);
            }
        },
        [vfs, pushLine],
    );

    /* ── Gemini call via /api/gen proxy ───────────────────────────────────── */

    /**
     * Sends a prompt to `/api/gen` (server-side proxy that injects the API
     * key).  Validates the response shape before returning text, emitting a
     * friendly error for malformed responses.
     */
    const callGemini = useCallback(async (prompt) => {
        const res = await fetchWithRetry('/api/gen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-2.0-flash',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            }),
        });
        const data = await res.json();
        const text = extractGeminiText(data);
        if (!text) {
            throw new Error('Malformed model response: missing candidates/parts/text');
        }
        return text;
    }, []);

    /* ── Approval queue ───────────────────────────────────────────────────── */

    /**
     * Enqueue a step requiring human approval.  Returns a Promise that
     * resolves to `true` (approved) or `false` (rejected / dismissed).
     * Each step gets a collision-resistant ID.  `crypto.randomUUID()` is
     * used when available (secure context); otherwise falls back to a
     * Math.random-based UUID v4 string for non-HTTPS dev environments.
     */
    const enqueueApproval = useCallback((step) => {
        return new Promise((resolve) => {
            const id =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                          const r = (Math.random() * 16) | 0;
                          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                      });
            setApprovalQueue((q) => [...q, { ...step, id, resolve }]);
        });
    }, []);

    const resolveApproval = useCallback((id, value) => {
        setApprovalQueue((q) => {
            const item = q.find((s) => s.id === id);
            item?.resolve(value);
            return q.filter((s) => s.id !== id);
        });
    }, []);

    /* ── Agentic task runner ──────────────────────────────────────────────── */

    const runAgenticTask = useCallback(
        async (input) => {
            setIsFetching(true);
            setOrbState('thinking');
            try {
                // Step 1: Planning
                pushLine(`[PLANNER] Analyzing task: "${input}"`);
                await sleep(800);

                // Step 2: Tool discovery
                pushLine('[TOOLSET] Loading LangChain-compatible tools…');
                pushLine('[TOOLSET] Found: [TavilySearch, VFSWriter, GPSSensor]');
                await sleep(600);

                // Step 3: Approval gate before tool execution
                setOrbState('tool-call');
                const logKey = `/logs/task_${Date.now()}`;
                const approved = await enqueueApproval({
                    label: 'VFSWriter Tool Call',
                    description: 'Agent "Hermes" wants to write task output to the virtual file system.',
                    command: `VFSWriter.write("${logKey}", <task_output>)`,
                });

                if (!approved) {
                    pushLine('[EXEC] Tool call rejected by user.');
                    return;
                }

                pushLine("[EXEC] Agent 'Hermes' invoking VFSWriter…");

                // Step 4: Query Gemini via server-side proxy
                let aiText = null;
                try {
                    pushLine('[NET] Querying Gemini via /api/gen…');
                    aiText = await callGemini(input);
                    pushLine(`[AI] ${aiText.length > 200 ? `${aiText.slice(0, 200)}…` : aiText}`);
                } catch (err) {
                    if (err.name === 'TimeoutError') {
                        pushLine(
                            `[NET] ⏱ Request timed out — no response from Gemini after ${TIMEOUT_MS / 1000}s.`,
                        );
                    } else {
                        pushLine(`[NET] ⚠ Gemini call failed: ${err.message}`);
                    }
                    // Continue — commit whatever we have (the original input) to VFS.
                }

                // Step 5: VFS write (sanitized, max 10 KB)
                vfsWrite(logKey, aiText ?? input);

                pushLine('[RESULT] Task committed to sovereign ledger.');
                pushLine('[DONE] Agentic loop completed.');
            } catch (err) {
                pushLine(`[ERROR] Unexpected failure: ${err.message}`);
            } finally {
                setIsFetching(false);
                // orbState resets to 'idle' via the useEffect once approvalQueue also drains.
            }
        },
        [pushLine, callGemini, enqueueApproval, vfsWrite],
    );

    /* ── Input / keyboard handling ────────────────────────────────────────── */

    /**
     * Handle command input keypresses.
     *   - ↑ / ↓ navigate command history even when `isFetching` is true.
     *   - Enter submits the command.
     */
    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHistoryIdx((i) => {
                    const next = Math.min(i + 1, history.length - 1);
                    setCommand(history[next] ?? '');
                    return next;
                });
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHistoryIdx((i) => {
                    const next = Math.max(i - 1, -1);
                    setCommand(next === -1 ? '' : (history[next] ?? ''));
                    return next;
                });
                return;
            }
            if (e.key !== 'Enter' || !command.trim()) return;
            const cmd = command.trim();
            pushLine(`> ${cmd}`);
            setCommand('');
            setHistory((h) => [cmd, ...h]);
            setHistoryIdx(-1);
            runAgenticTask(cmd);
        },
        [command, history, pushLine, runAgenticTask],
    );

    /**
     * Window-level keydown listener:  if the user presses ↑/↓ while the
     * input is disabled (fetch in-flight) and focus is outside the input,
     * redirect focus to it so history navigation stays reachable.
     */
    useEffect(() => {
        const onWindowKey = (e) => {
            if (isFetching && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                if (document.activeElement !== inputRef.current) {
                    inputRef.current?.focus();
                }
            }
        };
        window.addEventListener('keydown', onWindowKey);
        return () => window.removeEventListener('keydown', onWindowKey);
    }, [isFetching]);

    /* ─── Render ──────────────────────────────────────────────────────────── */

    return (
        <div
            style={{
                background: '#0a0f0e',
                color: '#00ff88',
                fontFamily: "'Cascadia Code', 'Fira Code', 'Courier New', monospace",
                minHeight: '100vh',
                padding: 24,
                maxWidth: 900,
                margin: '0 auto',
            }}
        >
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 16,
                    borderBottom: '1px solid #1a3a2a',
                    paddingBottom: 12,
                }}
            >
                <Terminal size={22} color="#00ff88" aria-hidden="true" />
                <span style={{ fontSize: 17, fontWeight: 'bold', letterSpacing: 1 }}>
                    agentic.js Terminal
                </span>

                {/* Orb / status indicator */}
                <div
                    style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                    aria-live="polite"
                    aria-label={`Status: ${isProcessing ? 'processing' : 'ready'}`}
                >
                    <Activity
                        size={14}
                        color={isProcessing ? '#ffaa00' : '#00ff88'}
                        aria-hidden="true"
                        style={{ animation: isProcessing ? 'pulse 1s infinite' : 'none' }}
                    />
                    <span style={{ color: isProcessing ? '#ffaa00' : '#00ff88' }}>
                        {orbState === 'thinking'
                            ? 'Thinking…'
                            : orbState === 'tool-call'
                              ? 'Tool call pending'
                              : isProcessing
                                ? 'Processing'
                                : 'Ready'}
                    </span>
                    {approvalQueue.length > 0 && (
                        <span
                            style={{
                                background: '#ff8800',
                                color: '#000',
                                borderRadius: 10,
                                padding: '1px 7px',
                                fontSize: 11,
                                fontWeight: 'bold',
                            }}
                            aria-label={`${approvalQueue.length} pending approval${approvalQueue.length > 1 ? 's' : ''}`}
                        >
                            {approvalQueue.length} approval{approvalQueue.length > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Terminal output ──────────────────────────────────────────── */}
            <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                aria-label="Terminal output"
                style={{
                    background: '#050a08',
                    border: '1px solid #1a3a2a',
                    borderRadius: 8,
                    padding: 16,
                    height: 340,
                    overflowY: 'auto',
                    fontSize: 13,
                    lineHeight: 1.7,
                    marginBottom: 12,
                }}
            >
                {lines.map((line, i) => (
                    <div
                        key={i}
                        style={{
                            color: line.startsWith('[ERROR]')
                                ? '#ff4444'
                                : line.startsWith('[NET] ⏱')
                                  ? '#ffaa00'
                                  : line.startsWith('[NET]')
                                    ? '#88aaff'
                                    : line.startsWith('[AI]')
                                      ? '#aaffcc'
                                      : line.startsWith('[VFS')
                                        ? '#ffe066'
                                        : line.startsWith('>')
                                          ? '#ffffff'
                                          : '#00cc66',
                        }}
                    >
                        {line}
                    </div>
                ))}
            </div>

            {/* ── Approval cards ───────────────────────────────────────────── */}
            {approvalQueue.map((step) => (
                <ApprovalCard
                    key={step.id}
                    step={step}
                    onApprove={() => resolveApproval(step.id, true)}
                    onReject={() => resolveApproval(step.id, false)}
                    onClose={() => resolveApproval(step.id, false)}
                />
            ))}

            {/* ── Command input ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
                <span style={{ color: '#00ff88', fontSize: 15 }} aria-hidden="true">
                    {'›'}
                </span>
                <input
                    ref={inputRef}
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isFetching ? 'Processing… (↑/↓ for history)' : 'Enter command…'}
                    disabled={isFetching}
                    aria-label="Terminal command input"
                    aria-disabled={isFetching}
                    style={{
                        flex: 1,
                        background: isFetching ? '#111' : '#050a08',
                        border: '1px solid #1a3a2a',
                        color: '#00ff88',
                        padding: '8px 12px',
                        borderRadius: 4,
                        fontFamily: 'inherit',
                        fontSize: 13,
                        outline: 'none',
                        cursor: isFetching ? 'not-allowed' : 'text',
                        opacity: isFetching ? 0.6 : 1,
                    }}
                />
            </div>

            {/* ── Virtual File System viewer ────────────────────────────────── */}
            <div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                        color: '#88aaff',
                        fontSize: 13,
                    }}
                >
                    <HardDrive size={14} aria-hidden="true" />
                    <span>Virtual File System</span>
                </div>
                <div
                    style={{
                        background: '#050a08',
                        border: '1px solid #1a3a2a',
                        borderRadius: 6,
                        padding: 12,
                        fontSize: 12,
                    }}
                    role="region"
                    aria-label="Virtual file system"
                >
                    {Object.keys(vfs).length === 0 ? (
                        <span style={{ color: '#555' }}>(empty)</span>
                    ) : (
                        Object.entries(vfs).map(([path, value]) => (
                            <div
                                key={path}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    marginBottom: 6,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <span style={{ color: '#00cc66', minWidth: 180 }}>{path}</span>

                                {/* Inspect button — prints VFS node contents to the terminal */}
                                <button
                                    onClick={() => inspectVfsNode(path)}
                                    aria-label={`Inspect VFS node ${path}`}
                                    title={`Inspect ${path}`}
                                    style={{
                                        background: 'none',
                                        border: '1px solid #1a3a2a',
                                        color: '#88aaff',
                                        padding: '2px 8px',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                        fontSize: 11,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                    }}
                                >
                                    <Eye size={11} aria-hidden="true" />
                                    Inspect
                                </button>

                                {/* Truncated preview */}
                                <span
                                    style={{
                                        color: '#555',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        maxWidth: 280,
                                    }}
                                    title={value}
                                >
                                    {value.length > 60 ? `${value.slice(0, 60)}…` : value}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Pulse animation keyframes (inline for zero-dep styling) */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50%       { opacity: 0.4; }
                }
            `}</style>
        </div>
    );
};

export default App;
