/**
 * æ>_ WRANGLERBASE v7.5 — Application logic
 *
 * Architecture:
 *  - Module-scoped state (no globals)
 *  - requestAnimationFrame for all visual updates
 *  - Event delegation where practical
 *  - Explicit cleanup for intervals / rAF loops
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOT_STEPS = [
  'Initialising runtime…',
  'Loading agent registry…',
  'Connecting telemetry bus…',
  'Calibrating metrics…',
  'Spawning worker pool…',
  'Ready.',
];

const BOOT_DURATION_MS = 2400;

const FEED_LEVELS = ['INFO', 'INFO', 'INFO', 'WARN', 'DEBUG', 'ERROR'];

const FEED_MESSAGES = [
  'Agent agt-{id} dispatched task #{task}',
  'Checkpoint reached at pipeline stage {stage}',
  'Model inference completed in {ms}ms',
  'Cache miss — fetching remote tensor shard',
  'Retrying failed subtask (attempt {n}/3)',
  'Worker {id} heartbeat OK',
  'Token budget threshold reached ({pct}%)',
  'Batch size auto-adjusted to {n}',
  'Connection to shard {id} established',
  'GC cycle completed; freed {mb}MB',
];

const AGENT_STATUSES = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'IDLE', 'ERROR'];
const AGENT_TASKS = [
  'summarise',
  'classify',
  'embed',
  'translate',
  'rerank',
  'generate',
  'extract',
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Return a random integer in [min, max] inclusive. */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Return a random element from an array. */
const pick = (arr) => arr[randInt(0, arr.length - 1)];

/** Format a Date as HH:MM:SS. */
const formatTime = (date) =>
  [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

/** Fill template placeholders like {id}, {ms}, … with random values. */
const fillTemplate = (tpl) =>
  tpl
    .replace(/{id}/g,    () => String(randInt(1, 99)).padStart(3, '0'))
    .replace(/{task}/g,  () => randInt(1000, 9999))
    .replace(/{stage}/g, () => randInt(1, 8))
    .replace(/{ms}/g,    () => randInt(12, 980))
    .replace(/{n}/g,     () => randInt(1, 128))
    .replace(/{pct}/g,   () => randInt(70, 99))
    .replace(/{mb}/g,    () => randInt(10, 512));

// ---------------------------------------------------------------------------
// DOM references (resolved once)
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const dom = {
  bootOverlay:       $('boot-overlay'),
  bootProgressBar:   $('boot-progress-bar'),
  bootProgressFill:  $('boot-progress-fill'),
  bootStatus:        $('boot-status'),

  navButtons:        document.querySelectorAll('.nav-btn'),

  mcAgents:          $('mc-agents-value'),
  mcTasks:           $('mc-tasks-value'),
  mcThroughput:      $('mc-throughput-value'),
  mcLatency:         $('mc-latency-value'),

  throughputCanvas:  $('throughput-chart'),

  agentTableBody:    $('agent-table-body'),

  // Gauge elements (metrics panel)
  gaugeCpuFill:      $('gauge-cpu-fill'),
  gaugeCpuVal:       $('gauge-cpu-val'),
  gaugeMemFill:      $('gauge-mem-fill'),
  gaugeMemVal:       $('gauge-mem-val'),
  gaugeNetFill:      $('gauge-net-fill'),
  gaugeNetVal:       $('gauge-net-val'),
  gaugeGpuFill:      $('gauge-gpu-fill'),
  gaugeGpuVal:       $('gauge-gpu-val'),

  // Accessible meter wrappers
  gaugeCpu:          $('gauge-cpu'),
  gaugeMem:          $('gauge-mem'),
  gaugeNet:          $('gauge-net'),
  gaugeGpu:          $('gauge-gpu'),

  feedLog:           $('feed-log'),
  feedPause:         $('feed-pause'),
  feedClear:         $('feed-clear'),

  terminalOutput:    $('terminal-output'),
  terminalForm:      $('terminal-form'),
  terminalInput:     $('terminal-input'),

  footerTime:        $('footer-time'),
  systemStatus:      $('system-status'),

  shareBtn:          $('share-btn'),
  shareDialog:       $('share-dialog'),
  shareAgentList:    $('share-agent-list'),
  shareDialogClose:  $('share-dialog-close'),
  shareDialogCancel: $('share-dialog-cancel'),
};

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

const state = {
  activePanel: 'dashboard',
  feedPaused: false,
  feedCount: 0,       // total events, used as key for accessibility
  chartHistory: Array(60).fill(0),
  agents: [],
  timers: [],         // interval IDs for cleanup
  rafId: null,        // rAF loop handle
};

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

function runBootSequence() {
  const start = performance.now();
  let stepIndex = 0;

  const tick = (now) => {
    const elapsed = now - start;
    const pct = Math.min(1, elapsed / BOOT_DURATION_MS);

    // Update progress bar + ARIA
    const pctInt = Math.round(pct * 100);
    dom.bootProgressFill.style.width = `${pctInt}%`;
    dom.bootProgressBar.setAttribute('aria-valuenow', pctInt);

    // Advance text steps
    const targetStep = Math.floor(pct * BOOT_STEPS.length);
    if (targetStep > stepIndex && targetStep < BOOT_STEPS.length) {
      stepIndex = targetStep;
      dom.bootStatus.textContent = BOOT_STEPS[stepIndex];
    }

    if (pct < 1) {
      requestAnimationFrame(tick);
    } else {
      dom.bootStatus.textContent = BOOT_STEPS[BOOT_STEPS.length - 1];
      dom.bootProgressFill.style.width = '100%';

      // Short delay then hide overlay
      setTimeout(() => {
        dom.bootOverlay.classList.add('overlay--hidden');
        dom.bootOverlay.addEventListener(
          'transitionend',
          () => {
            dom.bootOverlay.close();
            // Move focus into main content
            document.getElementById('main-content')?.focus();
          },
          { once: true },
        );

        startApplication();
      }, 300);
    }
  };

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Panel navigation
// ---------------------------------------------------------------------------

function initNav() {
  // Event delegation on the nav element
  const nav = document.querySelector('.topbar__nav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    switchPanel(btn.dataset.panel);
  });

  // Keyboard: Arrow navigation within nav
  nav.addEventListener('keydown', (e) => {
    const btns = [...nav.querySelectorAll('.nav-btn')];
    const idx = btns.indexOf(document.activeElement);
    if (idx === -1) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(idx + 1) % btns.length].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(idx - 1 + btns.length) % btns.length].focus();
    }
  });
}

