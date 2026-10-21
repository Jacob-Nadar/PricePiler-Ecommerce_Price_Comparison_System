require('dotenv').config();
const FlipkartAdapter = require('./adapters/flipkartAdapter');

(async () => {
  const adapter = new FlipkartAdapter();
  const url = 'https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y';
  console.log('Testing flipkart extractFromUrl:', url);
  try {
    const p = await adapter.extractFromUrl(url);
    console.log('name:', p?.name?.slice(0, 80));
    console.log('price:', p?.price);
    console.log('availability:', p?.availability);
    console.log('image:', p?.imageUrl ? 'yes' : 'no');
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
})();
