require('dotenv').config();
const AmazonAdapter = require('./adapters/amazonAdapter');

(async () => {
  const adapter = new AmazonAdapter();
  // Use a known good iPhone 15 URL
  const url = 'https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY';
  console.log('Testing amazon extractFromUrl:', url);
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