function switchPanel(panelName) {
  if (panelName === state.activePanel) return;

  // Hide current
  const current = document.getElementById(`panel-${state.activePanel}`);
  current?.classList.remove('panel--active');
  current?.setAttribute('hidden', '');

  // Show next
  const next = document.getElementById(`panel-${panelName}`);
  next?.removeAttribute('hidden');
  // rAF ensures the hidden removal is painted before the class transition
  requestAnimationFrame(() => next?.classList.add('panel--active'));

  // Update buttons
  dom.navButtons.forEach((btn) => {
    const isActive = btn.dataset.panel === panelName;
    btn.classList.toggle('nav-btn--active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  state.activePanel = panelName;
}

// ---------------------------------------------------------------------------
// Clock (footer)
// ---------------------------------------------------------------------------

function initClock() {
  const update = () => {
    dom.footerTime.textContent = formatTime(new Date());
  };
  update();
  // Align to second boundary
  const msUntilNextSecond = 1000 - (Date.now() % 1000);
  setTimeout(() => {
    update();
    state.timers.push(setInterval(update, 1000));
  }, msUntilNextSecond);
}

// ---------------------------------------------------------------------------
// Metrics cards
// ---------------------------------------------------------------------------

function updateMetricCard(el, newValue) {
  if (!el) return;
  el.textContent = newValue;
  // Briefly apply flash class; remove it via animationend to allow re-trigger
  el.classList.remove('metric-card__value--updating');
  // Force reflow so removing + re-adding the class is recognised
  void el.offsetWidth;
  el.classList.add('metric-card__value--updating');
  el.addEventListener('animationend', () => el.classList.remove('metric-card__value--updating'), {
    once: true,
  });
}

function tickMetrics() {
  const agents    = randInt(4, 24);
  const tasks     = randInt(0, 200);
  const throughput = randInt(80, 1400);
  const latency   = randInt(8, 320);

  updateMetricCard(dom.mcAgents,     agents);
  updateMetricCard(dom.mcTasks,      tasks);
  updateMetricCard(dom.mcThroughput, `${throughput}/s`);
  updateMetricCard(dom.mcLatency,    `${latency}ms`);
}

// ---------------------------------------------------------------------------
// Throughput chart (canvas)
// ---------------------------------------------------------------------------

function initChart() {
  // Ensure canvas resolution matches CSS size
  const canvas = dom.throughputCanvas;
  const resizeObserver = new ResizeObserver(() => {
    canvas.width  = canvas.offsetWidth  * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  });
  resizeObserver.observe(canvas);
}

function drawChart() {
  const canvas = dom.throughputCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const bars = state.chartHistory;
  const barCount = bars.length;
  const gap = Math.max(1, Math.floor(width / barCount / 5));
  const barW = Math.max(2, Math.floor((width - gap * (barCount - 1)) / barCount));
  const maxVal = Math.max(...bars, 1);

  ctx.clearRect(0, 0, width, height);

  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim() || '#7b5ea7';
  const accent2 = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent-2')
    .trim() || '#4ecdc4';

  bars.forEach((val, i) => {
    const barH = Math.round((val / maxVal) * (height - 4));
    const x = i * (barW + gap);
    const y = height - barH;

    // Gradient fill
    const grad = ctx.createLinearGradient(x, y, x, height);
    grad.addColorStop(0, accent2);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
  });
}

function tickChart() {
  state.chartHistory.shift();
  state.chartHistory.push(randInt(80, 1400));
}

// ---------------------------------------------------------------------------
// Gauge helpers
// ---------------------------------------------------------------------------

const GAUGE_CIRCUMFERENCE = 264; // 2π × r(42) ≈ 264

function setGauge(fillEl, valEl, meterEl, pct) {
  if (!fillEl || !valEl || !meterEl) return;
  const offset = GAUGE_CIRCUMFERENCE - (pct / 100) * GAUGE_CIRCUMFERENCE;
  fillEl.style.strokeDashoffset = offset;

  // Colour transition: green → amber → red
  if (pct > 85) {
    fillEl.style.stroke = 'var(--color-danger)';
  } else if (pct > 65) {
    fillEl.style.stroke = 'var(--color-accent-3)';
  } else {
    fillEl.style.stroke = 'var(--color-accent-2)';
  }

  valEl.textContent = `${Math.round(pct)}%`;
  meterEl.setAttribute('aria-valuenow', Math.round(pct));
}

function tickGauges() {
  setGauge(dom.gaugeCpuFill, dom.gaugeCpuVal, dom.gaugeCpu, randInt(5, 95));
  setGauge(dom.gaugeMemFill, dom.gaugeMemVal, dom.gaugeMem, randInt(20, 90));
  setGauge(dom.gaugeNetFill, dom.gaugeNetVal, dom.gaugeNet, randInt(10, 75));
  setGauge(dom.gaugeGpuFill, dom.gaugeGpuVal, dom.gaugeGpu, randInt(0, 100));
}

// ---------------------------------------------------------------------------
// Agent roster
// ---------------------------------------------------------------------------

function generateAgents(count = 8) {
  return Array.from({ length: count }, (_, i) => ({
    id: `agt-${String(i + 1).padStart(3, '0')}`,
    status: pick(AGENT_STATUSES),
    task: pick(AGENT_TASKS),
    load: randInt(0, 100),
    uptime: randInt(0, 3600),
  }));
}

function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

function renderAgentTable() {
  const tbody = dom.agentTableBody;
  // Reuse existing rows where possible for minimal DOM churn
  state.agents.forEach((agent, i) => {
    let row = tbody.rows[i];
    if (!row) {
      row = tbody.insertRow();
    }

    const statusClass =
      agent.status === 'ACTIVE' ? 'badge--active'
      : agent.status === 'ERROR' ? 'badge--error'
      : 'badge--idle';

    const loadPct = agent.load;

    row.innerHTML = `
      <td>${agent.id}</td>
      <td><span class="badge ${statusClass}" aria-label="Status: ${agent.status}">${agent.status}</span></td>
      <td>${agent.task}</td>
      <td>
        <div class="load-bar" title="${loadPct}%" aria-label="${loadPct}% load">
          <div class="load-bar__fill" style="width:${loadPct}%"></div>
        </div>
      </td>
      <td>${formatUptime(agent.uptime)}</td>
    `;
  });

  // Remove surplus rows
  while (tbody.rows.length > state.agents.length) {
    tbody.deleteRow(tbody.rows.length - 1);
  }
}

function tickAgents() {
  state.agents = state.agents.map((a) => ({
    ...a,
    status: pick(AGENT_STATUSES),
    load: Math.max(0, Math.min(100, a.load + randInt(-10, 10))),
    uptime: a.uptime + 2,
  }));
}

// ---------------------------------------------------------------------------
// Live feed
// ---------------------------------------------------------------------------

const MAX_FEED_ITEMS = 200;

function appendFeedItem() {
  if (state.feedPaused) return;

  const level = pick(FEED_LEVELS);
  const msg   = fillTemplate(pick(FEED_MESSAGES));
  const ts    = formatTime(new Date());

  const li = document.createElement('li');
  li.className = 'feed-log__item';
  li.innerHTML = `
    <span class="feed-log__ts" aria-label="Timestamp: ${ts}">${ts}</span>
    <span class="feed-log__level feed-log__level--${level.toLowerCase()}" aria-label="Level: ${level}">${level}</span>
    <span class="feed-log__msg">${msg}</span>
  `;

  // Prepend so newest is at top (column-reverse layout)
  dom.feedLog.prepend(li);

  // Cap feed length to prevent unbounded memory growth
  const items = dom.feedLog.children;
  while (items.length > MAX_FEED_ITEMS) {
    dom.feedLog.removeChild(items[items.length - 1]);
  }

  state.feedCount++;
}

function initFeedControls() {
  dom.feedPause?.addEventListener('change', (e) => {
    state.feedPaused = e.target.checked;
    e.target.setAttribute('aria-checked', state.feedPaused);
  });

  dom.feedClear?.addEventListener('click', () => {
    dom.feedLog.innerHTML = '';
    state.feedCount = 0;
  });
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

const COMMANDS = {
  help: () => [
    'Available commands:',
    '  help       — show this message',
    '  status     — print system status',
    '  agents     — list active agents',
    '  clear      — clear terminal output',
    '  version    — show version string',
    '  echo <…>   — echo arguments',
    '  share      — open Share with Agent dialog',
  ].join('\n'),

  status: () =>
    `System: ONLINE | Agents: ${state.agents.length} | Feed events: ${state.feedCount}`,

  agents: () => {
    if (!state.agents.length) return 'No agents registered.';
    return state.agents.map((a) => `  ${a.id}  ${a.status.padEnd(6)}  ${a.task}`).join('\n');
  },

  version: () => 'æ>_ WRANGLERBASE v7.5 — ægentic.js',

  echo: (args) => args.join(' ') || '(empty)',

  share: () => {
    populateShareAgentList();
    dom.shareDialog.showModal();
    return 'Share dialog opened.';
  },

  clear: 'CLEAR',
};

function initTerminal() {
  dom.terminalForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = dom.terminalInput.value.trim();
    if (!raw) return;

    dom.terminalInput.value = '';
    appendTerminalLine(`æ>_ ${raw}`, 'cmd');

    const [cmd, ...args] = raw.split(/\s+/);
    const handler = COMMANDS[cmd.toLowerCase()];

    if (!handler) {
      appendTerminalLine(`Command not found: ${cmd}. Type 'help' for available commands.`, 'err');
    } else if (handler === 'CLEAR') {
      dom.terminalOutput.innerHTML = '';
    } else {
      const result = typeof handler === 'function' ? handler(args) : handler;
      appendTerminalLine(result, 'out');
    }
  });
}

function appendTerminalLine(text, type = 'out') {
  const p = document.createElement('p');
  p.className = `terminal__line terminal__line--${type}`;
  p.textContent = text;
  dom.terminalOutput.appendChild(p);
  dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
}

// ---------------------------------------------------------------------------
// Share with agent
// ---------------------------------------------------------------------------

function populateShareAgentList() {
  const list = dom.shareAgentList;
  if (!list) return;
  list.innerHTML = '';

  const agents = state.agents.length ? state.agents : [];
  if (!agents.length) {
    const empty = document.createElement('li');
    empty.className = 'share-agent-item';
    empty.textContent = 'No agents available.';
    empty.style.color = 'var(--color-text-dim)';
    empty.style.cursor = 'default';
    list.appendChild(empty);
    return;
  }

  agents.forEach((agent) => {
    const li = document.createElement('li');
    li.className = 'share-agent-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `Share with ${agent.id} — ${agent.task}`);

    const idSpan = document.createElement('span');
    idSpan.className = 'share-agent-item__id';
    idSpan.textContent = agent.id;

    const statusBadgeClass =
      agent.status === 'ACTIVE' ? 'badge--active'
      : agent.status === 'ERROR' ? 'badge--error'
      : 'badge--idle';
    const badge = document.createElement('span');
    badge.className = `badge ${statusBadgeClass}`;
    badge.textContent = agent.status;

    const taskSpan = document.createElement('span');
    taskSpan.className = 'share-agent-item__task';
    taskSpan.textContent = agent.task;

    li.append(idSpan, badge, taskSpan);

    const dispatch = () => shareWithAgent(agent);
    li.addEventListener('click', dispatch);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dispatch();
      }
    });

    list.appendChild(li);
  });
}

