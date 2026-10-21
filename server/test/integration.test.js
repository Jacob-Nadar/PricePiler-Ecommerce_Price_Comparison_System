// End-to-end tests against a real MySQL server. Skipped unless TEST_DB_PORT (or
// TEST_DB_HOST) is set, e.g.:
//   TEST_DB_PORT=3307 TEST_DB_PASSWORD=pricepiler npm run test:integration
// A throwaway database (pricepiler_test) is created and dropped by the test.
const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = Boolean(process.env.TEST_DB_PORT || process.env.TEST_DB_HOST);

if (!enabled) {
  test('integration tests (set TEST_DB_PORT to run against MySQL)', { skip: true }, () => {});
} else {
  process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
  process.env.DB_USER = process.env.TEST_DB_USER || 'root';
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
  process.env.DB_NAME = 'pricepiler_test';
  process.env.OTP_SECRET = 'integration-secret';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.MONITOR_ENABLED = 'false';
  process.env.MONITOR_REQUEST_DELAY_MS = '0';
  process.env.MONITOR_RETRY_BASE_DELAY_MS = '1';
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASS = '';
  // Every request comes from 127.0.0.1; the per-IP limits are tested separately below.
  process.env.RATE_LIMIT_OTP_PER_15_MIN = '1000';
  process.env.RATE_LIMIT_LOGIN_PER_15_MIN = '1000';
  process.env.RATE_LIMIT_API_PER_MINUTE = '5000';

  const mysql = require('mysql2/promise');
  const config = require('../config');
  const db = require('../config/db');
  const { migrate } = require('../db/migrate');
  const mailer = require('../services/email/mailer');
  const adapters = require('../adapters');
  const alerts = require('../services/alertService');
  const monitor = require('../services/monitorService');

  // Capture every email instead of sending it.
  const outbox = [];
  mailer.sendMail = async (mail) => {
    outbox.push(mail);
    return { status: 'sent' };
  };
  const lastCodeFor = (email) => {
    const mail = [...outbox].reverse().find((m) => m.to === email && /\b\d{6}\b/.test(m.text));
    return mail.text.match(/\b(\d{6})\b/)[1];
  };

  let server;
  let base;

  async function call(method, path, { body, cookie, origin } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(origin ? { origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, cookie: setCookie ? setCookie.split(';')[0] : null };
  }

  async function registerUser(email, name = 'Test User', password = 'password123') {
    const start = await call('POST', '/api/auth/register', { body: { fullName: name, email, password, confirmPassword: password } });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    const verify = await call('POST', '/api/auth/register/verify', { body: { email, code: lastCodeFor(email) } });
    assert.equal(verify.status, 201, JSON.stringify(verify.body));
    return { cookie: verify.cookie, user: verify.body.data.user };
  }

  const productBody = {
    product: { name: 'Acme Wireless Earbuds X1', brand: 'Acme', imageUrl: 'https://example.com/x.jpg' },
    offers: [
      { storeSlug: 'amazon_in', productUrl: 'https://www.amazon.in/dp/B0TESTAAAA', title: 'Acme Wireless Earbuds X1', price: 1 },
      { storeSlug: 'flipkart', productUrl: 'https://www.flipkart.com/acme-x1/p/itmtestx1?pid=ACMEX1', title: 'Acme Earbuds X1' },
    ],
  };

  test.before(async () => {
    const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
    await conn.query('DROP DATABASE IF EXISTS pricepiler_test');
    await conn.end();
    await migrate({ log: () => {} });
    await db.testConnection();
    await adapters.loadStores();
    const app = require('../server');
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    server?.close();
    const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
    await conn.query('DROP DATABASE IF EXISTS pricepiler_test');
    await conn.end();
    await db.closePool();
  });

  test('registration: validation, OTP verification, duplicates and resend cooldown', async () => {
    const invalid = await call('POST', '/api/auth/register', { body: { fullName: 'A', email: 'bad', password: 'x', confirmPassword: 'y' } });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.fields.email && invalid.body.fields.password);

    const email = 'priya@gmail.com';
    const start = await call('POST', '/api/auth/register', {
      body: { fullName: 'Priya Sharma', email, password: 'password123', confirmPassword: 'password123' },
    });
    assert.equal(start.status, 202);
    assert.equal(start.body.data.expiresInSeconds, 300);
    const [pendingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    assert.equal(pendingUser, undefined, 'no account before verification');

    const code = lastCodeFor(email);
    const wrongCode = code === '000000' ? '111111' : '000000';
    const wrong = await call('POST', '/api/auth/register/verify', { body: { email, code: wrongCode } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.attemptsLeft, 4);

    const resend = await call('POST', '/api/auth/otp/resend', { body: { email, purpose: 'register' } });
    assert.equal(resend.status, 429, 'resend inside the 60 s cooldown is refused');

    const ok = await call('POST', '/api/auth/register/verify', { body: { email, code } });
    assert.equal(ok.status, 201);
    assert.match(ok.cookie, /^pp_session=/);
    assert.equal(ok.body.data.user.email, email);
    assert.equal(ok.body.data.user.emailVerified, true);
    const [row] = await db.query('SELECT password_hash FROM users WHERE email = ?', [email]);
    assert.match(row.password_hash, /^\$2[aby]\$/, 'password stored as a bcrypt hash');

    const reuse = await call('POST', '/api/auth/register/verify', { body: { email, code } });
    assert.equal(reuse.status, 400, 'a code works only once');

    const dup = await call('POST', '/api/auth/register', {
      body: { fullName: 'Priya Again', email: 'PRIYA@gmail.com', password: 'password123', confirmPassword: 'password123' },
    });
    assert.equal(dup.status, 409);
  });

  test('OTP expiry and attempt limit', async () => {
    const email = 'expiry@gmail.com';
    await call('POST', '/api/auth/register', { body: { fullName: 'Exp User', email, password: 'password123', confirmPassword: 'password123' } });
    const code = lastCodeFor(email);
    await db.execute("UPDATE email_otps SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE email = ?", [email]);
    const expired = await call('POST', '/api/auth/register/verify', { body: { email, code } });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.code, 'OTP_EXPIRED');

    // After the cooldown a new code can be requested and the old payload is kept.
    await db.execute('UPDATE email_otps SET last_sent_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE WHERE email = ?', [email]);
    assert.equal((await call('POST', '/api/auth/otp/resend', { body: { email, purpose: 'register' } })).status, 200);
    const fresh = lastCodeFor(email);
    const bad = fresh === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      assert.equal((await call('POST', '/api/auth/register/verify', { body: { email, code: bad } })).status, 400);
    }
    const locked = await call('POST', '/api/auth/register/verify', { body: { email, code: bad } });
    assert.equal(locked.status, 429);
    const afterLock = await call('POST', '/api/auth/register/verify', { body: { email, code: fresh } });
    assert.equal(afterLock.status, 429, 'even the right code is refused after too many attempts');
  });

  test('login, optional OTP second factor, logout and protected routes', async () => {
    const { cookie } = await registerUser('login@gmail.com', 'Login User', 'password123');
    assert.equal((await call('GET', '/api/auth/me', { cookie })).status, 200);

    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'login@gmail.com', password: 'wrongpass1' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'nobody@gmail.com', password: 'password123' } })).status, 401);

    const login = await call('POST', '/api/auth/login', { body: { email: 'login@gmail.com', password: 'password123' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.otpRequired, false);

    // Turn on the second factor.
    assert.equal((await call('PATCH', '/api/auth/me', { cookie: login.cookie, body: { loginOtpEnabled: true } })).status, 200);
    const step1 = await call('POST', '/api/auth/login', { body: { email: 'login@gmail.com', password: 'password123' } });
    assert.equal(step1.body.data.otpRequired, true);
    assert.equal(step1.cookie, null, 'no session before the code is verified');
    const step2 = await call('POST', '/api/auth/login/verify', { body: { email: 'login@gmail.com', code: lastCodeFor('login@gmail.com') } });
    assert.equal(step2.status, 200);
    assert.ok(step2.cookie);

    assert.equal((await call('POST', '/api/auth/logout', { cookie: step2.cookie })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: step2.cookie })).status, 401);
    assert.equal((await call('GET', '/api/me/dashboard')).status, 401);
  });

  test('account locks after repeated wrong passwords', async () => {
    await registerUser('lock@gmail.com');
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/auth/login', { body: { email: 'lock@gmail.com', password: 'wrongpass1' } });
    }
    const locked = await call('POST', '/api/auth/login', { body: { email: 'lock@gmail.com', password: 'password123' } });
    assert.equal(locked.status, 423);
  });

  test('forgot / reset password signs out old sessions', async () => {
    const { cookie } = await registerUser('reset@gmail.com', 'Reset User', 'password123');
    const unknown = await call('POST', '/api/auth/password/forgot', { body: { email: 'ghost@gmail.com' } });
    assert.equal(unknown.status, 200, 'same answer for unknown emails');
    assert.equal((await call('POST', '/api/auth/password/forgot', { body: { email: 'reset@gmail.com' } })).status, 200);
    const reset = await call('POST', '/api/auth/password/reset', {
      body: { email: 'reset@gmail.com', code: lastCodeFor('reset@gmail.com'), password: 'newpass456', confirmPassword: 'newpass456' },
    });
    assert.equal(reset.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'reset@gmail.com', password: 'password123' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'reset@gmail.com', password: 'newpass456' } })).status, 200);
  });

  test('cross-site requests are rejected', async () => {
    const res = await call('POST', '/api/auth/login', { origin: 'https://evil.example.com', body: { email: 'a@gmail.com', password: 'x' } });
    assert.equal(res.status, 403);
  });

  test('users can only see and change their own alerts', async () => {
    const alice = await registerUser('alice@gmail.com', 'Alice');
    const bob = await registerUser('bob@gmail.com', 'Bob');
    const created = await call('POST', '/api/me/alerts/price', { cookie: alice.cookie, body: { ...productBody, targetPrice: 2000 } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.alert.id;

    // The client-sent price (1) must not have been stored as a real price.
    const [listing] = await db.query("SELECT current_price FROM product_listings WHERE listing_key = 'amazon_in|amazon:B0TESTAAAA'");
    assert.equal(listing.current_price, null);

    assert.equal((await call('GET', '/api/me/alerts/price', { cookie: bob.cookie })).body.data.items.length, 0);
    assert.equal((await call('PATCH', `/api/me/alerts/price/${id}`, { cookie: bob.cookie, body: { action: 'pause' } })).status, 404);
    assert.equal((await call('DELETE', `/api/me/alerts/price/${id}`, { cookie: bob.cookie })).status, 404);

    const paused = await call('PATCH', `/api/me/alerts/price/${id}`, { cookie: alice.cookie, body: { action: 'pause' } });
    assert.equal(paused.body.data.alert.status, 'paused');
    const edited = await call('PATCH', `/api/me/alerts/price/${id}`, { cookie: alice.cookie, body: { targetPrice: 1800, action: 'resume' } });
    assert.equal(edited.body.data.alert.status, 'active');
    assert.equal(Number(edited.body.data.alert.targetPrice), 1800);
    assert.equal((await call('PATCH', `/api/me/alerts/price/${id}`, { cookie: alice.cookie, body: { targetPrice: -5 } })).status, 400);

    const evilListing = await call('POST', '/api/me/alerts/price', {
      cookie: alice.cookie,
      body: { product: { name: 'X' }, offers: [{ storeSlug: 'amazon_in', productUrl: 'https://evil.example.com/dp/B0TESTAAAA', title: 'X' }], targetPrice: 10 },
    });
    assert.equal(evilListing.status, 400, 'non-store URLs are rejected');

    assert.equal((await call('DELETE', `/api/me/alerts/price/${id}`, { cookie: alice.cookie })).status, 200);
  });

  test('price drop emails once per drop and again only after the price recovers', async () => {
    const carol = await registerUser('carol@gmail.com', 'Carol');
    const created = await call('POST', '/api/me/alerts/price', { cookie: carol.cookie, body: { ...productBody, targetPrice: 2000 } });
    const alertId = created.body.data.alert.id;
    const [{ product_id: productId }] = await db.query('SELECT product_id FROM price_alerts WHERE id = ?', [alertId]);
    const setPrice = (price) =>
      db.execute("UPDATE product_listings SET current_price = ?, availability = 'in_stock' WHERE listing_key = 'amazon_in|amazon:B0TESTAAAA'", [price]);
    const drops = () => outbox.filter((m) => m.to === 'carol@gmail.com' && /Price drop/.test(m.subject)).length;

    await setPrice(2500);
    await alerts.evaluatePriceAlerts(productId);
    assert.equal(drops(), 0);

    await setPrice(1950);
    await Promise.all([alerts.evaluatePriceAlerts(productId), alerts.evaluatePriceAlerts(productId)]);
    assert.equal(drops(), 1, 'concurrent evaluations send a single email');
    const mail = outbox.filter((m) => m.to === 'carol@gmail.com').at(-1);
    for (const part of ['Acme Wireless Earbuds X1', 'Amazon India', '₹2,500', '₹1,950', '₹2,000', 'https://www.amazon.in/dp/B0TESTAAAA']) {
      assert.ok(mail.html.includes(part), `email contains ${part}`);
    }

    await alerts.evaluatePriceAlerts(productId);
    assert.equal(drops(), 1, 'still below target: no repeat');

    await setPrice(2300);
    await alerts.evaluatePriceAlerts(productId);
    await setPrice(1900);
    await alerts.evaluatePriceAlerts(productId);
    assert.equal(drops(), 2, 'a new drop after recovery notifies again');

    const history = await call('GET', '/api/me/notifications', { cookie: carol.cookie });
    assert.equal(history.body.data.items.filter((n) => n.type === 'price_drop').length, 2);
  });

  test('restock emails once, ignores unknown availability, re-arms after going out of stock', async () => {
    const dave = await registerUser('dave@gmail.com', 'Dave');
    await db.execute("UPDATE product_listings SET availability = 'out_of_stock' WHERE listing_key = 'amazon_in|amazon:B0TESTAAAA'");
    const created = await call('POST', '/api/me/alerts/stock', {
      cookie: dave.cookie,
      body: { ...productBody, storeSlug: 'amazon_in', productUrl: 'https://www.amazon.in/dp/B0TESTAAAA' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const listingId = created.body.data.alert.listingId;
    const restocks = () => outbox.filter((m) => m.to === 'dave@gmail.com' && /Back in stock/.test(m.subject)).length;

    await alerts.evaluateStockAlerts(listingId, 'unknown');
    assert.equal(restocks(), 0, 'a failed check is never a restock');
    await db.execute('UPDATE product_listings SET current_price = 1499 WHERE id = ?', [listingId]);
    await alerts.evaluateStockAlerts(listingId, 'in_stock');
    await alerts.evaluateStockAlerts(listingId, 'in_stock');
    assert.equal(restocks(), 1);
    assert.ok(outbox.at(-1).html.includes('₹1,499'));

    await alerts.evaluateStockAlerts(listingId, 'out_of_stock');
    await alerts.evaluateStockAlerts(listingId, 'in_stock');
    assert.equal(restocks(), 2);

    // The monitor records availability on the listing; simulate that here.
    await db.execute("UPDATE product_listings SET availability = 'in_stock' WHERE id = ?", [listingId]);
    const dup = await call('POST', '/api/me/alerts/stock', {
      cookie: dave.cookie,
      body: { ...productBody, storeSlug: 'amazon_in', productUrl: 'https://www.amazon.in/dp/B0TESTAAAA' },
    });
    assert.equal(dup.status, 409, 'in-stock listings cannot be subscribed to');
  });

  test('monitor keeps valid data on failures and deduplicates snapshots', async () => {
    const [listing] = await db.query("SELECT id FROM product_listings WHERE listing_key = 'flipkart|flipkart.com/acme-x1/p/itmtestx1?pid=ACMEX1'");
    await db.execute("UPDATE product_listings SET current_price = 2222, availability = 'in_stock', next_check_at = NULL WHERE id = ?", [listing.id]);
    let behaviour = 'fail';
    const fake = {
      slug: 'flipkart',
      isAvailable: () => true,
      async extractFromUrl() {
        if (behaviour === 'fail') throw Object.assign(new Error('Flipkart returned HTTP 503'), { status: 503 });
        if (behaviour === 'blank') return { name: 'x', price: null, availability: 'unknown' };
        return { name: 'Acme', price: 2100, availability: 'in_stock' };
      },
    };
    const original = adapters.getAdapterBySlug;
    adapters.getAdapterBySlug = (slug) => (slug === 'flipkart' ? fake : original(slug));
    const row = async () => (await db.query('SELECT * FROM product_listings WHERE id = ?', [listing.id]))[0];
    const snapshots = async () => (await db.query('SELECT COUNT(*) AS n FROM price_history WHERE listing_id = ?', [listing.id]))[0].n;
    const base = { id: listing.id, retailer_slug: 'flipkart', product_url: 'https://www.flipkart.com/acme-x1/p/itmtestx1?pid=ACMEX1' };
    try {
      let r = await row();
      await monitor.checkListing({ ...base, product_id: r.product_id, current_price: r.current_price, availability: r.availability, consecutive_failures: r.consecutive_failures });
      r = await row();
      assert.equal(Number(r.current_price), 2222, 'failed check keeps the old price');
      assert.equal(r.availability, 'in_stock', 'failed check keeps the old availability');
      assert.equal(r.consecutive_failures, 1);
      assert.match(r.last_error, /503/);
      assert.ok(r.next_check_at > new Date(), 'backed off');
      assert.equal(await snapshots(), 0);

      behaviour = 'blank';
      await db.execute('UPDATE product_listings SET next_check_at = NULL WHERE id = ?', [listing.id]);
      await monitor.checkListing({ ...base, product_id: r.product_id, current_price: r.current_price, availability: r.availability, consecutive_failures: r.consecutive_failures });
      r = await row();
      assert.equal(r.availability, 'in_stock', 'unknown availability never overwrites');
      assert.equal(r.consecutive_failures, 2);

      behaviour = 'ok';
      for (let i = 0; i < 2; i++) {
        r = await row();
        await monitor.checkListing({ ...base, product_id: r.product_id, current_price: r.current_price, availability: r.availability, consecutive_failures: r.consecutive_failures });
      }
      r = await row();
      assert.equal(Number(r.current_price), 2100);
      assert.equal(r.consecutive_failures, 0);
      assert.equal(r.last_error, null);
      assert.ok(r.last_success_at);
      assert.equal(await snapshots(), 1, 'same price twice is stored once');

      const history = await call('POST', '/api/products/history', {
        body: { range: '7d', offers: [{ storeSlug: 'flipkart', productUrl: base.product_url }] },
      });
      assert.equal(history.body.data.history[0].stats.current, 2100);
    } finally {
      adapters.getAdapterBySlug = original;
    }
  });

  test('concurrent searches record one product and one snapshot per price', async () => {
    const { recordSearchResults } = require('../services/priceHistoryService');
    const result = {
      name: 'Race Test Kettle 1.5 L',
      brand: 'Racer',
      offers: [
        { storeSlug: 'amazon_in', productUrl: 'https://www.amazon.in/dp/B0RACETEST', title: 'Race Test Kettle 1.5 L', price: 999, availability: 'in_stock' },
        { storeSlug: 'myntra', productUrl: 'https://www.myntra.com/kettle/racer/race-test-kettle/99887766/buy', title: 'Racer Race Test Kettle', price: 1049, availability: 'in_stock' },
      ],
    };
    await Promise.all([recordSearchResults([result]), recordSearchResults([result]), recordSearchResults([result])]);
    const listings = await db.query(
      "SELECT id, product_id FROM product_listings WHERE listing_key IN ('amazon_in|amazon:B0RACETEST', 'myntra|myntra.com/kettle/racer/race-test-kettle/99887766/buy')"
    );
    assert.equal(listings.length, 2);
    assert.equal(new Set(listings.map((l) => l.product_id)).size, 1, 'both listings share one product');
    const [{ orphans }] = await db.query(
      "SELECT COUNT(*) AS orphans FROM products p WHERE p.name = 'Race Test Kettle 1.5 L' AND NOT EXISTS (SELECT 1 FROM product_listings l WHERE l.product_id = p.id)"
    );
    assert.equal(orphans, 0, 'no empty products left behind');
    const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM price_history WHERE listing_id IN (?)', [listings.map((l) => l.id)]);
    assert.equal(n, 2, 'one snapshot per listing');
  });

  test('admin panel: access control, 2FA, user management and audit log', async () => {
    const regular = await registerUser('regular@gmail.com', 'Regular User');
    const victim = await registerUser('victim@gmail.com', 'Victim User');
    assert.equal((await call('GET', '/api/admin/users')).status, 401, 'logged out');
    assert.equal((await call('GET', '/api/admin/users', { cookie: regular.cookie })).status, 403, 'normal users are refused');

    // Promote an account the way `npm run admin:create` does.
    await registerUser('boss@gmail.com', 'Boss Admin', 'adminpass123');
    await db.execute("UPDATE users SET role = 'admin', login_otp_enabled = 1 WHERE email = 'boss@gmail.com'");
    const step1 = await call('POST', '/api/auth/login', { body: { email: 'boss@gmail.com', password: 'adminpass123' } });
    assert.equal(step1.body.data.otpRequired, true, 'admins always need the email code');
    const step2 = await call('POST', '/api/auth/login/verify', { body: { email: 'boss@gmail.com', code: lastCodeFor('boss@gmail.com') } });
    const adminCookie = step2.cookie;
    assert.equal(step2.body.data.user.isAdmin, true);
    assert.equal((await call('PATCH', '/api/auth/me', { cookie: adminCookie, body: { loginOtpEnabled: false } })).status, 400);

    const overview = await call('GET', '/api/admin/overview', { cookie: adminCookie });
    assert.equal(overview.status, 200);
    assert.ok(overview.body.data.users.users >= 3);

    const list = await call('GET', '/api/admin/users?search=victim', { cookie: adminCookie });
    assert.equal(list.body.data.total, 1);
    const raw = JSON.stringify(list.body);
    assert.doesNotMatch(raw, /password|\$2[aby]\$|token_hash|code_hash/i, 'no secrets in admin responses');
    const victimId = list.body.data.items[0].id;
    const detail = await call('GET', `/api/admin/users/${victimId}`, { cookie: adminCookie });
    assert.equal(detail.body.data.user.email, 'victim@gmail.com');
    assert.doesNotMatch(JSON.stringify(detail.body), /password_hash|token_hash/i);

    // Disabling signs the user out and blocks login.
    assert.equal((await call('PATCH', `/api/admin/users/${victimId}`, { cookie: adminCookie, body: { action: 'disable' } })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: victim.cookie })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'victim@gmail.com', password: 'password123' } })).status, 403);
    await call('PATCH', `/api/admin/users/${victimId}`, { cookie: adminCookie, body: { action: 'enable' } });
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'victim@gmail.com', password: 'password123' } })).status, 200);

    // Admins cannot lock themselves (or other admins) out from the panel.
    const [{ id: bossId }] = await db.query("SELECT id FROM users WHERE email = 'boss@gmail.com'");
    assert.equal((await call('PATCH', `/api/admin/users/${bossId}`, { cookie: adminCookie, body: { action: 'disable' } })).status, 400);
    assert.equal((await call('DELETE', `/api/admin/users/${bossId}`, { cookie: adminCookie })).status, 400);

    for (const path of ['/api/admin/alerts/price', '/api/admin/alerts/stock', '/api/admin/listings?filter=failing', '/api/admin/notifications']) {
      const res = await call('GET', path, { cookie: adminCookie });
      assert.equal(res.status, 200, path);
      assert.ok(Array.isArray(res.body.data.items), path);
    }

    assert.equal((await call('DELETE', `/api/admin/users/${victimId}`, { cookie: adminCookie })).status, 200);
    const audit = await call('GET', '/api/admin/audit', { cookie: adminCookie });
    assert.deepEqual(
      audit.body.data.items.map((a) => a.action).reverse(),
      ['user.disable', 'user.enable', 'user.delete']
    );
    assert.equal(audit.body.data.items[0].adminEmail, 'boss@gmail.com');
  });

  test('a locked listing is not checked twice at the same time', async () => {
    const [listing] = await db.query("SELECT id, product_id FROM product_listings WHERE listing_key = 'amazon_in|amazon:B0TESTAAAA'");
    await db.execute('UPDATE product_listings SET locked_until = UTC_TIMESTAMP() + INTERVAL 5 MINUTE WHERE id = ?', [listing.id]);
    const result = await monitor.checkListing({ id: listing.id, product_id: listing.product_id, retailer_slug: 'amazon_in', consecutive_failures: 0 });
    assert.equal(result.skipped, 'locked');
    await db.execute('UPDATE product_listings SET locked_until = NULL WHERE id = ?', [listing.id]);
  });
}
