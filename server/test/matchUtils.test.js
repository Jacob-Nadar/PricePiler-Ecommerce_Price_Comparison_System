const test = require('node:test');
const assert = require('node:assert/strict');
const { matchScore, pickBestMatch } = require('../utils/matchUtils');

test('product matching uses whole tokens and honors storage variants', () => {
  assert.ok(matchScore('iPhone 15 128GB', 'Apple iPhone 15 128GB') > 0.9);
  assert.equal(matchScore('iPhone 15 128GB', 'Apple iPhone 15 256GB'), 0);
  assert.equal(matchScore('Laptop 1TB', 'Laptop 2TB'), 0);
  assert.ok(matchScore('iPhone 15', 'Apple iPhone 150') < 0.55);
});

test('search does not fall back to a weak or conflicting product match', () => {
  assert.equal(
    pickBestMatch('iPhone 15 128GB', [
      { name: 'Apple iPhone 15 256GB' },
      { name: 'Phone case for iPhone 15 128GB' },
    ]),
    null
  );
  assert.equal(pickBestMatch('Galaxy S24 Ultra', [{ name: 'Phone cover Galaxy S24 Ultra' }]), null);
});

test('search excludes unrequested product variants', () => {
  assert.equal(matchScore('Apple iPhone 17', 'Apple iPhone 17 Pro'), 0);
  assert.equal(matchScore('Apple iPhone 17', 'Apple iPhone 17 Pro Max'), 0);
  assert.equal(matchScore('Apple iPhone 17 Pro', 'Apple iPhone 17 Pro Max'), 0);
  assert.ok(matchScore('Apple iPhone 17 Pro', 'Apple iPhone 17 Pro') > 0.9);
  assert.equal(
    pickBestMatch('Apple iPhone 17', [
      { name: 'Apple iPhone 17 Pro' },
      { name: 'Apple iPhone 17 Pro Max' },
    ]),
    null
  );
});

test('Redmi 13C product search excludes phone covers and other accessories', () => {
  for (const title of [
    'Back Cover for Redmi 13C',
    'Redmi 13C Mobile Phone Cover',
    'Protective Case Compatible with Xiaomi Redmi 13C',
    'Tempered Glass Screen Protector for Redmi 13C',
    'Redmi 13C Replacement Display',
  ]) {
    assert.equal(matchScore('Redmi 13C', title), 0, title);
  }
  assert.equal(matchScore('Redmi 13C', 'Xiaomi Redmi 13C 5G Smartphone'), 1);
});

test('Redmi 13C matches an Amazon title that omits the Redmi brand', () => {
  assert.equal(matchScore('Redmi 13C', '13C 5G (Startrail Silver, 4GB RAM, 128GB Storage)'), 1);
  assert.equal(matchScore('Redmi 13C', '13C phone cover'), 0);
  assert.equal(matchScore('Redmi 13C', '13C 5G replacement screen'), 0);
});

test('search rejects products that only partially match a specific product query', () => {
  assert.equal(matchScore('Dettol antiseptic liquid', 'Dettol antiseptic soap'), 0);
  assert.equal(matchScore('Dettol antiseptic liquid', 'Dettol liquid handwash'), 0);
  assert.equal(matchScore('Dettol antiseptic liquid', 'Dettol Antiseptic Liquid 500 ml'), 1);
  assert.equal(matchScore('Dettol antiseptic liquid', 'Dettol Disinfectant Liquid 500 ml'), 1);
  assert.equal(matchScore('Dettol antiseptic liquid', 'Dettol antiseptic'), 0);
});

test('detergent search excludes detergent bars but retains detergent powder listings', () => {
  assert.equal(matchScore('Surf Excel detergent', 'Surf Excel detergent bar'), 0);
  assert.equal(matchScore('Surf Excel detergent', 'Surf Excel detergent cake'), 0);
  assert.equal(matchScore('Surf Excel detergent', 'Surf Excel Matic detergent powder'), 1);
});

test('capacity values do not lower the model-name match score', () => {
  const score = matchScore(
    'Motorola Motorola Edge 70 Fusion 6GB 128GB',
    'Motorola Edge 70 Fusion 5G 6 GB RAM 128 GB'
  );
  assert.ok(score >= 0.8);
});

test('category searches match common plural product names', () => {
  assert.ok(matchScore('tomato', 'Fresh Tomatoes 500 g') >= 0.55);
  assert.ok(matchScore('jeans', 'Men Denim Jean') >= 0.55);
});

test('electronics queries reject apparel and mobile accessories', () => {
  assert.equal(matchScore('Playstation 5', 'Puma x Playstation Youth T-shirt'), 0);
  assert.equal(
    matchScore('Samsung Galaxy S24', 'Luxury Kase Solid Printed Samsung Galaxy S24 Ultra 5G Mobile Accessories'),
    0
  );
  assert.equal(pickBestMatch('Playstation 5', [{ name: 'Puma x Playstation Youth T-shirt' }]), null);
});

test('smartphone spec extraction extracts storage and RAM accurately without keywords', () => {
  const { extractSpecsFromString } = require('../utils/productUtils');
  const iphone = extractSpecsFromString('Apple iPhone 15 (128 GB) - Blue');
  assert.equal(iphone.storage, '128GB');

  const oneplus = extractSpecsFromString('OnePlus 12 (Flowy Emerald, 16GB, 512GB)');
  assert.equal(oneplus.ram, '16GB');
  assert.equal(oneplus.storage, '512GB');
});
