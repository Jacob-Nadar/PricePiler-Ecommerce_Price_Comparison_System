const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareOffers,
  matchProductToOffers,
  matchesRequestedSpecifications,
  sameProduct,
  sameVariant,
} = require('../services/comparisonService');
const { extractSpecsFromString } = require('../utils/productUtils');

test('unknown stock is not described as confirmed out of stock', () => {
  const result = compareOffers([
    { storeSlug: 'flipkart', availability: 'unknown', price: 36999 },
  ]);

  assert.equal(result.hasInStock, false);
  assert.match(result.noInStockReason, /No confirmed in-stock offer/);
  assert.doesNotMatch(result.noInStockReason, /out of stock/i);
});

test('only confirmed out-of-stock listings are described as out of stock', () => {
  const result = compareOffers([
    { storeSlug: 'amazon_in', availability: 'out_of_stock', price: null },
    { storeSlug: 'flipkart', availability: 'out_of_stock', price: null },
  ]);

  assert.match(result.noInStockReason, /out of stock at all matched stores/i);
});

test('requested RAM and storage match Motorola Edge listing formats', () => {
  const requested = { specifications: { ram: '6GB', storage: '128 GB' } };
  const correctOffer = {
    name: 'Motorola Edge 70 Fusion 5G (6 GB RAM, 128 GB)',
    specifications: {},
  };

  assert.equal(matchesRequestedSpecifications(requested, correctOffer), true);
});

test('requested specifications reject different or unverified listing variants', () => {
  const requested = { specifications: { ram: '6GB', storage: '128GB' } };
  assert.equal(
    matchesRequestedSpecifications(requested, {
      name: 'Motorola Edge 70 Fusion 5G 8GB RAM 128GB',
      specifications: {},
    }),
    false
  );
  assert.equal(
    matchesRequestedSpecifications(requested, {
      name: 'Motorola Edge 70 Fusion 5G 6GB RAM',
      specifications: {},
    }),
    false
  );
});

test('product comparison only returns offers matching every requested specification', () => {
  const { candidates } = matchProductToOffers(
    {
      name: 'Motorola Edge 70 Fusion',
      brand: 'Motorola',
      specifications: { ram: '6GB', storage: '128GB' },
    },
    [
      {
        name: 'Motorola Edge 70 Fusion 5G 6 GB RAM 128 GB',
        brand: 'Motorola',
        specifications: {},
      },
      {
        name: 'Motorola Edge 70 Fusion 5G 8 GB RAM 128 GB',
        brand: 'Motorola',
        specifications: {},
      },
    ]
  );

  assert.equal(candidates.length, 1);
  assert.match(candidates[0].name, /6 GB RAM/);
});

test('product comparison ignores color differences but preserves RAM and storage variants', () => {
  const requested = {
    name: 'Samsung Galaxy A55',
    brand: 'Samsung',
    specifications: { color: 'Navy', ram: '8GB', storage: '256GB' },
  };
  const { candidates } = matchProductToOffers(requested, [
    {
      name: 'Samsung Galaxy A55 8GB RAM 256GB',
      brand: 'Samsung',
      specifications: { color: 'Iceblue', ram: '8GB', storage: '256GB' },
    },
    {
      name: 'Samsung Galaxy A55 8GB RAM 256GB',
      brand: 'Samsung',
      specifications: { color: 'Lilac', ram: '8GB', storage: '256GB' },
    },
    {
      name: 'Samsung Galaxy A55 12GB RAM 256GB',
      brand: 'Samsung',
      specifications: { color: 'Navy', ram: '12GB', storage: '256GB' },
    },
  ]);

  assert.equal(candidates.length, 2);
});

test('Nothing Phone 4a retailer titles with different detail merge as the same RAM/storage variant', () => {
  const amazon = {
    name: 'Nothing Phone (4a) (Black, 128 GB)',
    brand: 'Nothing',
    specifications: extractSpecsFromString('Nothing Phone (4a) (Black, 128 GB)'),
  };
  const flipkart = {
    name: 'Phone (4a) 5G (Black, 8GB RAM, 128GB Storage) | Snapdragon 7s Gen 4 | 6.78" AMOLED 120Hz Display | 50MP Triple Camera | 5400mAh Battery | 50W Fast Charging',
    brand: '',
    specifications: extractSpecsFromString(
      'Phone (4a) 5G (Black, 8GB RAM, 128GB Storage) | Snapdragon 7s Gen 4'
    ),
  };

  assert.equal(sameProduct(amazon, flipkart), true);
  assert.equal(sameVariant(amazon, flipkart), true);
  assert.equal(
    sameVariant({
      ...amazon,
      specifications: { ...amazon.specifications, ram: '8GB' },
    }, {
      ...flipkart,
      specifications: { ...flipkart.specifications, ram: '12GB' },
    }),
    false
  );
});
