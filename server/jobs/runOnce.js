// One monitoring pass from the command line:  npm run monitor:once
// Useful to test alerts without waiting for the schedule.
const db = require('../config/db');
const monitor = require('../services/monitorService');
const { closeBrowser } = require('../utils/browser');

(async () => {
  const ok = await db.testConnection();
  if (!ok) {
    console.error('MySQL is not reachable. Check DB_* in server/.env and run `npm run migrate` first.');
    process.exit(1);
  }
  const limit = Number(process.argv[2]) || undefined;
  const summary = await monitor.runDueChecks(limit ? { limit } : {});
  console.log(JSON.stringify(summary, null, 2));
  await closeBrowser();
  await db.closePool();
  process.exit(0);
})();
