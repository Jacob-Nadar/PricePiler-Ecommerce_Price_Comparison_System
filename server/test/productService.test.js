const test = require('node:test');
const assert = require('node:assert/strict');
const {
  searchStore,
  searchProducts,
  searchCategoryProducts,
} = require('../services/productService');
const adapters = require('../adapters');

test('store search shares concurrent requests for the same query', async () => {
  let calls = 0;
  const adapter = {
    slug: 'test-concurrent-store',
    store: { name: 'Test Store' },
    async search() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [{ name: 'Apple iPhone 15 128GB' }];
    },
  };

  const results = await Promise.all([
    searchStore(adapter, 'Apple iPhone 15 128GB'),
    searchStore(adapter, 'Apple iPhone 15 128GB'),
  ]);

  assert.equal(calls, 1);
  assert.equal(results[0].item.name, results[1].item.name);
});

test('store search caches successful results for repeated queries', async () => {
  let calls = 0;
  const adapter = {
    slug: 'test-cache-store',
    store: { name: 'Test Store' },
    async search() {
      calls += 1;
      return [{ name: 'Apple iPhone 15 128GB' }];
    },
  };

  const first = await searchStore(adapter, 'Apple iPhone 15 128GB');
  const second = await searchStore(adapter, 'Apple iPhone 15 128GB');

  assert.equal(calls, 1);
  assert.equal(first.checkedAt, second.checkedAt);
});

test('store search pauses retries after an upstream error', async () => {
  let calls = 0;
  const adapter = {
    slug: 'test-cooldown-store',
    store: { name: 'Test Store' },
    async search() {
      calls += 1;
      throw Object.assign(new Error('upstream unavailable'), { status: 503 });
    },
  };

  await assert.rejects(searchStore(adapter, 'first product'), /Test Store is temporarily unavailable \(HTTP 503\)/);
  await assert.rejects(searchStore(adapter, 'different product'), /Retrying in about 60 seconds/);
  assert.equal(calls, 1);
});

test('product search returns multiple matching live listings rather than only the best item', async () => {
  const original = {
    ensureLoaded: adapters.ensureLoaded,
    getAdapters: adapters.getAdapters,
    getLiveAdapters: adapters.getLiveAdapters,
  };
  const adapter = {
    slug: 'test-multiple-listings',
    store: { id: 9091, name: 'Test Store', slug: 'test-multiple-listings' },
    isAvailable: () => true,
    async search() {
      return [
        { id: 'tomato-a', name: 'Fresh Tomato 500 g', brand: 'Farm A', image: '', offers: { 'test-multiple-listings': { price: 40, availability: 'in_stock', url: 'https://example.com/a' } } },
        { id: 'tomato-b', name: 'Organic Tomatoes 500 g', brand: 'Farm B', image: '', offers: { 'test-multiple-listings': { price: 55, availability: 'in_stock', url: 'https://example.com/b' } } },
        { id: 'onion-a', name: 'Red Onion 1 kg', brand: 'Farm A', image: '', offers: { 'test-multiple-listings': { price: 35, availability: 'in_stock', url: 'https://example.com/c' } } },
      ];
    },
  };
  adapters.ensureLoaded = async () => {};
  adapters.getAdapters = () => [adapter];
  adapters.getLiveAdapters = () => [adapter];

  try {
    const { results } = await searchProducts('tomato');
    assert.equal(results.length, 2);
    assert.ok(results.some((product) => product.brand === 'Farm A'));
    assert.ok(results.some((product) => product.brand === 'Farm B'));
  } finally {
    adapters.ensureLoaded = original.ensureLoaded;
    adapters.getAdapters = original.getAdapters;
    adapters.getLiveAdapters = original.getLiveAdapters;
  }
});

test('grocery category returns common grocery items with offers from both marketplaces when matched', async () => {
  const original = {
    ensureLoaded: adapters.ensureLoaded,
    getAdapters: adapters.getAdapters,
    getLiveAdapters: adapters.getLiveAdapters,
  };
  const stores = [
    { slug: 'test-grocery-amazon', store: { id: 9092, name: 'Amazon India', slug: 'test-grocery-amazon' } },
    { slug: 'test-grocery-flipkart', store: { id: 9093, name: 'Flipkart', slug: 'test-grocery-flipkart' } },
  ].map((store) => ({
    ...store,
    isAvailable: () => true,
    async search(query) {
      const itemName = query === 'tomato' ? 'Fresh Tomato 500 g' : 'Basmati Rice 1 kg';
      return [{
        id: `${store.slug}-${query}`,
        name: itemName,
        brand: '',
        image: '',
        specifications: {},
        offers: {
          [store.slug]: {
            price: query === 'tomato' ? 40 : 120,
            availability: 'in_stock',
            url: `https://example.com/${store.slug}/${query}`,
          },
        },
      }];
    },
  }));
  adapters.ensureLoaded = async () => {};
  adapters.getAdapters = () => stores;
  adapters.getLiveAdapters = () => stores;

  try {
    const { results } = await searchCategoryProducts('Grocery & Pantry');
    const tomato = results.find((product) => /tomato/i.test(product.name));
    const rice = results.find((product) => /rice/i.test(product.name));
    assert.ok(tomato);
    assert.ok(rice);
    assert.deepEqual(
      tomato.offers.map((offer) => offer.storeName).sort(),
      ['Amazon India', 'Flipkart']
    );
  } finally {
    adapters.ensureLoaded = original.ensureLoaded;
    adapters.getAdapters = original.getAdapters;
    adapters.getLiveAdapters = original.getLiveAdapters;
  }
});
