import { hideModal, showModal } from './modals.js';
import { esc, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// UPDATER (electron-updater driven from the top-bar pill + Settings)
// ─────────────────────────────────────────────────────────────────────────────
// Flow: the main process auto-checks (startup + periodically). When a newer
// version exists, a "⬇ Update available" pill appears in the top bar. Clicking it
// opens a "What's New" modal (release notes) with a Download & Install button;
// the download runs with a progress bar and, once finished, the app restarts to
// install automatically. The Settings → Updates panel mirrors the same controls.
export const updaterUI = {
  current: null,        // installed version
  latest: null,         // available version
  releaseNotes: '',     // changelog text for `latest`
  releaseDate: '',
  downloading: false,
  downloaded: false,    // an update is downloaded and ready to install
  autoInstall: false,   // restart-to-install automatically once downloaded
};

// electron-updater's releaseNotes is either a string (the GitHub release body)
// or an array of { version, note }. Normalize to plain text.
function normalizeNotes(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) {
    return notes.map(n => (n && n.note ? `v${n.version}\n${n.note}` : '')).filter(Boolean).join('\n\n');
  }
  return String(notes).trim();
}

// ── Status / progress (shared by the Settings panel and the What's New modal) ─
export function setUpdStatus(text, color) {
  for (const id of ['upd-status', 'wn-status']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = text || '';
    el.style.color = color || 'var(--text-muted)';
  }
}
export function showUpdProgress(show) {
  for (const id of ['upd-progress-wrap', 'wn-progress-wrap']) {
    const w = document.getElementById(id);
    if (w) w.style.display = show ? 'block' : 'none';
  }
}
export function setUpdProgress(percent, transferred, total, bps) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  const kbps = bps ? `${(bps / 1024).toFixed(0)} KB/s` : '';
  const text = total ? `${mb(transferred)} / ${mb(total)} MB${kbps ? ' · ' + kbps : ''}` : '';
  for (const [barId, txtId] of [['upd-progress-bar', 'upd-progress-text'], ['wn-progress-bar', 'wn-progress-text']]) {
    const bar = document.getElementById(barId);
    const txt = document.getElementById(txtId);
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;
    if (txt) txt.textContent = text;
  }
  if (updaterUI.downloading) renderUpdatePill('downloading', `${pct.toFixed(0)}%`);
}

// ── Top-bar pill ─────────────────────────────────────────────────────────────
// state: 'hidden' | 'available' | 'downloading' | 'ready'
export function renderUpdatePill(state, label) {
  const pill = document.getElementById('update-pill');
  if (!pill) return;
  pill.classList.remove('ready', 'downloading');
  if (state === 'hidden') { pill.style.display = 'none'; pill.dataset.state = 'hidden'; return; }
  pill.style.display = 'inline-flex';
  pill.dataset.state = state;
  if (state === 'available') {
    pill.textContent = label || `Update${updaterUI.latest ? ' v' + updaterUI.latest : ''}`;
    pill.title = 'A new version is available — click to see what\'s new and install';
  } else if (state === 'downloading') {
    pill.classList.add('downloading');
    pill.textContent = label || 'Downloading…';
    pill.title = 'Downloading the update…';
  } else if (state === 'ready') {
    pill.classList.add('ready');
    pill.textContent = label || 'Restart to update';
    pill.title = 'Update downloaded — click to restart and install';
  }
}

