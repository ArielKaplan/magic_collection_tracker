// features.js — local, user-controlled feature visibility.

import { collection, ui } from './state.js';

export function insightsEnabled() {
  return collection.settings?.insightsEnabled === true;
}

export function setInsightsEnabled(enabled) {
  collection.settings = collection.settings || {};
  collection.settings.insightsEnabled = enabled === true;
}

export function localIntelligenceConfigured() {
  return collection.settings?.localIntelligenceEnabled === true;
}

export function localIntelligenceEnabled() {
  return insightsEnabled() && localIntelligenceConfigured();
}

export function setLocalIntelligenceEnabled(enabled) {
  collection.settings = collection.settings || {};
  collection.settings.localIntelligenceEnabled = enabled === true;
}

export function upcomingSecretLairsEnabled() {
  return collection.settings?.upcomingSecretLairsEnabled === true;
}

export function setUpcomingSecretLairsEnabled(enabled) {
  collection.settings = collection.settings || {};
  collection.settings.upcomingSecretLairsEnabled = enabled === true;
}

// Keep optional features absent from normal navigation until enabled. This is
// presentation gating only — no account, entitlement, or security claim.
export function syncFeatureVisibility() {
  const enabled = insightsEnabled();
  const leavingInsights = !enabled && ui.activeTab === 'insights';
  if (!localIntelligenceEnabled() && ui.insights?.view === 'intelligence') ui.insights.view = 'build';
  if (!upcomingSecretLairsEnabled() && ui.slViewer?.view === 'upcoming') {
    ui.slViewer.view = 'drops';
    ui.slViewer.upcomingDrop = '';
  }
  if (leavingInsights) ui.activeTab = 'dashboard';
  if (typeof document !== 'undefined') {
    const tab = document.getElementById('insightsTab');
    if (tab) {
      tab.hidden = !enabled;
      tab.style.display = enabled ? '' : 'none';
      tab.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    if (leavingInsights) {
      document.querySelectorAll?.('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'dashboard'));
    }
  }
  return enabled;
}
