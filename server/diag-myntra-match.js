require('dotenv').config();
const MyntraAdapter = require('./adapters/myntraAdapter');
const { matchScore } = require('./utils/matchUtils');

(async () => {
  const adapter = new MyntraAdapter();
  const query = 'iphone 15 128gb';
  console.log('Myntra search for:', query);
  try {
    const results = await adapter.search(query);
    console.log(`Found ${results.length} results after filtering:`);
    results.slice(0, 5).forEach((r, i) => {
      const score = matchScore(query.toLowerCase(), r.name.toLowerCase());
      console.log(`  [${i}] score=${score.toFixed(2)} | ${r.name?.slice(0, 70)} | ₹${r.price}`);
    });
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
})();