// Attached once at startup (init in main.js). Click behavior depends on state.
export async function wireUpdateBadge() {
  const pill = document.getElementById('update-pill');
  if (!pill || pill.dataset.bound) return;
  pill.dataset.bound = '1';
  // Fetch the installed version up front so the What's New modal never shows
  // "v?" when opened from the pill before the Settings panel has been visited.
  if (!updaterUI.current) {
    try { updaterUI.current = await window.api.app.version(); } catch {}
  }
  pill.addEventListener('click', () => {
    const state = pill.dataset.state;
    if (state === 'ready') installUpdate();
    else if (state === 'available') showWhatsNewModal();
    // 'downloading' → no-op
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────
export async function startUpdateDownload(autoInstall) {
  if (updaterUI.downloading) return;
  if (updaterUI.downloaded) { if (autoInstall) installUpdate(); return; }
  updaterUI.downloading = true;
  updaterUI.autoInstall = !!autoInstall;
  renderUpdatePill('downloading', '0%');
  setUpdStatus(`Downloading v${updaterUI.latest || ''}…`);
  showUpdProgress(true);
  setUpdProgress(0, 0, 0, 0);
  const dlBtn = document.getElementById('cfg-download-update');
  if (dlBtn) dlBtn.disabled = true;
  const wnBtn = document.getElementById('wn-download');
  if (wnBtn) { wnBtn.disabled = true; wnBtn.textContent = 'Downloading…'; }
  const r = await window.api.updater.download();
  if (r && !r.ok && r.error) {
    updaterUI.downloading = false;
    setUpdStatus(`Download failed: ${r.error}`, '#f87171');
    renderUpdatePill('available');
    if (dlBtn) dlBtn.disabled = false;
    if (wnBtn) { wnBtn.disabled = false; wnBtn.textContent = 'Download & Install'; }
  }
}
export async function installUpdate() {
  await window.api.updater.install();
}

// ── "What's New" modal ─────────────────────────────────────────────────────
export function showWhatsNewModal() {
  const v = updaterUI.latest ? `v${updaterUI.latest}` : 'New version';
  const date = updaterUI.releaseDate ? new Date(updaterUI.releaseDate).toLocaleDateString() : '';
  const ready = updaterUI.downloaded;
  showModal(`
    <h2 style="margin:0 0 4px">What's New — ${esc(v)}</h2>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:14px">
      ${esc(date)}${date ? ' · ' : ''}You have v${esc(updaterUI.current || '?')}
    </div>
    <div class="whatsnew-notes">${esc(updaterUI.releaseNotes || '')}</div>
    <div id="wn-status" style="margin-top:12px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
    <div id="wn-progress-wrap" style="display:none;margin-top:4px">
      <div style="background:#222;border-radius:4px;height:8px;overflow:hidden">
        <div id="wn-progress-bar" style="background:var(--accent);height:100%;width:0%;transition:width .2s"></div>
      </div>
      <div id="wn-progress-text" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="wn-later">Later</button>
      <button class="btn btn-primary" id="wn-download">${ready ? 'Restart &amp; Install' : 'Download &amp; Install'}</button>
    </div>`);
  document.getElementById('wn-later')?.addEventListener('click', hideModal);
  document.getElementById('wn-download')?.addEventListener('click', () => {
    if (updaterUI.downloaded) installUpdate();
    else startUpdateDownload(true);
  });
  // If a download is already running when the modal opens, reflect it.
  if (updaterUI.downloading) { showUpdProgress(true); setUpdStatus(`Downloading v${updaterUI.latest || ''}…`); }
}

// ── Settings → Updates panel ──────────────────────────────────────────────────
export async function wireUpdaterUI() {
  try {
    updaterUI.current = await window.api.app.version();
    const cur = document.getElementById('upd-current');
    if (cur) cur.textContent = `Current version: v${updaterUI.current}`;
  } catch {}

  const checkBtn    = document.getElementById('cfg-check-updates');
  const downloadBtn = document.getElementById('cfg-download-update');
  const installBtn  = document.getElementById('cfg-install-update');
  const notesBtn    = document.getElementById('cfg-whats-new');

  // Reflect any update we already know about this session.
  if (updaterUI.latest && !updaterUI.downloaded) {
    setUpdStatus(`Update available: v${updaterUI.latest}`, '#4ade80');
    if (downloadBtn) downloadBtn.style.display = 'inline-block';
    if (notesBtn) notesBtn.style.display = 'inline-block';
  } else if (updaterUI.downloaded) {
    setUpdStatus(`v${updaterUI.latest} downloaded. Restart to install.`, '#4ade80');
    if (installBtn) installBtn.style.display = 'inline-block';
    if (notesBtn) notesBtn.style.display = 'inline-block';
  }

  if (checkBtn) checkBtn.addEventListener('click', async () => {
    setUpdStatus('Checking for updates…');
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (installBtn)  installBtn.style.display  = 'none';
    showUpdProgress(false);
    const r = await window.api.updater.check();
    if (r && r.devMode) {
      setUpdStatus('Update checks only work in the installed app, not in dev mode.', '#fbbf24');
    } else if (r && !r.ok && r.error) {
      setUpdStatus(`Error: ${r.error}`, '#f87171');
    }
  });

  if (downloadBtn) downloadBtn.addEventListener('click', () => startUpdateDownload(false));
  if (notesBtn)    notesBtn.addEventListener('click', showWhatsNewModal);

  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!confirm('Restart the app now to install the update?')) return;
    await installUpdate();
  });
}

