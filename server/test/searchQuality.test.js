const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.PRICE_HISTORY_FILE = path.join(os.tmpdir(), `price-history-test-${process.pid}.json`);

const { matchScore, relevanceScore, buildSearchQuery } = require('../utils/matchUtils');
const { cleanListingTitle, parseCount, parseRating, validMrp } = require('../utils/scraperUtils');
const { compareOffers, matchesRequestedSpecifications } = require('../services/comparisonService');
const { trackOffers, offerKey } = require('../services/priceTracker');

test('a model number does not match a measurement in the title', () => {
  assert.equal(
    matchScore('iphone 15', 'iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display, A19 Chip'),
    0
  );
  assert.equal(matchScore('iphone 15', 'iPhone 15 (128 GB) - Black'), 1);
  assert.equal(matchScore('basmati rice 5kg', 'India Gate Basmati Rice Everyday 5 kg'), 1);
});

test('"compatible with" listings are treated as accessories or parts', () => {
  assert.equal(
    matchScore('iphone 15', 'Compatible with iPhone 15 – Original-Quality OLED Screen with Touch Digitizer'),
    0
  );
});

test('earbuds, cases and silicone are only accessories when searching for a device', () => {
  assert.equal(
    matchScore('boat airdopes', 'boAt Airdopes 219, 4Mics ENx, 40H Battery, Bluetooth Earbuds with charging case'),
    1
  );
  assert.equal(matchScore('silicone spatula', 'Silicone Spatula Set heat resistant'), 1);
  assert.equal(matchScore('iphone 15', 'Silicone Case for iPhone 15 with MagSafe'), 0);
  assert.equal(matchScore('redmi 13c', 'Redmi 13C phone case'), 0);
});

test('plural units and nouns match their singular query form', () => {
  assert.equal(matchScore('samsung 55 inch tv', 'Samsung 138 cm (55 inches) Crystal 4K TV'), 1);
});

test('relevance ranks a concise exact title above a keyword-stuffed listing', () => {
  const exact = relevanceScore('running shoes', 'Puma Running Shoes For Men');
  const stuffed = relevanceScore(
    'running shoes',
    'Sports Sneakers for Men Lightweight Gym Walking Training Casual Running Shoes Anti Slip Comfortable'
  );
  assert.ok(exact > stuffed, `${exact} should be > ${stuffed}`);
});

test('long store titles become a concise cross-store query', () => {
  assert.equal(buildSearchQuery('Apple iPhone 15 (128 GB) - Black', 'Apple'), 'Apple iPhone 15');
  assert.equal(
    buildSearchQuery('iPhone 17e 256 GB: 15.40 cm (6.1″) Super Retina XDR Display', 'Apple'),
    'Apple iPhone 17e 256 GB'
  );
});

test('store badge text is stripped from listing titles', () => {
  assert.equal(cleanListingTitle('Sponsored Ad - Boldfit Running Shoes'), 'Boldfit Running Shoes');
  assert.equal(cleanListingTitle('You pay ₹76,249 iPhone 16 128 GB'), 'iPhone 16 128 GB');
  assert.equal(cleanListingTitle('Only 2 left in stock. Kohinoor Basmati Rice'), 'Kohinoor Basmati Rice');
  assert.equal(cleanListingTitle('Daawat Rozana Basmati Rice (Broken Gra...'), 'Daawat Rozana Basmati Rice (Broken Gra');
});

test('rating, review count and MRP parsing', () => {
  assert.equal(parseRating('4.3 out of 5 stars, rating details'), 4.3);
  assert.equal(parseRating('9'), null);
  assert.equal(parseCount('2,49,256 Ratings'), 249256);
  assert.equal(parseCount('1.2K'), 1200);
  assert.equal(validMrp('₹74,900', 67999), 74900);
  assert.equal(validMrp('₹500', 999), null);
});

test('colour, variant text and clothing size do not block a cross-store match', () => {
  const requested = {
    specifications: { color: 'Blue', variant: 'Blue, 128 GB', storage: '128GB', size: 'M', material: 'Aluminium' },
  };
  assert.equal(
    matchesRequestedSpecifications(requested, { name: 'Apple iPhone 15 (Black, 128 GB)', specifications: {} }),
    true
  );
  assert.equal(
    matchesRequestedSpecifications(requested, { name: 'Apple iPhone 15 (Black, 256 GB)', specifications: {} }),
    false
  );
});

test('different pack sizes are not merged into one product', () => {
  const { sameListingProduct, sameVariant } = require('../services/comparisonService');
  const { extractSpecsFromString } = require('../utils/productUtils');
  const listing = (name) => ({
    name,
    brand: 'Dolce Vita',
    offers: [{ storeSlug: 'amazon_in' }],
    specifications: extractSpecsFromString(name),
  });
  const big = listing('Dolce Vita Pomodori Pelati Peeled Tomatoes, 2.5kg');
  const small = listing('Dolce Vita Pomodori Pelati Peeled Tomatoes, 400g');
  assert.equal(big.specifications.quantity, '2500 g');
  assert.equal(sameListingProduct(big, small, 'tomato') && sameVariant(big, small), false);
  assert.equal(extractSpecsFromString('Tata Salt 1 kg').quantity, extractSpecsFromString('Tata Salt 1000g').quantity);
});

