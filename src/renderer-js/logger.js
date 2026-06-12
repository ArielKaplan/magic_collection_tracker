import { render } from './render.js';
import { esc } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOGGER — circular buffer feeds the slide-in panel in the status bar
// ─────────────────────────────────────────────────────────────────────────────
export const LOG_BUFFER_SIZE = 500;
export const logBuffer = [];
export let logsPanelOpen = false;
export let logsUnread = 0;

export function logEntry(level, category, message, details) {
  const entry = { t: new Date(), level, category, message, details: details ?? null };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  if (!logsPanelOpen) logsUnread++;
  updateLogsButton();
  if (logsPanelOpen) renderLogPanel();
  // Mirror to devtools console for power users
  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[fn](`[${category}] ${message}`, details ?? '');
}

window.logger = {
  info:    (cat, msg, det) => logEntry('info', cat, msg, det),
  success: (cat, msg, det) => logEntry('success', cat, msg, det),
  warn:    (cat, msg, det) => logEntry('warn', cat, msg, det),
  error:   (cat, msg, det) => logEntry('error', cat, msg, det),
  debug:   (cat, msg, det) => logEntry('debug', cat, msg, det),
  clear:   () => { logBuffer.length = 0; logsUnread = 0; updateLogsButton(); renderLogPanel(); },
  all:     () => logBuffer.slice(),
};

export function updateLogsButton() {
  const el = document.getElementById('sb-logs-count');
  if (!el) return;
  el.textContent = logsUnread > 0 ? logsUnread > 99 ? '99+' : String(logsUnread) : '';
  el.style.display = logsUnread > 0 ? '' : 'none';
}

export function closeLogPanel() {
  if (logsPanelOpen) toggleLogPanel();
}

export function toggleLogPanel() {
  logsPanelOpen = !logsPanelOpen;
  const panel = document.getElementById('logs-panel');
  if (!panel) return;
  panel.classList.toggle('open', logsPanelOpen);
  if (logsPanelOpen) {
    logsUnread = 0;
    updateLogsButton();
    renderLogPanel();
    // Auto-scroll to newest after render
    setTimeout(() => {
      const body = document.getElementById('logs-body');
      if (body) body.scrollTop = body.scrollHeight;
    }, 30);
  }
}

export function renderLogPanel() {
  const body = document.getElementById('logs-body');
  if (!body) return;
  if (logBuffer.length === 0) {
    body.innerHTML = `<div class="logs-empty">No activity logged yet. Run a price refresh, CSV import, or Secret Lair refresh and progress will appear here.</div>`;
    return;
  }
  body.innerHTML = logBuffer.map(e => {
    const t = e.t.toLocaleTimeString([], { hour12: false });
    const detailHtml = e.details
      ? `<div class="log-det">${esc(typeof e.details === 'string' ? e.details : JSON.stringify(e.details))}</div>`
      : '';
    return `<div class="log-entry log-${e.level}">
      <span class="log-t">${t}</span>
      <span class="log-cat">${esc(e.category)}</span>
      <span class="log-msg">${esc(e.message)}</span>
      ${detailHtml}
    </div>`;
  }).join('');
}

