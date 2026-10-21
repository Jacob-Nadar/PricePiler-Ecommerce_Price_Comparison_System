// Create an admin account, or promote an existing user to admin.
//
//   npm run admin:create -- --email you@gmail.com --name "Your Name"
//       asks for the password (hidden). Press Enter to generate a strong one.
//   npm run admin:create -- --email you@gmail.com --password "S0me-strong-pass"
//   npm run admin:create -- --email user@gmail.com --demote      remove admin rights
//
// Admins log in on the normal login page and always confirm with an email code.
const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../config/db');
const { migrate } = require('../db/migrate');
const auth = require('../services/authService');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : true;
}

// Reads a line without echoing what is typed.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function generatePassword() {
  // 20 characters, always with a letter and a digit.
  return `${crypto.randomBytes(12).toString('base64url')}a7`.slice(0, 20);
}

async function main() {
  const email = auth.normalizeEmail(arg('email'));
  const emailError = auth.validateEmail(email);
  if (emailError) throw new Error(`--email: ${emailError}`);

  await migrate({ log: () => {} });
  if (!(await db.testConnection())) throw new Error('Cannot connect to MySQL. Check DB_* in server/.env.');
  const [existing] = await db.query('SELECT id, full_name, role FROM users WHERE email = ?', [email]);

  if (arg('demote')) {
    if (!existing) throw new Error('No user with that email.');
    await db.execute("UPDATE users SET role = 'user' WHERE id = ?", [existing.id]);
    await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [existing.id]);
    console.log(`✔ ${email} is no longer an admin.`);
    return;
  }

  let password = typeof arg('password') === 'string' ? arg('password') : undefined;
  let generated = false;
  if (!password && (!existing || arg('reset-password'))) {
    if (process.stdin.isTTY) {
      password = await askHidden('Admin password (Enter = generate a strong one): ');
      if (password) {
        const confirm = await askHidden('Repeat password: ');
        if (confirm !== password) throw new Error('Passwords do not match.');
      }
    }
    if (!password) {
      password = generatePassword();
      generated = true;
    }
  }
  if (password) {
    const passwordError = auth.validatePassword(password);
    if (passwordError) throw new Error(passwordError);
  }
  const hash = password ? await bcrypt.hash(password, config.auth.bcryptRounds) : null;

  if (existing) {
    await db.execute(
      `UPDATE users SET role = 'admin', login_otp_enabled = 1, disabled_at = NULL, failed_login_attempts = 0,
              locked_until = NULL, password_hash = COALESCE(?, password_hash)
        WHERE id = ?`,
      [hash, existing.id]
    );
    // Old sessions were issued before the role change; make them log in again.
    await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [existing.id]);
    console.log(`✔ ${email} is now an admin${hash ? ' (password updated)' : ' (password unchanged)'}.`);
  } else {
    const name = typeof arg('name') === 'string' ? arg('name') : 'Administrator';
    const nameError = auth.validateFullName(name);
    if (nameError) throw new Error(`--name: ${nameError}`);
    await db.execute(
      `INSERT INTO users (full_name, email, password_hash, role, email_verified_at, login_otp_enabled)
       VALUES (?, ?, ?, 'admin', UTC_TIMESTAMP(), 1)`,
      [name.trim(), email, hash]
    );
    console.log(`✔ Admin account created for ${email}.`);
  }

  if (generated) {
    console.log('\n  Generated password (shown only once — store it in a password manager):');
    console.log(`  ${password}\n`);
  }
  console.log('Log in at /login. Admins always confirm with an emailed code, then open /admin.');
  if (!config.mail.user || !config.mail.pass) {
    console.log('Email is not configured, so the login code will be printed in the server terminal.');
  }
}

main()
  .then(() => db.closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`✖ ${err.message}`);
    await db.closePool().catch(() => {});
    process.exit(1);
  });
