import { describe, it, expect, vi } from 'vitest';

// dispatch.js calls render() inside its ui-set action; stub it so the action
// can run headless without a real DOM.
vi.mock('../src/renderer-js/render.js', () => ({ render: () => {} }));

const mod = await import('../src/renderer-js/dispatch.js');
const { _internals } = mod;
const { getPath, setPath, coerce, ACTIONS } = _internals;
const { ui } = await import('../src/renderer-js/state.js');

describe('coerce (data attribute → value)', () => {
  it('keeps empty string', () => expect(coerce('')).toBe(''));
  it('parses integers (so page resets are numbers, not strings)', () => {
    expect(coerce('0')).toBe(0);
    expect(coerce('12')).toBe(12);
  });
  it('parses booleans', () => {
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
  });
  it('leaves other strings alone', () => {
    expect(coerce('drops')).toBe('drops');
    expect(coerce('table_desc')).toBe('table_desc');
  });
});

describe('getPath / setPath (nested ui paths)', () => {
  it('round-trips a nested value', () => {
    const o = { a: { b: { c: 1 } } };
    setPath(o, 'a.b.c', 9);
    expect(getPath(o, 'a.b.c')).toBe(9);
  });
});

describe('ui-set action', () => {
  it('sets the primary path + sibling paths, coercing the page reset to a number', () => {
    ui.slViewer.view = 'x'; ui.slViewer.drop = 'old'; ui.slViewer.page = 5;
    ACTIONS['ui-set']({ dataset: { path: 'slViewer.view', val: 'drops', also: 'slViewer.drop=;slViewer.page=0' } });
    expect(ui.slViewer.view).toBe('drops');
    expect(ui.slViewer.drop).toBe('');
    expect(ui.slViewer.page).toBe(0);      // number, not '0'
  });
  it('reads a checkbox state when no data-val is given', () => {
    ui.precons.showJumpstart = false;
    ACTIONS['ui-set']({ type: 'checkbox', checked: true, dataset: { path: 'precons.showJumpstart' } });
    expect(ui.precons.showJumpstart).toBe(true);
  });
  it('reads an input value when no data-val is given', () => {
    ACTIONS['ui-set']({ value: 'goblin', dataset: { path: 'precons.search' } });
    expect(ui.precons.search).toBe('goblin');
  });
});

describe('ui-inc / ui-toggle', () => {
  it('increments a page', () => {
    ui.slViewer.page = 2;
    ACTIONS['ui-inc']({ dataset: { path: 'slViewer.page' } });
    expect(ui.slViewer.page).toBe(3);
  });
  it('toggles a boolean', () => {
    ui.wantList.groupByDrop = false;
    ACTIONS['ui-toggle']({ dataset: { path: 'wantList.groupByDrop' } });
    expect(ui.wantList.groupByDrop).toBe(true);
  });
});
