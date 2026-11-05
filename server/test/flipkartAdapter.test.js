// Flipkart is scraped from its rendered search and product pages. These tests
// cover the pure parsers that turn the raw page data into products, so they run
// without a browser or a network request.
const test = require('node:test');
const assert = require('node:assert/strict');

const FlipkartAdapter = require('../adapters/flipkartAdapter');

const { normalizeSearchCard, normalizeExtractedProduct, normalizeProductUrl } = FlipkartAdapter;

function createAdapter() {
  return new FlipkartAdapter({ id: 2, name: 'Flipkart', slug: 'flipkart' });
}

const SEARCH_CARD = {
  id: 'MOBHQV9YZGYG64U7',
  href:
    '/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9YZGYG64U7&lid=LSTMOBHQV9YZGYG64U7WLKZD8' +
    '&marketplace=FLIPKART&q=iphone+15&otracker=search',
  title: 'Apple iPhone 15 (Blue, 128 GB)',
  image: 'https://rukminim2.flixcart.com/image/312/312/xif0q/mobile/z/h/l/-original-imahqvadwhgxgx2n.jpeg?q=70',
  priceTexts: ['₹69,999', '₹74,900', '₹58,750'],
  ratingText: '4.6',
  ratingCountText: '2,50,153 Ratings & 9,892 Reviews',
  cardText:
    'Add to Compare Apple iPhone 15 (Blue, 128 GB) 4.6 2,50,153 Ratings & 9,892 Reviews ' +
    '128 GB ROM 15.49 cm (6.1 inch) Super Retina XDR Display ₹69,999 ₹74,900 6% off',
  sponsored: false,
};

test('isAvailable and auto-refresh are enabled for Flipkart', () => {
  const adapter = createAdapter();
  assert.equal(adapter.isAvailable(), true);
  assert.equal(adapter.supportsAutoRefresh(), true);
});

test('search returns no listings for an empty query without opening a browser', async () => {
  assert.deepEqual(await createAdapter().search('   '), []);
});

