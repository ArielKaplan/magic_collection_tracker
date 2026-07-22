import { beforeEach, describe, expect, it } from 'vitest';
import { hideModal, showModal } from '../src/renderer-js/modals.js';

function classListStub(initial = []) {
  const values = new Set(initial);
  return {
    contains: value => values.has(value),
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
    },
  };
}

let content;
let modal;
let overlay;

beforeEach(() => {
  content = { innerHTML: '' };
  modal = { classList: classListStub() };
  overlay = {
    classList: classListStub(['hidden']),
    querySelector: selector => selector === '.modal' ? modal : null,
  };
  globalThis.document = {
    getElementById: id => id === 'modal-content' ? content : id === 'modal-overlay' ? overlay : null,
    querySelector: selector => selector === '#modal-overlay .modal' ? modal : null,
  };
});

describe('card-sized modal', () => {
  it('uses the dedicated card layout without leaking other modal sizes', () => {
    showModal('<p>Card details</p>', 'card');

    expect(content.innerHTML).toBe('<p>Card details</p>');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(modal.classList.contains('modal-card')).toBe(true);
    expect(modal.classList.contains('modal-wide')).toBe(false);
    expect(modal.classList.contains('modal-xl')).toBe(false);
    expect(modal.classList.contains('modal-settings')).toBe(false);
  });

  it('clears the card layout when the modal closes', () => {
    showModal('<p>Card details</p>', 'card');
    hideModal();

    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(modal.classList.contains('modal-card')).toBe(false);
  });
});