function shareWithAgent(agent) {
  const ts = formatTime(new Date());
  const msg = `Dashboard snapshot shared with ${agent.id} (${agent.task})`;

  // Log to live feed
  const li = document.createElement('li');
  li.className = 'feed-log__item';
  li.innerHTML = `
    <span class="feed-log__ts" aria-label="Timestamp: ${ts}">${ts}</span>
    <span class="feed-log__level feed-log__level--info" aria-label="Level: INFO">INFO</span>
    <span class="feed-log__msg">⇡ ${msg}</span>
  `;
  dom.feedLog.prepend(li);
  state.feedCount++;

  // Echo to terminal
  appendTerminalLine(`⇡ ${msg}`, 'out');

  dom.shareDialog.close();
}

function initShare() {
  dom.shareBtn?.addEventListener('click', () => {
    populateShareAgentList();
    dom.shareDialog.showModal();
  });

  const closeDialog = () => dom.shareDialog.close();
  dom.shareDialogClose?.addEventListener('click', closeDialog);
  dom.shareDialogCancel?.addEventListener('click', closeDialog);

  // Close on backdrop click
  dom.shareDialog?.addEventListener('click', (e) => {
    if (e.target === dom.shareDialog) closeDialog();
  });

  // Close on Escape (native dialog behaviour — no extra code needed, but
  // we also cancel the default so no duplicate close attempt)
  dom.shareDialog?.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog();
  });
}

