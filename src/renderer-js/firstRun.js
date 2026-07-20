// firstRun.js — the first-five-minutes onboarding.
//
// A friend's first launch lands them in an empty app with no idea what it is
// or what to do — the biggest adoption leak. This shows a one-screen welcome
// on a genuinely fresh install (no cards + no first_run_done flag): what the
// app is, then the one action that matters (import your collection), with a
// restore option for someone migrating machines. Persisted so it never nags.

import { showImportHub } from './importWizard.js';
import { hideModal, showModal } from './modals.js';
import { showSettings } from './settings.js';
import { collection } from './state.js';

const FLAG = 'first_run_done';

async function markDone() {
  try { await window.api?.settings?.set(FLAG, '1'); } catch { /* non-fatal */ }
}

// Shown only when the collection is empty AND the flag is unset — so it appears
// once on a fresh install and never again (even if the user later empties it).
export async function maybeShowFirstRun() {
  try {
    if ((collection.cards || []).length > 0) return;
    if (await window.api?.settings?.get(FLAG)) return;
  } catch { return; }
  showFirstRun();
}

export function showFirstRun() {
  showModal(`
    <div style="text-align:center;padding:6px 4px 2px">
      <div style="font-size:30px;margin-bottom:6px">📦✨</div>
      <h2 style="margin:0 0 6px">Welcome to Mana Ledger</h2>
      <p style="color:var(--text-muted);font-size:13.5px;line-height:1.6;max-width:450px;margin:0 auto">
        Track your Magic collection with a focus on <strong style="color:var(--text)">Secret Lair</strong> drops and
        <strong style="color:var(--text)">preconstructed decks</strong> — see what you own, what a drop or precon is
        worth, and whether it paid off. Everything stays on this computer.
      </p>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;max-width:420px;margin:18px auto 4px">
      <button class="btn btn-primary" id="fr-import" style="padding:11px">↑ Import my collection (CSV)</button>
      <button class="btn" id="fr-restore" style="padding:9px">↺ Restore from a backup</button>
      <button class="btn btn-ghost" id="fr-skip" style="padding:9px">Look around first</button>
    </div>
    <p style="text-align:center;color:var(--text-muted);font-size:11.5px;margin:14px auto 0;max-width:430px;line-height:1.5">
      Export a CSV from the free <strong>ManaBox</strong> app (or a Moxfield / Archidekt export) and import it here.
      You can always import later from <strong>File → Import</strong>.
    </p>`);

  document.getElementById('fr-import')?.addEventListener('click', () => { markDone(); showImportHub('cards'); });
  document.getElementById('fr-restore')?.addEventListener('click', () => { markDone(); showSettings('data'); });
  document.getElementById('fr-skip')?.addEventListener('click', () => { markDone(); hideModal(); });
}
