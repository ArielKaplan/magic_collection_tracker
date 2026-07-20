// Render smoke test for the sectioned Settings workspace.
'use strict';
const noop = () => {};
let markup = '';
const modal = { classList: { toggle: noop, remove: noop } };
const content = {};
Object.defineProperty(content, 'innerHTML', { set: value => { markup = value; }, get: () => markup });
const overlay = { classList: { remove: noop, add: noop }, querySelector: () => modal };

globalThis.window = { addEventListener: noop, api: {} };
globalThis.document = {
  addEventListener: noop,
  getElementById: id => id === 'modal-content' ? content : id === 'modal-overlay' ? overlay : null,
  querySelectorAll: () => [], querySelector: () => null,
  body: { dataset: {} },
};
globalThis.confirm = () => true;

(async () => {
  const { showSettings } = await import('../src/renderer-js/settings.js');
  const { collection } = await import('../src/renderer-js/state.js');
  collection.settings = { pricechartingKey: '', cardTraderToken: '', insightsEnabled: false };
  collection.cards = [];
  collection.savedReports = [{ id: 'r1' }];
  showSettings('features');

  const panelCount = (markup.match(/data-settings-panel=/g) || []).length;
  const checks = {
    sixSections: panelCount === 6,
    focusedFeatures: /settings-panel active" data-settings-panel="features"/.test(markup),
    insightsOptIn: markup.includes('id="cfg-insights-enabled"') && !markup.includes('id="cfg-insights-enabled" checked'),
    preservesReports: markup.includes('1 saved report on this computer'),
    pricingControls: markup.includes('id="cfg-pckey"') && markup.includes('id="cfg-bulk-data"'),
    secretLairControls: markup.includes('id="cfg-msrp-nonfoil"') && markup.includes('showSlDataGuide'),
    dataControls: markup.includes('id="cfg-backup-now"') && markup.includes('id="cfg-reset-all"'),
    actions: markup.includes('id="cfg-cancel"') && markup.includes('id="cfg-save"'),
  };
  console.log(checks);
  if (!Object.values(checks).every(Boolean)) process.exit(1);
  console.log('Settings workspace render smoke tests passed.');
})().catch(err => { console.error(err); process.exit(1); });