// ---------------------------------------------------------------------------
// Main rAF loop (batches visual updates)
// ---------------------------------------------------------------------------

let lastTick = 0;
const TICK_INTERVAL = 2000; // ms between data updates

function rafLoop(now) {
  state.rafId = requestAnimationFrame(rafLoop);

  if (now - lastTick >= TICK_INTERVAL) {
    lastTick = now;

    tickMetrics();
    tickChart();
    tickAgents();
    renderAgentTable();
    tickGauges();
    appendFeedItem();
  }

  // Chart draws every frame for smooth resize but only when panel is visible
  if (state.activePanel === 'dashboard') {
    drawChart();
  }
}

// ---------------------------------------------------------------------------
// Application bootstrap
// ---------------------------------------------------------------------------

function startApplication() {
  // Seed initial data
  state.agents = generateAgents(8);
  tickMetrics();
  tickGauges();
  renderAgentTable();

  initChart();
  initFeedControls();
  initTerminal();
  initShare();

  // Initial feed entries
  for (let i = 0; i < 12; i++) appendFeedItem();

  // Start the rAF loop
  state.rafId = requestAnimationFrame(rafLoop);
}

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

function init() {
  initNav();
  initClock();

  // Open the boot dialog as a true modal (focus-trapped, top-layer)
  if (!dom.bootOverlay.open) {
    dom.bootOverlay.showModal();
  }
  runBootSequence();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    state.timers.forEach(clearInterval);
    if (state.rafId) cancelAnimationFrame(state.rafId);
  });
}

// Run after DOM is ready (script is loaded as type="module" — deferred by default)
init();
