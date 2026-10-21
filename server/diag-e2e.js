require('dotenv').config();
const { searchProducts } = require('./services/productService');
const adapters = require('./adapters');

(async () => {
  const query = 'iphone 15 128gb';
  console.log(`=== Searching: ${query} ===`);
  try {
    const results = await searchProducts(query);
    console.log('Store status:');
    for (const s of (results.storeStatus || [])) {
      console.log(`  ${s.storeSlug}: ${s.status}${s.message ? ' (' + s.message.slice(0, 60) + ')' : ''}`);
    }
    console.log('\nMerged results:');
    for (const r of (results.results || [])) {
      console.log(`  product: ${r.name?.slice(0, 70)}`);
      for (const o of (r.offers || [])) {
        console.log(`    [${o.storeSlug}] ₹${o.price} | ${o.availability} | url=${o.productUrl ? 'yes' : 'no'}`);
      }
    }
    // Test extractFromUrl for each store offer
    for (const r of (results.results || [])) {
      for (const o of (r.offers || [])) {
        if (o.productUrl) {
          console.log(`\n=== extractFromUrl for ${o.storeSlug} ===`);
          try {
            const adapter = adapters.getAdapterBySlug(o.storeSlug);
            const p = await adapter.extractFromUrl(o.productUrl);
            console.log(`  name: ${p?.name?.slice(0, 70)}`);
            console.log(`  price: ${p?.price} | avail: ${p?.availability} | img: ${p?.imageUrl ? 'yes' : 'no'}`);
          } catch (e) {
            console.log(`  ERROR: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.error('Search failed:', e.message);
  }
  process.exit(0);
})();
