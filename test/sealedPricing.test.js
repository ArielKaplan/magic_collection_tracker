import { afterEach, describe, expect, it } from 'vitest';
import { collection } from '../src/renderer-js/state.js';
import { fetchPriceChartingById, searchPriceCharting } from '../src/renderer-js/sealedPricing.js';

describe('PriceCharting API contract', () => {
  const oldWindow = globalThis.window;
  const oldToken = collection.settings.pricechartingKey;

  afterEach(() => {
    globalThis.window = oldWindow;
    collection.settings.pricechartingKey = oldToken;
  });

  it('sends the documented t token parameter for search and lookup', async () => {
    const urls = [];
    globalThis.window = { api: { net: { fetch: async url => {
      urls.push(url);
      const body = url.includes('/products')
        ? { status: 'success', products: [] }
        : { status: 'success', 'new-price': 1234 };
      return { ok: true, status: 200, text: JSON.stringify(body) };
    } } } };
    collection.settings.pricechartingKey = 'token with spaces';
    await searchPriceCharting('Secret Lair test');
    await fetchPriceChartingById('42');
    expect(urls[0]).toContain('t=token%20with%20spaces');
    expect(urls[0]).not.toContain('key=');
    expect(urls[1]).toContain('/product?t=token%20with%20spaces&id=42');
  });
});
