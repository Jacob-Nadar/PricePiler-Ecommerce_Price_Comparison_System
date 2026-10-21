// Downloads the Chromium build Playwright needs into server/.playwright-browsers
// (the same folder utils/browser.js uses), so scraping works on a fresh PC.
//   npm run browsers
const path = require('path');
const { spawnSync } = require('child_process');

const browsersPath = path.join(__dirname, '..', '.playwright-browsers');
// cli.js is not an exported subpath, so locate it next to the package's package.json.
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
console.log(`Installing Chromium into ${browsersPath} ...`);
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
});
process.exit(result.status ?? 1);
