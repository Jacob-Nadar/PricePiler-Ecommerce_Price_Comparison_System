const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectAvailability,
  parsePrice,
  productNameFromUrl,
  productNameFromMyntraUrl,
  productNameFromFlipkartUrl,
} = require('../utils/scraperUtils');

test('availability detection requires an explicit stock signal', () => {
  assert.equal(detectAvailability(''), 'unknown');
  assert.equal(detectAvailability('Price ₹49,999'), 'unknown');
  assert.equal(detectAvailability('Available soon'), 'unknown');
  assert.equal(detectAvailability('Add to cart'), 'in_stock');
  assert.equal(detectAvailability('https://schema.org/InStock'), 'in_stock');
  assert.equal(detectAvailability('Only 2 left in stock'), 'in_stock');
});

test('availability detection prioritizes out-of-stock signals', () => {
  assert.equal(detectAvailability('Currently unavailable'), 'out_of_stock');
  assert.equal(detectAvailability('Out-of-stock'), 'out_of_stock');
  assert.equal(detectAvailability('Not in stock'), 'out_of_stock');
  assert.equal(detectAvailability('https://schema.org/OutOfStock'), 'out_of_stock');
  assert.equal(detectAvailability('Notify me when available'), 'out_of_stock');
});

test('price parsing handles Indian price formatting and missing values', () => {
  assert.equal(parsePrice('₹79,990'), 79990);
  assert.equal(parsePrice('Rs. 1,299.00'), 1299);
  assert.equal(parsePrice('₹1,299.50'), 1299.5);
  assert.equal(parsePrice('₹1,299 - ₹1,499'), 1299);
  assert.equal(parsePrice('Currently unavailable'), null);
});

test('availability detection handles embedded JSON without false out-of-stock', () => {
  assert.equal(
    detectAvailability('In stock {"isInternal":false,"unavailableReason":null}'),
    'in_stock'
  );
  assert.equal(
    detectAvailability('FREE delivery Tomorrow. In stock.'),
    'in_stock'
  );
});

test('product name can be recovered from an Amazon product URL', () => {
  assert.equal(
    productNameFromUrl('https://www.amazon.in/Motorola-Fusion-Pantone-Zephyr-Storage/dp/B0F46BTPPY/ref=abc?psc=1'),
    'Motorola Fusion Pantone Zephyr Storage'
  );
  assert.equal(productNameFromUrl('https://www.amazon.in/dp/B0DGV465ZW'), 'B0DGV465ZW');
  assert.equal(productNameFromUrl('https://www.amazon.in/s?k=motorola'), '');
});

test('product name can be recovered from a Flipkart product URL', () => {
  assert.equal(
    productNameFromFlipkartUrl('https://www.flipkart.com/roadster-men-cotton-t-shirt/p/itm12345'),
    'roadster men cotton t shirt'
  );
  assert.equal(productNameFromFlipkartUrl('https://www.flipkart.com/search?q=shirt'), '');
});

test('Myntra hostnames and product URLs are recognized', () => {
  const { parseStoreFromUrl } = require('../utils/httpClient');
  assert.equal(parseStoreFromUrl('https://www.myntra.com/tshirts/brand/product-name/12345678/buy'), 'myntra');
  assert.equal(parseStoreFromUrl('https://myntra.com/'), 'myntra');
  assert.equal(parseStoreFromUrl('https://amzn.in/d/12345'), 'amazon_in');
  assert.equal(parseStoreFromUrl('https://amzn.to/3xyz'), 'amazon_in');
  assert.equal(productNameFromMyntraUrl('https://www.myntra.com/tshirts/brand/product-name/12345678/buy'), 'product name');
  assert.equal(productNameFromMyntraUrl('https://www.myntra.com/casual-shoes/puma/puma-sneakers/21767244/buy'), 'puma sneakers');
  assert.equal(productNameFromMyntraUrl('https://www.myntra.com/'), '');
});
