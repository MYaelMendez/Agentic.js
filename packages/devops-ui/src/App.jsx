import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Shield, Cpu, Activity, Zap,
  AlertTriangle,
  FileText, Code,
  ChevronLeft, ChevronRight, Eye, X, Check,
  AlertCircle, CheckCircle2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_CONTENT_PREVIEW_BYTES = 64 * 1024; // 64 KB
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 800;
const REQUEST_TIMEOUT_MS = 20_000;

// Non-retriable HTTP status codes (auth / client validation failures)
const NON_RETRIABLE_STATUS = new Set([400, 401, 403, 404, 422, 429]);

// ---------------------------------------------------------------------------
// ID utility – uses crypto.randomUUID when available, falls back to Date/Math
// ---------------------------------------------------------------------------
function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Helper: resilient fetch with timeout and bounded retry
// ---------------------------------------------------------------------------
async function fetchWithTimeoutRetry(url, options, retriesLeft = MAX_RETRIES, backoff = RETRY_BACKOFF_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timerId);
  } catch (err) {
    clearTimeout(timerId);
    if (err.name === 'AbortError') throw new Error('Request timed out after 20 s.');
    // Network error – retry if attempts remain
    if (retriesLeft > 0) {
      await sleep(backoff);
      return fetchWithTimeoutRetry(url, options, retriesLeft - 1, backoff * 2);
    }
    throw err;
  }

  // Do NOT retry non-retriable client errors
  if (NON_RETRIABLE_STATUS.has(response.status)) {
    const body = await safeJson(response);
    const err = new Error(body?.error ?? `HTTP ${response.status}`);
    err.status = response.status;
    err.retriable = false;
    throw err;
  }

  if (!response.ok) {
    if (retriesLeft > 0) {
      await sleep(backoff);
      return fetchWithTimeoutRetry(url, options, retriesLeft - 1, backoff * 2);
    }
    const body = await safeJson(response);
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }

  return safeJson(response);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// VFS helpers
// ---------------------------------------------------------------------------
function isValidPath(p) {
  return typeof p === 'string' && p.trim().length > 0 && p.startsWith('/');
}

function clampContent(content) {
  if (typeof content !== 'string') return String(content ?? '');
  return content.length > MAX_CONTENT_PREVIEW_BYTES
    ? content.slice(0, MAX_CONTENT_PREVIEW_BYTES) + '\n…[truncated]'
    : content;
}

// ---------------------------------------------------------------------------
// Colour/style helpers
// ---------------------------------------------------------------------------
const WORKFLOW_STAGES = ['Observe', 'Diagnose', 'Propose', 'Approve', 'Execute', 'Verify'];

const RISK_COLOURS = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };

function riskColour(level) {
  return RISK_COLOURS[level?.toLowerCase()] ?? '#94a3b8';
}

