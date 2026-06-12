import { toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// UPDATER (electron-updater driven from Settings)
// ─────────────────────────────────────────────────────────────────────────────
export const updaterUI = { current: null, latest: null, downloading: false };

export function setUpdStatus(text, color) {
  const el = document.getElementById('upd-status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = color || 'var(--text-muted)';
}
export function showUpdProgress(show) {
  const w = document.getElementById('upd-progress-wrap');
  if (w) w.style.display = show ? 'block' : 'none';
}
export function setUpdProgress(percent, transferred, total, bps) {
  const bar = document.getElementById('upd-progress-bar');
  const txt = document.getElementById('upd-progress-text');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent || 0)).toFixed(1)}%`;
  if (txt) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    const kbps = bps ? `${(bps / 1024).toFixed(0)} KB/s` : '';
    txt.textContent = total
      ? `${mb(transferred)} / ${mb(total)} MB${kbps ? ' · ' + kbps : ''}`
      : '';
  }
}

export async function wireUpdaterUI() {
  // Current version
  try {
    updaterUI.current = await window.api.app.version();
    const cur = document.getElementById('upd-current');
    if (cur) cur.textContent = `Current version: v${updaterUI.current}`;
  } catch {}

  const checkBtn    = document.getElementById('cfg-check-updates');
  const downloadBtn = document.getElementById('cfg-download-update');
  const installBtn  = document.getElementById('cfg-install-update');

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

  if (downloadBtn) downloadBtn.addEventListener('click', async () => {
    if (updaterUI.downloading) return;
    updaterUI.downloading = true;
    downloadBtn.disabled = true;
    setUpdStatus(`Downloading v${updaterUI.latest || ''}…`);
    showUpdProgress(true);
    setUpdProgress(0, 0, 0, 0);
    const r = await window.api.updater.download();
    if (r && !r.ok && r.error) {
      setUpdStatus(`Download failed: ${r.error}`, '#f87171');
      updaterUI.downloading = false;
      downloadBtn.disabled = false;
    }
  });

  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!confirm('Restart the app now to install the update?')) return;
    await window.api.updater.install();
  });
}

// One-time global listener for updater events from the main process.
// Settings modal may not be open, so we guard every DOM lookup.
if (window.api && window.api.updater && !window.__updaterBound) {
  window.__updaterBound = true;
  window.api.updater.onEvent(({ event, payload }) => {
    switch (event) {
      case 'checking':
        setUpdStatus('Checking for updates…');
        break;
      case 'available':
        // Only toast once per session per version (startup check + Settings click
        // would otherwise double-toast).
        if (updaterUI.latest !== payload.version) {
          toast(`Update v${payload.version} available — open Settings to download`, 'info', 6000);
        }
        updaterUI.latest = payload.version;
        setUpdStatus(`Update available: v${payload.version}`, '#4ade80');
        const dl = document.getElementById('cfg-download-update');
        if (dl) dl.style.display = 'inline-block';
        break;
      case 'not-available':
        setUpdStatus(`You're on the latest version (v${updaterUI.current || payload.version}).`, '#4ade80');
        break;
      case 'progress':
        showUpdProgress(true);
        setUpdProgress(payload.percent, payload.transferred, payload.total, payload.bytesPerSecond);
        break;
      case 'downloaded':
        updaterUI.downloading = false;
        showUpdProgress(false);
        setUpdStatus(`v${payload.version} downloaded. Restart to install.`, '#4ade80');
        const dlb = document.getElementById('cfg-download-update');
        if (dlb) dlb.style.display = 'none';
        const ib = document.getElementById('cfg-install-update');
        if (ib) ib.style.display = 'inline-block';
        toast(`Update v${payload.version} ready — restart to install`, 'success', 6000);
        break;
      case 'error':
        updaterUI.downloading = false;
        showUpdProgress(false);
        setUpdStatus(`Error: ${payload.message}`, '#f87171');
        break;
    }
  });
}

