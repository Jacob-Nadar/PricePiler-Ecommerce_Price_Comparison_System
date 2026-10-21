require('dotenv').config();
const adapters = require('./adapters');
const { searchStore } = require('./services/productService');
const { matchScore } = require('./utils/matchUtils');

(async () => {
  await adapters.ensureLoaded();
  const query = 'iphone 15 128gb';
  console.log(`=== Searching: ${query} ===`);
  for (const adapter of adapters.getLiveAdapters()) {
    console.log(`\n--- ${adapter.slug} ---`);
    try {
      const result = await searchStore(adapter, query);
      console.log(`matched item: ${result.item?.name?.slice(0, 70)} | score: ${result.item ? matchScore(query, result.item.name) : 'N/A'}`);
      console.log(`found ${result.found?.length || 0} items:`);
      (result.found || []).slice(0, 3).forEach((f, i) => {
        console.log(`  [${i}] score=${matchScore(query, f.name).toFixed(2)} | ${f.name?.slice(0, 60)} | ₹${f.price}`);
      });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  process.exit(0);
})();