// ---------------------------------------------------------------------------
// Block renderer
// ---------------------------------------------------------------------------
function Block({ block }) {
  switch (block.type) {
    case 'sys':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 12px', borderLeft: '2px solid rgba(255,255,255,0.06)', marginLeft: 4 }}>
          <Zap size={10} color="#06b6d4" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 900, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            {block.content}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace' }}>{block.timestamp}</span>
        </div>
      );

    case 'user':
      return (
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
          {block.content}
        </h2>
      );

    case 'agent':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7 }}>{block.content}</p>
          {block.thought && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
              Trace: {block.thought}
            </div>
          )}
        </div>
      );

    case 'verify':
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: block.ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${block.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: 12 }}>
          {block.ok
            ? <CheckCircle2 size={14} color="#22c55e" style={{ flexShrink: 0, marginTop: 1 }} />
            : <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: block.ok ? '#22c55e' : '#ef4444', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              Verification {block.ok ? 'Passed' : 'Failed'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{block.content}</div>
            {!block.ok && block.rollback && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
                ⚠ Rollback recommended: {block.rollback}
              </div>
            )}
          </div>
        </div>
      );

    case 'error':
      return (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12 }}>
          <AlertTriangle size={14} color="#f87171" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#f87171' }}>{block.content}</span>
        </div>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  // --- State ---
  const [blocks, setBlocks] = useState([
    {
      id: newId(),
      type: 'sys',
      content: 'Sovereign Edge Node v24.0.0 Online — DevOps mode active',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [command, setCommand] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [workflowStage, setWorkflowStage] = useState(0); // index into WORKFLOW_STAGES

  const [vfs, setVfs] = useState({
    '/edge/worker.js': {
      content: 'export default { async fetch(request) { return new Response("Hello Edge"); } }',
      meta: { scope: 'edge', risk: 'low' },
    },
    '/config/mcp.json': {
      content: '{ "version": "1.0", "tools": ["kv", "vfs"] }',
      meta: { scope: 'local', risk: 'low' },
    },
  });

  const feedRef = useRef(null);
  const inputRef = useRef(null);

  // --- Derived ---
  const isBusy = useMemo(
    () => isFetching || approvalQueue.length > 0,
    [isFetching, approvalQueue.length],
  );
  const currentApproval = useMemo(() => approvalQueue[queueIndex] ?? null, [approvalQueue, queueIndex]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [blocks]);

  // Escape to close file inspector
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedFile(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // --- Actions ---
  const addBlock = useCallback((type, content, extras = {}) => {
    setBlocks(prev => [
      ...prev,
      { id: newId(), type, content, timestamp: new Date().toLocaleTimeString(), ...extras },
    ]);
  }, []);

  const advanceStage = useCallback((targetIndex) => {
    setWorkflowStage(prev => Math.max(prev, targetIndex));
  }, []);

  // --- Agentic loop ---
  const executeAgenticLoop = useCallback(async (userInput) => {
    setIsFetching(true);
    advanceStage(1); // Diagnose

    const systemPrompt = `You are an autonomous DevOps agent. Analyse the input and return ONLY valid JSON:
{
  "thought": "<internal reasoning string>",
  "notion_block": "<concise diagnosis or proposal for the operator>",
  "tool_request": {
    "tool": "VFS_WRITER",
    "args": { "path": "<absolute path>", "content": "<file content>" },
    "risk": "low|medium|high|critical",
    "rollback": "<description of how to roll back this change>"
  } | null
}`;

    try {
      const data = await fetchWithTimeoutRetry('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userInput }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });

      // Handle empty / malformed provider response
      let parsed = null;
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          addBlock('error', 'Agent returned malformed JSON. See console for raw output.');
          console.error('[devops-ui] malformed agent response:', raw);
        }
      } else {
        addBlock('error', 'Agent returned an empty response.');
      }

      if (parsed) {
        if (parsed.notion_block) {
          addBlock('agent', parsed.notion_block, { thought: parsed.thought });
          advanceStage(2); // Propose
        }
        if (parsed.tool_request) {
          // Validate tool payload before queuing
          const tr = parsed.tool_request;
          if (!isValidPath(tr?.args?.path)) {
            addBlock('error', `Invalid tool_request: 'args.path' must be a non-empty absolute path.`);
          } else {
            setApprovalQueue(prev => [
              ...prev,
              {
                id: newId(),
                tool: tr.tool,
                args: { path: tr.args.path, content: clampContent(tr.args.content) },
                risk: tr.risk ?? 'medium',
                rollback: tr.rollback ?? 'Manual revert required.',
              },
            ]);
            advanceStage(3); // Approve
          }
        }
      }
    } catch (err) {
      addBlock('error', `Agentic failure: ${err.message}`);
    } finally {
      setIsFetching(false);
    }
  }, [addBlock, advanceStage]);

  const handleCommand = useCallback(() => {
    const trimmed = command.trim();
    if (!trimmed || isBusy) return; // Ignore empty submissions
    addBlock('user', trimmed);
    setCommand('');
    advanceStage(0); // Observe
    executeAgenticLoop(trimmed);
  }, [command, isBusy, addBlock, advanceStage, executeAgenticLoop]);

  // --- Approval processing ---
  const processApproval = useCallback((id, confirmed) => {
    const item = approvalQueue.find(q => q.id === id);
    if (!item) return;

    if (confirmed && item.tool === 'VFS_WRITER') {
      advanceStage(4); // Execute
      setVfs(prev => ({
        ...prev,
        [item.args.path]: {
          content: item.args.content,
          meta: { scope: 'sync', risk: item.risk },
        },
      }));
      addBlock('sys', `MCP operation committed: ${item.args.path}`);

      // Verification stage (simulated – replace with real health check as needed)
      const verifyPassed = !item.args.content.includes('FORCE_FAIL');
      advanceStage(5); // Verify
      setTimeout(() => {
        addBlock('verify', verifyPassed
          ? `File ${item.args.path} deployed and reachable.`
          : `Health check for ${item.args.path} returned unexpected status.`, {
          ok: verifyPassed,
          rollback: verifyPassed ? null : item.rollback,
        });
      }, 800);
    } else {
      addBlock('sys', 'Operation halted by operator.');
    }

    // Remove only this item; keep the rest of the queue
    const newQueue = approvalQueue.filter(q => q.id !== id);
    setApprovalQueue(newQueue);
    // Keep the index stable, clamped to new queue length
    setQueueIndex(prev => Math.min(prev, Math.max(0, newQueue.length - 1)));
  }, [approvalQueue, addBlock, advanceStage]);

  // --- File inspector guard ---
  const safeSelectedFileContent = selectedFile && vfs[selectedFile]
    ? vfs[selectedFile]
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#09090b', color: '#fff', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <header style={{ height: 48, background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <Zap size={14} color="#06b6d4" />
        <span style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Agentic DevOps Node v24
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {WORKFLOW_STAGES.map((stage, i) => (
            <div key={stage} style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 20,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              background: i === workflowStage ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
              color: i === workflowStage ? '#06b6d4' : 'rgba(255,255,255,0.2)',
              border: i === workflowStage ? '1px solid rgba(6,182,212,0.3)' : '1px solid transparent',
              transition: 'all 0.2s',
            }}>
              {stage}
            </div>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left – Telemetry / incident feed */}
        <aside style={{ width: 240, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.2em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={11} color="#06b6d4" /> Telemetry Feed
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }} className="no-scrollbar">
            {blocks.filter(b => b.type === 'sys' || b.type === 'error' || b.type === 'verify').map(b => (
              <div key={b.id} className="animate-in" style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: b.type === 'error' ? 'rgba(239,68,68,0.08)' : b.type === 'verify' && !b.ok ? 'rgba(239,68,68,0.06)' : b.type === 'verify' && b.ok ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${b.type === 'error' ? 'rgba(239,68,68,0.2)' : b.type === 'verify' && !b.ok ? 'rgba(239,68,68,0.15)' : b.type === 'verify' && b.ok ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)'}`,
              }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{b.content}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 3, fontFamily: 'monospace' }}>{b.timestamp}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* Center – Diagnosis / proposal workspace */}
        <section style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#09090b' }}>
          <div ref={feedRef} style={{ flex: 1, overflowY: 'auto', padding: '32px' }} className="no-scrollbar">
            <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
              {blocks.map(b => (
                <div key={b.id} className="animate-in">
                  <Block block={b} />
                </div>
              ))}
            </div>
          </div>

          {/* Input bar */}
          <div style={{ height: 72, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', padding: '0 32px', gap: 16, flexShrink: 0 }}>
            <div style={{ flex: 1, maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                ref={inputRef}
                type="text"
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCommand()}
                placeholder={isBusy ? 'Processing…' : 'Define edge task or incident query…'}
                disabled={isBusy}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 14,
                  color: isBusy ? 'rgba(255,255,255,0.2)' : '#fff',
                  caretColor: '#06b6d4',
                }}
              />
              {isFetching && <Activity size={16} color="#f59e0b" style={{ flexShrink: 0 }} className="animate-spin" />}
            </div>
          </div>
        </section>

        {/* Right – VFS / system-state sidebar */}
        <aside style={{ width: 280, borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.2em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cpu size={11} color="#06b6d4" /> VFS / System State
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }} className="no-scrollbar">
            {Object.keys(vfs).map(path => {
              const file = vfs[path];
              return (
                <button
                  key={path}
                  onClick={() => setSelectedFile(path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.05)',
                    cursor: 'pointer', width: '100%', textAlign: 'left', marginBottom: 6,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <FileText size={13} color="rgba(255,255,255,0.15)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>{file.meta.scope}</span>
                      {file.meta.risk && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: riskColour(file.meta.risk), textTransform: 'uppercase' }}>
                          ● {file.meta.risk}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye size={11} color="rgba(255,255,255,0.15)" style={{ flexShrink: 0 }} />
                </button>
              );
            })}
          </div>

          {/* Queue indicator */}
          {approvalQueue.length > 0 && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={11} /> {approvalQueue.length} pending approval{approvalQueue.length > 1 ? 's' : ''}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Approval Drawer ── */}
      {currentApproval && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Deployment authorization required"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ width: '100%', maxWidth: 520, background: '#0c0c0e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.7)', overflow: 'hidden' }} className="animate-in">
            {/* Drawer header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                <Shield size={15} /> Human Authorization Required
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '3px 10px', borderRadius: 8 }}>
                {queueIndex + 1} / {approvalQueue.length}
              </div>
            </div>

            {/* Drawer body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Risk / rollback metadata */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Risk Level</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: riskColour(currentApproval.risk) }}>
                    {(currentApproval.risk ?? 'unknown').toUpperCase()}
                  </div>
                </div>
                <div style={{ flex: 2, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Rollback Plan</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                    {currentApproval.rollback ?? 'Manual revert required.'}
                  </div>
                </div>
              </div>

              {/* Payload preview */}
              <div style={{ padding: '14px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, fontFamily: 'monospace', fontSize: 11, color: '#67e8f9', overflowX: 'auto', maxHeight: 160, overflowY: 'auto' }}>
                <div style={{ color: 'rgba(255,255,255,0.2)', marginBottom: 8 }}>// {currentApproval.tool}</div>
                <pre>{JSON.stringify(currentApproval.args, null, 2)}</pre>
              </div>

              {/* Navigation + action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setQueueIndex(prev => Math.max(0, prev - 1))}
                  disabled={queueIndex === 0}
                  style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#fff', opacity: queueIndex === 0 ? 0.2 : 1 }}
                  aria-label="Previous approval request"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setQueueIndex(prev => Math.min(approvalQueue.length - 1, prev + 1))}
                  disabled={queueIndex === approvalQueue.length - 1}
                  style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 10, cursor: 'pointer', color: '#fff', opacity: queueIndex === approvalQueue.length - 1 ? 0.2 : 1 }}
                  aria-label="Next approval request"
                >
                  <ChevronRight size={15} />
                </button>
                <button
                  onClick={() => processApproval(currentApproval.id, true)}
                  style={{ flex: 1, padding: '12px', background: '#f59e0b', border: 'none', borderRadius: 12, cursor: 'pointer', color: '#000', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Check size={13} /> Authorize
                </button>
                <button
                  onClick={() => processApproval(currentApproval.id, false)}
                  style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 12, cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <X size={13} /> Deny
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VFS Inspector Modal ── */}
      {selectedFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`File inspector: ${selectedFile}`}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedFile(null); }}
        >
          <div style={{ width: '100%', maxWidth: 720, height: '75vh', background: '#0c0c0e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}>
            {/* Modal header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                <Code size={13} />
                {safeSelectedFileContent ? selectedFile : `${selectedFile} (unavailable)`}
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                aria-label="Close file inspector"
                style={{ padding: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', borderRadius: 8, display: 'flex', alignItems: 'center' }}
              >
                <X size={17} />
              </button>
            </div>
            {/* Modal body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '20px', fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, background: 'rgba(0,0,0,0.2)' }} className="no-scrollbar">
              {safeSelectedFileContent
                ? <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{safeSelectedFileContent.content}</pre>
                : <div style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>File no longer exists in VFS.</div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