// ── One-time global listener for updater events from the main process. ────────
// The pill/Settings/modal may or may not be present, so every lookup is guarded.
if (window.api && window.api.updater && !window.__updaterBound) {
  window.__updaterBound = true;
  window.api.updater.onEvent(({ event, payload }) => {
    switch (event) {
      case 'checking':
        setUpdStatus('Checking for updates…');
        break;
      case 'available': {
        const isNew = updaterUI.latest !== payload.version;
        updaterUI.latest = payload.version;
        updaterUI.releaseNotes = normalizeNotes(payload.releaseNotes);
        updaterUI.releaseDate = payload.releaseDate || '';
        if (isNew && !updaterUI.downloaded) {
          toast(`Update v${payload.version} available — click the update button up top`, 'info', 6000);
        }
        if (!updaterUI.downloading && !updaterUI.downloaded) renderUpdatePill('available');
        setUpdStatus(`Update available: v${payload.version}`, '#4ade80');
        const dl = document.getElementById('cfg-download-update');
        if (dl) dl.style.display = 'inline-block';
        const wn = document.getElementById('cfg-whats-new');
        if (wn) wn.style.display = 'inline-block';
        break;
      }
      case 'not-available':
        setUpdStatus(`You're on the latest version (v${updaterUI.current || payload.version}).`, '#4ade80');
        if (!updaterUI.downloaded) renderUpdatePill('hidden');
        break;
      case 'progress':
        showUpdProgress(true);
        setUpdProgress(payload.percent, payload.transferred, payload.total, payload.bytesPerSecond);
        break;
      case 'downloaded': {
        updaterUI.downloading = false;
        updaterUI.downloaded = true;
        showUpdProgress(false);
        const dlb = document.getElementById('cfg-download-update');
        if (dlb) dlb.style.display = 'none';
        const ib = document.getElementById('cfg-install-update');
        if (ib) ib.style.display = 'inline-block';
        if (updaterUI.autoInstall) {
          renderUpdatePill('ready', 'Restarting…');
          setUpdStatus(`v${payload.version} downloaded — restarting to install…`, '#4ade80');
          toast(`Update v${payload.version} downloaded — restarting…`, 'success', 4000);
          setTimeout(() => installUpdate(), 1400);
        } else {
          renderUpdatePill('ready');
          setUpdStatus(`v${payload.version} downloaded. Restart to install.`, '#4ade80');
          toast(`Update v${payload.version} ready — click Restart to update`, 'success', 6000);
        }
        break;
      }
      case 'error':
        updaterUI.downloading = false;
        showUpdProgress(false);
        setUpdStatus(`Error: ${payload.message}`, '#f87171');
        if (updaterUI.latest && !updaterUI.downloaded) renderUpdatePill('available');
        break;
    }
  });
}