test('normalizeSearchCard reads the title, selling price, MRP and rating', () => {
  const product = normalizeSearchCard(SEARCH_CARD);

  assert.equal(product.id, 'MOBHQV9YZGYG64U7');
  assert.equal(product.name, 'Apple iPhone 15 (Blue, 128 GB)');
  assert.equal(product.offers.flipkart.price, 69999);
  assert.equal(product.offers.flipkart.mrp, 74900, 'the exchange amount is not the MRP');
  assert.equal(product.offers.flipkart.availability, 'in_stock');
  assert.equal(
    product.offers.flipkart.url,
    'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9YZGYG64U7'
  );
  assert.equal(product.rating, 4.6);
  assert.equal(product.ratingCount, 250153);
  assert.equal(product.specifications.storage, '128GB');
  assert.match(product.image, /^https:\/\/rukminim2\.flixcart\.com\//);
});

test('normalizeSearchCard keeps out-of-stock cards without inventing a price', () => {
  const product = normalizeSearchCard({
    id: 'ACMEX1',
    href: '/acme-x1/p/itmtestx1?pid=ACMEX1',
    title: 'Acme Wireless Earbuds X1',
    image: '//rukminim2.flixcart.com/image/1/x.jpeg',
    priceTexts: [],
    ratingText: '',
    ratingCountText: '',
    cardText: 'Add to Compare Acme Wireless Earbuds X1 Sold Out',
    sponsored: true,
  });

  assert.equal(product.offers.flipkart.price, null);
  assert.equal(product.offers.flipkart.mrp, null);
  assert.equal(product.offers.flipkart.availability, 'out_of_stock');
  assert.equal(product.sponsored, true);
  assert.match(product.image, /^https:\/\//);
});

test('normalizeSearchCard drops cards without a product URL or title', () => {
  assert.equal(normalizeSearchCard({ href: '', title: 'Acme X1' }), null);
  assert.equal(normalizeSearchCard({ href: '/acme-x1/p/itm1?pid=X1', title: '' }), null);
  assert.equal(normalizeSearchCard({ href: 'https://example.com/product', title: 'Acme X1' }), null);
});

test('normalizeProductUrl keeps only the product path and pid', () => {
  assert.equal(
    normalizeProductUrl('https://www.flipkart.com/acme-x1/p/itm1?pid=P1&lid=abc&q=acme&otracker=search'),
    'https://www.flipkart.com/acme-x1/p/itm1?pid=P1'
  );
  assert.equal(normalizeProductUrl('https://example.com/acme-x1/p/itm1?pid=P1'), '');
  assert.equal(normalizeProductUrl(''), '');
});

const METADATA = {
  name: 'Apple iPhone 15 (Blue, 128 GB)',
  brand: 'APPLE',
  category: 'mobile',
  imageUrl: 'https://rukmini1.flixcart.com/image/1500/1500/xif0q/mobile/z/h/l/-original-imahqvadwhgxgx2n.jpeg?q=70',
  price: 69999,
  availability: 'in_stock',
  rating: 4.6,
  ratingCount: 250153,
  specifications: { color: 'Blue' },
};

const PRODUCT_DOM = {
  title: 'Apple iPhone 15 (Blue, 128 GB)',
  priceText: '₹69,999',
  mrpText: '74,900',
  image: '',
  bodyText: 'Apple iPhone 15 (Blue, 128 GB) 4.6 | 2,50,153 ₹69,999 Buy Now',
  availabilityText: 'Buy Now',
  addToCart: false,
  buyNow: true,
  ratingText: '4.6',
  ratingCountText: '2,50,153',
};

const PRODUCT_URL = 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9YZGYG64U7';

test('normalizeExtractedProduct merges JSON-LD metadata with the rendered MRP', () => {
  const product = normalizeExtractedProduct({ url: PRODUCT_URL, dom: PRODUCT_DOM, metadata: METADATA });

  assert.equal(product.name, 'Apple iPhone 15 (Blue, 128 GB)');
  assert.equal(product.price, 69999);
  assert.equal(product.mrp, 74900);
  assert.equal(product.availability, 'in_stock');
  assert.equal(product.brand, 'APPLE');
  assert.equal(product.category, 'mobile');
  assert.equal(product.imageUrl, METADATA.imageUrl);
  assert.equal(product.rating, 4.6);
  assert.equal(product.ratingCount, 250153);
  assert.equal(product.specifications.color, 'Blue');
  assert.equal(product.specifications.storage, '128GB');
  assert.equal(product.productUrl, PRODUCT_URL);
  assert.equal(product.sourceNote, undefined);
});

test('normalizeExtractedProduct falls back to the DOM when metadata is missing', () => {
  const product = normalizeExtractedProduct({
    url: 'https://www.flipkart.com/acme-phone/p/itmtestx2?pid=ACMEX2',
    dom: { title: 'Acme Phone', priceText: '₹1,999', mrpText: '2,499', addToCart: true },
    metadata: null,
  });

  assert.equal(product.name, 'Acme Phone');
  assert.equal(product.price, 1999);
  assert.equal(product.mrp, 2499);
  assert.equal(product.availability, 'in_stock');
  assert.equal(product.sourceNote, undefined);
});

test('normalizeExtractedProduct uses the URL slug and explains when nothing was read', () => {
  const url = 'https://www.flipkart.com/lenovo-ideapad-slim-3/p/itm7ac6485515ae4b';
  const product = normalizeExtractedProduct({ url, dom: {}, metadata: null });

  assert.equal(product.name, 'lenovo ideapad slim 3');
  assert.equal(product.price, null);
  assert.equal(product.availability, 'unknown');
  assert.equal(product.productUrl, url);
  assert.match(product.sourceNote, /price and availability could not be verified/);
});
