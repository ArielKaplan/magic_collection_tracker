import { afterEach, describe, expect, it } from 'vitest';
import { insightsEnabled, setInsightsEnabled, syncFeatureVisibility } from '../src/renderer-js/features.js';
import { collection, ui } from '../src/renderer-js/state.js';

const originalSettings = { ...collection.settings };
const originalTab = ui.activeTab;

afterEach(() => {
  collection.settings = { ...originalSettings };
  ui.activeTab = originalTab;
  delete globalThis.document;
});

describe('optional feature visibility', () => {
  it('keeps Insights off unless the user explicitly enables it', () => {
    collection.settings = {};
    expect(insightsEnabled()).toBe(false);
    setInsightsEnabled(true);
    expect(insightsEnabled()).toBe(true);
  });

  it('hides the navigation entry and exits Insights when disabled', () => {
    const tab = { hidden: false, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    globalThis.document = { getElementById: id => id === 'insightsTab' ? tab : null, querySelectorAll: () => [] };
    collection.settings = { insightsEnabled: false };
    ui.activeTab = 'insights';
    syncFeatureVisibility();
    expect(tab.hidden).toBe(true);
    expect(tab.style.display).toBe('none');
    expect(tab.attrs['aria-hidden']).toBe('true');
    expect(ui.activeTab).toBe('dashboard');
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