test('generic query words do not merge different models of one brand', () => {
  const { sameListingProduct } = require('../services/comparisonService');
  const hurricane = { name: 'CAMPUS HURRICANE Running Shoes For Men', brand: 'CAMPUS', offers: [{ storeSlug: 'flipkart' }] };
  const mike = { name: 'CAMPUS MIKE (N) Running Shoes For Men', brand: 'CAMPUS', offers: [{ storeSlug: 'flipkart' }] };
  const amazonHurricane = { name: 'Campus Men Hurricane Running Shoes', brand: 'Campus', offers: [{ storeSlug: 'amazon_in' }] };
  assert.equal(sameListingProduct(hurricane, mike, 'running shoes'), false);
  assert.equal(sameListingProduct(hurricane, amazonHurricane, 'running shoes'), true);
});

test('listings with different model numbers are not merged', () => {
  const { sameListingProduct } = require('../services/comparisonService');
  const amazon = {
    name: 'boAt 2026 Launch Airdopes Prime 800D, Surround Sound, 45H Battery, Quad Mic, 11mm Drivers, TWS Earbuds',
    brand: 'boAt',
    offers: [{ storeSlug: 'amazon_in', price: 1399 }],
  };
  const myntra = { name: 'boAt Airdopes Prime 413 TWS Earbuds', brand: 'boAt', offers: [{ storeSlug: 'myntra', price: 1059 }] };
  const myntraSame = { name: 'boAt Airdopes Prime 800D TWS Earbuds', brand: 'boAt', offers: [{ storeSlug: 'myntra', price: 1099 }] };
  assert.equal(sameListingProduct(amazon, myntra, 'boat airdopes'), false);
  assert.equal(sameListingProduct(amazon, myntraSame, 'boat airdopes'), true);
});

test('a shared size or a multi-pack does not make two listings the same product', () => {
  const { sameListingProduct, sameVariant } = require('../services/comparisonService');
  const { extractSpecsFromString } = require('../utils/productUtils');
  const mk = (name, storeSlug) => ({ name, brand: 'Nivea', offers: [{ storeSlug }], specifications: extractSpecsFromString(name) });
  const aloe = mk('NIVEA Aloe Hydration Body Lotion, 200ml | 72 H Moisturization | Refreshing', 'amazon_in');
  const glow = mk('NIVEA Women Natural Glow SPF15 UVA/B Moisturiser Vitamin C 24H Hydration Body Lotion 200ml', 'myntra');
  const twoPack = mk('Nivea Set Of 2 Aloe Hydration Body Lotion 200ml Each', 'myntra');
  const aloeMyntra = mk('Nivea Aloe Hydration Body Lotion 200ml', 'myntra');
  assert.equal(sameListingProduct(aloe, glow, 'nivea body lotion'), false);
  assert.equal(sameVariant(aloe, twoPack), false);
  assert.equal(sameListingProduct(aloe, aloeMyntra, 'nivea body lotion') && sameVariant(aloe, aloeMyntra), true);
});

test('unbranded keyword listings and wildly different prices are not merged', () => {
  const { sameListingProduct } = require('../services/comparisonService');
  const amazon = {
    name: "Men's Classic White Lightweight Running Shoes Breathable Mesh Athletic Sports Sneakers for Gym",
    brand: '',
    offers: [{ storeSlug: 'amazon_in', price: 1599 }],
  };
  const flipkart = {
    name: 'Premium Sports, White Sneakers, Running, Gym, Trending',
    brand: '',
    offers: [{ storeSlug: 'flipkart', price: 311 }],
  };
  assert.equal(sameListingProduct(amazon, flipkart, 'running shoes'), false);
  const phoneA = { name: 'Apple iPhone 15 (Blue, 128 GB)', brand: 'Apple', offers: [{ storeSlug: 'flipkart', price: 67999 }] };
  const caseB = { name: 'Apple iPhone 15 (Black, 128 GB)', brand: 'Apple', offers: [{ storeSlug: 'amazon_in', price: 15999 }] };
  assert.equal(sameListingProduct(phoneA, caseB, 'iphone 15'), false);
});

test('savings compare the best offer with the priciest other store', () => {
  const result = compareOffers([
    { storeSlug: 'a', storeName: 'A', price: 900, availability: 'in_stock', productUrl: 'https://a/1' },
    { storeSlug: 'b', storeName: 'B', price: 1000, availability: 'in_stock', productUrl: 'https://b/1' },
    { storeSlug: 'c', storeName: 'C', price: 1200, availability: 'out_of_stock', productUrl: 'https://c/1' },
  ]);
  assert.deepEqual(result.savings, { amount: 100, percent: 10, comparedTo: 'B', highestPrice: 1000 });
  const single = compareOffers([
    { storeSlug: 'a', storeName: 'A', price: 900, availability: 'in_stock', productUrl: 'https://a/1' },
  ]);
  assert.equal(single.savings, null);
});

test('price tracker reports a drop against the previously seen price', () => {
  const offer = {
    storeSlug: 'amazon_in',
    storeName: 'Amazon India',
    productUrl: 'https://www.amazon.in/dp/B0TESTTEST?ref=abc',
    price: 1000,
    availability: 'in_stock',
  };
  assert.equal(offerKey(offer), 'amazon_in|amazon:B0TESTTEST');
  const [first] = trackOffers([offer]);
  assert.equal(first.priceHistory, undefined);
  const [second] = trackOffers([{ ...offer, price: 900 }]);
  assert.equal(second.priceHistory.previousPrice, 1000);
  assert.equal(second.priceHistory.change, -100);
  assert.equal(second.priceHistory.isLowest, true);
});
