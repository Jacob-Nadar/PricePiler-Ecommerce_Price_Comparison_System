// One-time setup on a new PC (run from the project root):  npm run setup
//   1. installs server and client packages
//   2. downloads the Chromium build the scraper uses
//   3. creates server/.env from server/.env.example with a random OTP_SECRET
//   4. creates the MySQL database and tables (if MySQL is reachable)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, args, cwd, { optional = false } = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    if (optional) {
      console.warn(`  (skipped: ${label} did not complete — see the message above)`);
      return false;
    }
    console.error(`\n✖ ${label} failed.`);
    process.exit(result.status || 1);
  }
  return true;
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node.js 18 or newer is required (found ${process.versions.node}). Install the LTS version from https://nodejs.org`);
  process.exit(1);
}

run('Installing server packages', ['install'], path.join(root, 'server'));
run('Installing client packages', ['install'], path.join(root, 'client'));
run('Downloading Chromium for the scraper', ['run', 'browsers'], path.join(root, 'server'));

const envPath = path.join(root, 'server', '.env');
if (!fs.existsSync(envPath)) {
  const template = fs.readFileSync(path.join(root, 'server', '.env.example'), 'utf8');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(envPath, template.replace(/^OTP_SECRET=.*$/m, `OTP_SECRET=${secret}`));
  console.log('\n✔ Created server/.env — open it and set DB_PASSWORD (and SMTP_* for real emails).');
} else {
  console.log('\n✔ server/.env already exists (left unchanged).');
}

const migrated = run('Creating the database tables', ['run', 'migrate'], path.join(root, 'server'), { optional: true });

console.log(`
──────────────────────────────────────────────
Setup finished.${migrated ? '' : `

MySQL was not reachable yet. Start MySQL, check DB_* in server/.env,
then run:  npm run migrate --prefix server`}

Start the app (two terminals):
  npm run dev:server
  npm run dev:client
Then open http://localhost:5173
──────────────────────────────────────────────`);
