import { afterEach, describe, expect, it } from 'vitest';
import { insightsEnabled, localIntelligenceConfigured, localIntelligenceEnabled, setInsightsEnabled, setLocalIntelligenceEnabled, setUpcomingSecretLairsEnabled, syncFeatureVisibility, upcomingSecretLairsEnabled } from '../src/renderer-js/features.js';
import { collection, ui } from '../src/renderer-js/state.js';

const originalSettings = { ...collection.settings };
const originalTab = ui.activeTab;
const originalInsightsView = ui.insights.view;
const originalSlView = ui.slViewer.view;
const originalUpcomingDrop = ui.slViewer.upcomingDrop;

afterEach(() => {
  collection.settings = { ...originalSettings };
  ui.activeTab = originalTab;
  ui.insights.view = originalInsightsView;
  ui.slViewer.view = originalSlView;
  ui.slViewer.upcomingDrop = originalUpcomingDrop;
  delete globalThis.document;
});

describe('optional feature visibility', () => {
  it('keeps Insights off unless the user explicitly enables it', () => {
    collection.settings = {};
    expect(insightsEnabled()).toBe(false);
    setInsightsEnabled(true);
    expect(insightsEnabled()).toBe(true);
  });

  it('requires both advanced-feature gates for Local Intelligence', () => {
    collection.settings = {};
    expect(localIntelligenceEnabled()).toBe(false);
    setLocalIntelligenceEnabled(true);
    expect(localIntelligenceConfigured()).toBe(true);
    expect(localIntelligenceEnabled()).toBe(false);
    setInsightsEnabled(true);
    expect(localIntelligenceEnabled()).toBe(true);
  });

  it('keeps Upcoming Secret Lairs off until explicitly enabled and exits its view when disabled', () => {
    collection.settings = {};
    expect(upcomingSecretLairsEnabled()).toBe(false);
    setUpcomingSecretLairsEnabled(true);
    expect(upcomingSecretLairsEnabled()).toBe(true);
    setUpcomingSecretLairsEnabled(false);
    ui.slViewer.view = 'upcoming';
    ui.slViewer.upcomingDrop = 'Future Drop';
    syncFeatureVisibility();
    expect(ui.slViewer.view).toBe('drops');
    expect(ui.slViewer.upcomingDrop).toBe('');
  });

  it('hides the navigation entry and exits Insights when disabled', () => {
    const tab = { hidden: false, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    globalThis.document = { getElementById: id => id === 'insightsTab' ? tab : null, querySelectorAll: () => [] };
    collection.settings = { insightsEnabled: false, localIntelligenceEnabled: true };
    ui.activeTab = 'insights';
    ui.insights.view = 'intelligence';
    syncFeatureVisibility();
    expect(tab.hidden).toBe(true);
    expect(tab.style.display).toBe('none');
    expect(tab.attrs['aria-hidden']).toBe('true');
    expect(ui.activeTab).toBe('dashboard');
    expect(ui.insights.view).toBe('build');
  });

  it('reveals the navigation entry when enabled', () => {
    const tab = { hidden: true, style: { display: 'none' }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    globalThis.document = { getElementById: () => tab };
    collection.settings = { insightsEnabled: true };
    syncFeatureVisibility();
    expect(tab.hidden).toBe(false);
    expect(tab.style.display).toBe('');
    expect(tab.attrs['aria-hidden']).toBe('false');
  });
});
