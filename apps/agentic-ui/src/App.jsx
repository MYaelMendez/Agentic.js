import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal, Shield, Cpu, Activity, Zap,
  Globe, Command, Eye, Lock, HardDrive,
  Layers, Box, Info, CheckCircle, XCircle,
  Clock, Trash2, ChevronLeft, ChevronRight,
  AlertTriangle, FileText, X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_CONTENT_BYTES = 512 * 1024; // 512 KB VFS write limit
const FETCH_TIMEOUT_MS  = 30_000;
const MAX_RETRIES       = 2;

const NAV_ITEMS = [
  { icon: Terminal,  label: 'Console',  id: 'console'  },
  { icon: HardDrive, label: 'VFS',      id: 'vfs'      },
  { icon: Shield,    label: 'Approvals',id: 'approvals' },
  { icon: Activity,  label: 'Thoughts', id: 'thoughts'  },
  { icon: Globe,     label: 'Network',  id: 'network'   },
];

const INITIAL_VFS = {
  '/sys/kernel':         'v23.0.0',
  '/etc/hosts':          '127.0.0.1 localhost',
  '/home/agent/init.js': '// agentic.js bootstrap\nconsole.log("ready");',
};

const INITIAL_LINES = [
  { id: 'boot0', type: 'sys',  text: 'PrivateClient.ai · V23 Hardened Kernel' },
  { id: 'boot1', type: 'sys',  text: 'Memory Registry: OPTIMIZED' },
  { id: 'boot2', type: 'sys',  text: 'agentic.js Loop: READY — type a command below' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function clampContent(str) {
  const bytes = new TextEncoder().encode(str);
  if (bytes.length <= MAX_CONTENT_BYTES) return str;
  return new TextDecoder().decode(bytes.slice(0, MAX_CONTENT_BYTES)) + '\n[...truncated]';
}

function validatePath(path) {
  if (typeof path !== 'string' || path.trim() === '') return false;
  if (path.includes('..')) return false; // basic traversal guard
  if (!path.startsWith('/')) return false;
  return true;
}

async function fetchWithTimeoutAndRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      // Do not retry 4xx auth/validation failures
      if (res.status >= 400 && res.status < 500) return res;
      if (!res.ok && attempt < retries) continue;
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Left navigation rail */
function NavRail({ active, onChange }) {
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: 56,
        background: '#0d1117',
        borderRight: '1px solid #1a2233',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 4,
        flexShrink: 0,
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 12,
        }}
        aria-hidden="true"
      >
        <Zap size={16} color="#fff" />
      </div>

      {NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            style={{
              width: 40, height: 40, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? '#1e293b' : 'transparent',
              color: isActive ? '#818cf8' : '#4b5563',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </nav>
  );
}

/** Single conversation block */
function ConversationBlock({ line }) {
  const colors = {
    sys:   { bg: '#0f172a', border: '#1e3a5f', text: '#60a5fa', prefix: '[SYS]' },
    user:  { bg: '#0f1a0f', border: '#14532d', text: '#4ade80', prefix: '  >'   },
    exec:  { bg: '#1a0f0f', border: '#7f1d1d', text: '#f87171', prefix: '[EXEC]' },
    halt:  { bg: '#1a0f0f', border: '#7f1d1d', text: '#fb923c', prefix: '[HALT]' },
    error: { bg: '#1a0f0f', border: '#7f1d1d', text: '#f87171', prefix: '[ERR]'  },
    model: { bg: '#0f0f1a', border: '#312e81', text: '#a78bfa', prefix: '[AI]'   },
    info:  { bg: '#0d1117', border: '#1a2233', text: '#94a3b8', prefix: '[INFO]' },
  };
  const style = colors[line.type] || colors.info;

  return (
    <div
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 6,
        padding: '6px 12px',
        marginBottom: 4,
        fontFamily: 'inherit',
        fontSize: 12,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <span style={{ color: style.text, opacity: 0.7, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {style.prefix}
      </span>
      <span style={{ color: '#e2e8f0', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {line.text}
      </span>
    </div>
  );
}

/** Central console panel */
function ConsolePanel({ lines, isProcessing, command, setCommand, onSubmit, inputRef }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (command.trim()) onSubmit(command.trim());
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          height: 40, borderBottom: '1px solid #1a2233',
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
          background: '#0d1117', flexShrink: 0,
        }}
      >
        <Terminal size={14} color="#818cf8" />
        <span style={{ color: '#94a3b8', fontSize: 12 }}>console · agentic.js</span>
        {isProcessing && (
          <span
            style={{
              marginLeft: 'auto', color: '#fbbf24', fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Cpu size={12} />
            processing…
          </span>
        )}
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflow: 'auto', padding: '12px 16px',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {lines.map(line => (
          <ConversationBlock key={line.id} line={line} />
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: '1px solid #1a2233',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#0d1117', flexShrink: 0,
        }}
      >
        <Command size={14} color="#4b5563" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command…"
          aria-label="Command input"
          disabled={isProcessing}
          style={{
            flex: 1, background: 'transparent', color: '#e2e8f0',
            fontSize: 13, fontFamily: 'inherit',
            opacity: isProcessing ? 0.5 : 1,
          }}
        />
        {isProcessing && (
          <span style={{ color: '#4b5563', fontSize: 11 }}>locked</span>
        )}
      </div>
    </div>
  );
}

/** Right sidebar — VFS browser */
function VfsSidebar({ vfs, onInspect }) {
  const paths = Object.keys(vfs).sort();

  return (
    <div
      style={{
        width: 240, background: '#0d1117',
        borderLeft: '1px solid #1a2233',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 40, borderBottom: '1px solid #1a2233',
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8,
          flexShrink: 0,
        }}
      >
        <HardDrive size={13} color="#818cf8" />
        <span style={{ color: '#94a3b8', fontSize: 12 }}>Virtual FS</span>
        <span
          style={{
            marginLeft: 'auto', color: '#4b5563',
            fontSize: 10, background: '#1e293b',
            padding: '1px 6px', borderRadius: 10,
          }}
        >
          {paths.length}
        </span>
      </div>
      <ul
        role="list"
        aria-label="Virtual file system"
        style={{ flex: 1, overflow: 'auto', padding: '8px 0', listStyle: 'none' }}
      >
        {paths.map(path => (
          <li key={path}>
            <button
              onClick={() => onInspect(path)}
              title={`Inspect ${path}`}
              style={{
                width: '100%', textAlign: 'left',
                padding: '5px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
                color: '#64748b', fontSize: 11,
                transition: 'background 0.1s, color 0.1s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#1e293b';
                e.currentTarget.style.color = '#94a3b8';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#64748b';
              }}
            >
              <FileText size={11} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {path}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Approval drawer */
function ApprovalDrawer({ queue, currentIndex, onNavigate, onDecide, drawerRef }) {
  const step = queue[currentIndex];
  const total = queue.length;

  if (total === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pending tool approval"
      ref={drawerRef}
      style={{
        position: 'absolute', bottom: 0, left: 56, right: 240,
        background: '#0f172a',
        borderTop: '2px solid #6366f1',
        padding: '12px 20px',
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 20,
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={14} color="#818cf8" />
        <span style={{ color: '#818cf8', fontSize: 12, fontWeight: 600 }}>
          Human-in-the-Loop Approval
        </span>
        <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 11 }}>
          {currentIndex + 1} / {total}
        </span>
        {/* Queue navigation */}
        <button
          onClick={() => onNavigate(-1)}
          disabled={currentIndex === 0}
          aria-label="Previous approval"
          style={{ color: currentIndex === 0 ? '#1e293b' : '#64748b', padding: '0 4px' }}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => onNavigate(1)}
          disabled={currentIndex === total - 1}
          aria-label="Next approval"
          style={{ color: currentIndex === total - 1 ? '#1e293b' : '#64748b', padding: '0 4px' }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {step && (
        <>
          {/* Tool info */}
          <div
            style={{
              background: '#1e293b', borderRadius: 6, padding: '8px 12px',
              fontSize: 11, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            <div>
              <span style={{ color: '#f59e0b' }}>Tool:</span>{' '}
              <span style={{ color: '#e2e8f0' }}>{step.tool}</span>
            </div>
            <div>
              <span style={{ color: '#f59e0b' }}>Path:</span>{' '}
              <span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>{step.args?.path}</span>
            </div>
            {step.args?.content && (
              <div style={{ maxHeight: 60, overflow: 'auto' }}>
                <span style={{ color: '#f59e0b' }}>Content preview:</span>{' '}
                <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 10 }}>
                  {String(step.args.content).slice(0, 200)}
                  {step.args.content.length > 200 ? '…' : ''}
                </span>
              </div>
            )}
            <div style={{ color: '#6b7280', fontSize: 10 }}>{step.description}</div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onDecide(step.id, true)}
              aria-label={`Approve ${step.tool}`}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6,
                background: '#14532d', color: '#4ade80',
                fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: '1px solid #166534',
              }}
            >
              <CheckCircle size={13} /> Approve
            </button>
            <button
              onClick={() => onDecide(step.id, false)}
              aria-label={`Deny ${step.tool}`}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6,
                background: '#7f1d1d', color: '#f87171',
                fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: '1px solid #991b1b',
              }}
            >
              <XCircle size={13} /> Deny
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** VFS file inspector modal */
function FileInspectorModal({ path, content, onClose }) {
  const modalRef = useRef(null);

  // Focus modal on open
  useEffect(() => {
    if (modalRef.current) modalRef.current.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`File inspector: ${path}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          background: '#0d1117', border: '1px solid #2d3748',
          borderRadius: 10, padding: '20px 24px',
          width: '90%', maxWidth: 600, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', gap: 12,
          outline: 'none',
        }}
      >
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={14} color="#818cf8" />
          <span style={{ color: '#818cf8', fontSize: 12, fontWeight: 600 }}>File Inspector</span>
          <span
            style={{
              marginLeft: 8, color: '#a78bfa', fontSize: 11,
              fontFamily: 'monospace', background: '#1e293b',
              padding: '2px 8px', borderRadius: 4,
            }}
          >
            {path}
          </span>
          <button
            onClick={onClose}
            aria-label="Close file inspector"
            style={{
              marginLeft: 'auto', color: '#4b5563', padding: 4,
              borderRadius: 4, lineHeight: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <pre
          style={{
            flex: 1, overflow: 'auto',
            background: '#0a0c0f', border: '1px solid #1a2233',
            borderRadius: 6, padding: 12,
            fontSize: 12, color: '#a5b4fc',
            fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {content ?? '(empty)'}
        </pre>
      </div>
    </div>
  );
}

/** Thoughts panel (side drawer contents) */
function ThoughtsPanel({ thoughts }) {
  const icons = { plan: Layers, reasoning: Box, info: Info, warning: AlertTriangle };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto', padding: 12, gap: 6 }}>
      {thoughts.length === 0 && (
        <span style={{ color: '#4b5563', fontSize: 11, padding: '8px 0' }}>
          No agent reasoning yet.
        </span>
      )}
      {thoughts.map(t => {
        const Icon = icons[t.type] || Info;
        return (
          <div
            key={t.id}
            style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 6, padding: '6px 10px',
              display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11,
            }}
          >
            <Icon size={12} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const [activeNav,      setActiveNav]      = useState('console');
  const [command,        setCommand]        = useState('');
  const [lines,          setLines]          = useState(INITIAL_LINES);
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [approvalQueue,  setApprovalQueue]  = useState([]);
  const [approvalIndex,  setApprovalIndex]  = useState(0);
  const [vfs,            setVfs]            = useState(INITIAL_VFS);
  const [thoughts,       setThoughts]       = useState([]);
  const [inspectPath,    setInspectPath]    = useState(null);

  const inputRef   = useRef(null);
  const drawerRef  = useRef(null);

  // Focus input when no approval pending
  useEffect(() => {
    if (approvalQueue.length === 0 && !isProcessing) {
      inputRef.current?.focus();
    }
  }, [approvalQueue.length, isProcessing]);

  // Focus approval drawer when queue appears
  useEffect(() => {
    if (approvalQueue.length > 0 && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [approvalQueue.length]);

  // Clamp approvalIndex when queue shrinks
  useEffect(() => {
    if (approvalQueue.length > 0 && approvalIndex >= approvalQueue.length) {
      setApprovalIndex(approvalQueue.length - 1);
    }
  }, [approvalQueue.length, approvalIndex, setApprovalIndex]);

  const addLine = useCallback((type, text) => {
    setLines(prev => [...prev, { id: uid(), type, text }]);
  }, []);

  const addThought = useCallback((type, text) => {
    setThoughts(prev => [...prev, { id: uid(), type, text }]);
  }, []);

  // ---------------------------------------------------------------------------
  // Agentic loop — calls proxy server, never calls Gemini directly
  // ---------------------------------------------------------------------------
  const executeAgenticLoop = useCallback(async (input) => {
    setIsProcessing(true);
    addThought('plan', `Initiating agentic sequence for: ${input}`);

    let modelResponse = null;

    try {
      const res = await fetchWithTimeoutAndRetry('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error ?? `Proxy returned HTTP ${res.status}.`;
        throw new Error(errMsg);
      }

      const data = await res.json().catch(() => null);

      if (!data || typeof data.text !== 'string' || data.text.trim() === '') {
        addLine('error', 'Model returned an empty or unreadable response.');
        addThought('warning', 'Empty model response — using fallback tool generation.');
      } else {
        modelResponse = data.text;
        addLine('model', modelResponse);
        addThought('reasoning', 'Model response received; generating tool invocation.');
      }
    } catch (err) {
      const msg = err?.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : `Network or proxy error: ${err.message}`;
      addLine('error', msg);
      addThought('warning', msg);
      setIsProcessing(false);
      return;
    }

    // Derive a tool step from the command.
    // Explicit "/delete <path>" removes that path; everything else writes a new log file.
    const deleteMatch = input.match(/^\/delete\s+(\/\S+)/i);
    const isDelete    = Boolean(deleteMatch);
    const targetPath  = isDelete
      ? deleteMatch[1]
      : `/logs/${Date.now()}.log`;

    const newStep = {
      id: `step_${uid()}`,
      tool:  isDelete ? 'FS_REMOVE' : 'VFS_WRITER',
      args: {
        path:    targetPath,
        content: isDelete
          ? undefined
          : clampContent(`# Generated from command\n# ${input}\n\n${modelResponse ?? ''}`),
      },
      description: 'Agent requests permission to modify the virtual filesystem.',
    };

    setApprovalQueue(prev => [...prev, newStep]);
    addThought('reasoning', `Tool ${newStep.tool} queued on path ${newStep.args.path}. Awaiting human approval.`);
  }, [addLine, addThought]);

  // ---------------------------------------------------------------------------
  // Handle approval/denial
  // ---------------------------------------------------------------------------
  const handleDecide = useCallback((id, approved) => {
    const step = approvalQueue.find(s => s.id === id);

    if (!step) {
      addLine('error', 'Approval step not found — it may have already been processed.');
      return;
    }

    if (approved) {
      // Validate payload before applying
      if (!validatePath(step.args?.path)) {
        addLine('error', `Invalid path in tool payload: "${step.args?.path}" — denied.`);
        setApprovalQueue(prev => prev.filter(s => s.id !== id));
        return;
      }

      if (step.tool === 'FS_REMOVE') {
        setVfs(prev => {
          const next = { ...prev };
          delete next[step.args.path];
          return next;
        });
        addLine('exec', `REMOVED: ${step.args.path}`);
      } else {
        const safeContent = clampContent(step.args.content ?? '');
        setVfs(prev => ({ ...prev, [step.args.path]: safeContent }));
        addLine('exec', `COMMITTED: ${step.args.path}`);
      }
    } else {
      addLine('halt', `Human denied tool: ${step.tool} on ${step.args?.path}`);
    }

    setApprovalQueue(prev => prev.filter(s => s.id !== id));
  }, [approvalQueue, addLine]);

  // Derive processing state from the approval queue length
  useEffect(() => {
    if (approvalQueue.length === 0) {
      setIsProcessing(false);
      setApprovalIndex(0);
    }
  }, [approvalQueue.length]);

  // ---------------------------------------------------------------------------
  // Command submission
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback((input) => {
    if (!input.trim()) return;
    addLine('user', input);
    setCommand('');
    executeAgenticLoop(input.trim());
  }, [addLine, executeAgenticLoop]);

  // ---------------------------------------------------------------------------
  // VFS inspector — guard against file disappearing
  // ---------------------------------------------------------------------------
  const handleInspect = useCallback((path) => {
    if (path in vfs) setInspectPath(path);
    else addLine('error', `File not found: ${path}`);
  }, [vfs, addLine]);

  const handleCloseInspect = useCallback(() => setInspectPath(null), []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const drawerOpen = approvalQueue.length > 0;

  return (
    <div
      style={{
        display: 'flex', height: '100vh', width: '100vw',
        overflow: 'hidden', background: '#0a0c0f', position: 'relative',
      }}
    >
      {/* ── Left nav rail ── */}
      <NavRail active={activeNav} onChange={setActiveNav} />

      {/* ── Main area ── */}
      <div
        style={{
          flex: 1, display: 'flex', overflow: 'hidden',
          paddingBottom: drawerOpen ? 156 : 0,
          transition: 'padding-bottom 0.2s',
        }}
      >
        {/* Central console */}
        {activeNav === 'console' && (
          <ConsolePanel
            lines={lines}
            isProcessing={isProcessing}
            command={command}
            setCommand={setCommand}
            onSubmit={handleSubmit}
            inputRef={inputRef}
          />
        )}

        {/* Thoughts panel */}
        {activeNav === 'thoughts' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                height: 40, borderBottom: '1px solid #1a2233',
                display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
                background: '#0d1117', flexShrink: 0,
              }}
            >
              <Activity size={14} color="#818cf8" />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Agent Reasoning</span>
            </div>
            <ThoughtsPanel thoughts={thoughts} />
          </div>
        )}

        {/* Approvals overview */}
        {activeNav === 'approvals' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                height: 40, borderBottom: '1px solid #1a2233',
                display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
                background: '#0d1117', flexShrink: 0,
              }}
            >
              <Shield size={14} color="#818cf8" />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                Pending Approvals ({approvalQueue.length})
              </span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {approvalQueue.length === 0 && (
                <span style={{ color: '#4b5563', fontSize: 11 }}>No pending approvals.</span>
              )}
              {approvalQueue.map((step, i) => (
                <div
                  key={step.id}
                  style={{
                    background: '#0f172a', border: '1px solid #1e293b',
                    borderRadius: 6, padding: '8px 12px', fontSize: 11,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Clock size={11} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ color: '#f59e0b' }}>{step.tool}</span>
                    <span style={{ color: '#6b7280', marginLeft: 'auto' }}>#{i + 1}</span>
                  </div>
                  <div style={{ color: '#a78bfa', fontFamily: 'monospace', fontSize: 10 }}>
                    {step.args?.path}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VFS file list (also shown as right sidebar) */}
        {activeNav === 'vfs' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                height: 40, borderBottom: '1px solid #1a2233',
                display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
                background: '#0d1117', flexShrink: 0,
              }}
            >
              <HardDrive size={14} color="#818cf8" />
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Virtual File System</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
              <ul role="list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.keys(vfs).sort().map(path => (
                  <li key={path}>
                    <button
                      onClick={() => handleInspect(path)}
                      style={{
                        width: '100%', textAlign: 'left',
                        background: '#0f172a', border: '1px solid #1e293b',
                        borderRadius: 6, padding: '6px 12px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        color: '#64748b', fontSize: 12,
                        fontFamily: 'inherit', transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1e293b'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#0f172a'; }}
                    >
                      <FileText size={12} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {path}
                      </span>
                      <Eye size={11} color="#374151" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Network placeholder */}
        {activeNav === 'network' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#4b5563', fontSize: 12 }}>Network monitor — coming soon.</span>
          </div>
        )}
      </div>

      {/* ── Right VFS sidebar (always visible when on console) ── */}
      {activeNav === 'console' && (
        <VfsSidebar vfs={vfs} onInspect={handleInspect} />
      )}

      {/* ── Persistent approval drawer ── */}
      {drawerOpen && (
        <ApprovalDrawer
          queue={approvalQueue}
          currentIndex={Math.min(approvalIndex, approvalQueue.length - 1)}
          onNavigate={(dir) =>
            setApprovalIndex(prev =>
              Math.max(0, Math.min(prev + dir, approvalQueue.length - 1))
            )
          }
          onDecide={handleDecide}
          drawerRef={drawerRef}
        />
      )}

      {/* ── VFS inspector modal ── */}
      {inspectPath !== null && (
        <FileInspectorModal
          path={inspectPath}
          content={vfs[inspectPath]}
          onClose={handleCloseInspect}
        />
      )}
    </div>
  );
}
