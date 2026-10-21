// Unit tests for auth, alert, history and monitor logic. No database needed.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OTP_SECRET = process.env.OTP_SECRET || 'unit-test-secret';

const otp = require('../services/otpService');
const auth = require('../services/authService');
const { decidePriceAlert, decideStockAlert, pickDecidingListing } = require('../services/alertService');
const { shouldRecordSnapshot, summarize } = require('../services/priceHistoryService');
const { backoffMinutes, interpretResult, isTransient, withRetry } = require('../services/monitorService');
const { otpEmail, priceDropEmail } = require('../services/email/templates');
const { listingKeyFor } = require('../services/catalogService');

test('OTP codes are 6 digits and only the right code matches', () => {
  const code = otp.generateCode();
  assert.match(code, /^\d{6}$/);
  const hash = otp.hashCode('a@gmail.com', 'register', code);
  assert.equal(otp.codesMatch(hash, 'a@gmail.com', 'register', code), true);
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  assert.equal(otp.codesMatch(hash, 'a@gmail.com', 'register', wrong), false);
  // A code for one purpose or email cannot be replayed for another.
  assert.equal(otp.codesMatch(hash, 'a@gmail.com', 'reset', code), false);
  assert.equal(otp.codesMatch(hash, 'b@gmail.com', 'register', code), false);
  assert.equal(otp.codesMatch(hash, 'a@gmail.com', 'register', '12345'), false);
});

test('OTP resend has a 60 s cooldown and an hourly cap', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const sentAgo = (s) => new Date(now - s * 1000);
  assert.equal(otp.sendDecision(null, now).allowed, true);
  const tooSoon = otp.sendDecision({ last_sent_at: sentAgo(20), send_window_started_at: sentAgo(20), send_count: 1 }, now);
  assert.equal(tooSoon.allowed, false);
  assert.equal(tooSoon.reason, 'cooldown');
  assert.equal(tooSoon.retryAfter, 40);
  assert.equal(otp.sendDecision({ last_sent_at: sentAgo(61), send_window_started_at: sentAgo(61), send_count: 1 }, now).allowed, true);
  const capped = otp.sendDecision({ last_sent_at: sentAgo(120), send_window_started_at: sentAgo(1800), send_count: 5 }, now);
  assert.equal(capped.allowed, false);
  assert.equal(capped.reason, 'hourly_limit');
  const newWindow = otp.sendDecision({ last_sent_at: sentAgo(120), send_window_started_at: sentAgo(3700), send_count: 5 }, now);
  assert.deepEqual(newWindow, { allowed: true, resetWindow: true });
});

test('registration validation covers every field', () => {
  const ok = { fullName: 'Priya Sharma', email: 'Priya@Gmail.com', password: 'secret123', confirmPassword: 'secret123' };
  assert.deepEqual(auth.validateRegistration(ok), {});
  const errors = auth.validateRegistration({ fullName: 'P', email: 'nope', password: 'short', confirmPassword: 'other' });
  assert.ok(errors.fullName && errors.email && errors.password && errors.confirmPassword);
  assert.match(auth.validateRegistration({ ...ok, password: 'onlyletters', confirmPassword: 'onlyletters' }).password, /letter and one number/);
  assert.match(auth.validateRegistration({ ...ok, fullName: '<script>' }).fullName, /letters/);
  assert.equal(auth.normalizeEmail('  Priya@Gmail.com '), 'priya@gmail.com');
});

test('price alert notifies once per drop and re-arms only after the price rises', () => {
  const alert = (status) => ({ status, target_price: 2000 });
  assert.deepEqual(decidePriceAlert(alert('active'), { price: 2500, availability: 'in_stock' }), { action: 'none' });
  assert.deepEqual(decidePriceAlert(alert('active'), { price: 1950, availability: 'in_stock' }), { action: 'notify' });
  assert.deepEqual(decidePriceAlert(alert('active'), { price: 2000, availability: 'unknown' }), { action: 'notify' });
  // Already notified for this drop: staying low never sends again.
  assert.deepEqual(decidePriceAlert(alert('triggered'), { price: 1900, availability: 'in_stock' }), { action: 'none' });
  assert.deepEqual(decidePriceAlert(alert('triggered'), { price: 2100, availability: 'in_stock' }), { action: 'rearm' });
  // Out-of-stock prices, missing prices, paused and cancelled alerts never notify.
  assert.deepEqual(decidePriceAlert(alert('active'), { price: 1500, availability: 'out_of_stock' }), { action: 'none' });
  assert.deepEqual(decidePriceAlert(alert('active'), { price: null, availability: 'in_stock' }), { action: 'none' });
  assert.deepEqual(decidePriceAlert(alert('paused'), { price: 1500, availability: 'in_stock' }), { action: 'none' });
  assert.deepEqual(decidePriceAlert(alert('cancelled'), { price: 1500, availability: 'in_stock' }), { action: 'none' });
});

test('stock alert ignores unknown availability and does not repeat while available', () => {
  const alert = (status) => ({ status });
  assert.deepEqual(decideStockAlert(alert('active'), 'unknown'), { action: 'none' });
  assert.deepEqual(decideStockAlert(alert('active'), 'out_of_stock'), { action: 'none' });
  assert.deepEqual(decideStockAlert(alert('active'), 'in_stock'), { action: 'notify' });
  assert.deepEqual(decideStockAlert(alert('notified'), 'in_stock'), { action: 'none' });
  assert.deepEqual(decideStockAlert(alert('notified'), 'unknown'), { action: 'none' });
  assert.deepEqual(decideStockAlert(alert('notified'), 'out_of_stock'), { action: 'rearm' });
  assert.deepEqual(decideStockAlert(alert('paused'), 'in_stock'), { action: 'none' });
});

test('"all retailers" alerts follow the cheapest buyable listing', () => {
  const listings = [
    { id: 1, current_price: 1800, availability: 'out_of_stock' },
    { id: 2, current_price: 1990, availability: 'in_stock' },
    { id: 3, current_price: 2100, availability: 'in_stock' },
    { id: 4, current_price: null, availability: 'in_stock' },
  ];
  assert.equal(pickDecidingListing({ listing_id: null }, listings).id, 2);
  assert.equal(pickDecidingListing({ listing_id: 3 }, listings).id, 3);
  assert.equal(pickDecidingListing({ listing_id: 1 }, listings), null);
});

test('snapshots skip unchanged prices until the heartbeat, never store invalid prices', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  const last = { price: 999, availability: 'in_stock', recorded_at: new Date('2026-01-01T20:00:00Z') };
  const day = 24 * 3600 * 1000;
  assert.equal(shouldRecordSnapshot(null, { price: 999, availability: 'in_stock' }, now, day), true);
  assert.equal(shouldRecordSnapshot(last, { price: 999, availability: 'in_stock' }, now, day), false);
  assert.equal(shouldRecordSnapshot(last, { price: 949, availability: 'in_stock' }, now, day), true);
  assert.equal(shouldRecordSnapshot(last, { price: 999, availability: 'out_of_stock' }, now, day), true);
  assert.equal(shouldRecordSnapshot(last, { price: 999, availability: 'unknown' }, now, day), false);
  assert.equal(shouldRecordSnapshot(last, { price: 999, availability: 'in_stock' }, new Date('2026-01-02T21:00:00Z'), day), true);
  assert.equal(shouldRecordSnapshot(last, { price: null, availability: 'in_stock' }, now, day), false);
  assert.equal(shouldRecordSnapshot(last, { price: 0, availability: 'in_stock' }, now, day), false);
});

test('history summary reports current, lowest, highest, previous and direction', () => {
  const pts = [1200, 1100, 1150, 1050].map((price, i) => ({ price, recordedAt: `2026-01-0${i + 1}T00:00:00.000Z` }));
  const stats = summarize(pts);
  assert.equal(stats.current, 1050);
  assert.equal(stats.lowest, 1050);
  assert.equal(stats.highest, 1200);
  assert.equal(stats.previousPrice, 1150);
  assert.equal(stats.change, -100);
  assert.equal(stats.direction, 'down');
  assert.equal(summarize(pts, 1300).direction, 'up');
  assert.equal(summarize([], 100), null);
});

test('monitor backs off exponentially and never treats a failed scrape as data', () => {
  const cfg = { intervalMinutes: 360, maxBackoffMinutes: 1440 };
  assert.equal(backoffMinutes(0, cfg), 360);
  assert.equal(backoffMinutes(1, cfg), 15);
  assert.equal(backoffMinutes(2, cfg), 30);
  assert.equal(backoffMinutes(3, cfg), 60);
  assert.equal(backoffMinutes(20, cfg), 1440);

  assert.equal(interpretResult(null).ok, false);
  // URL-only fallback: name but no price and no stock signal.
  assert.equal(interpretResult({ name: 'x', price: null, availability: 'unknown', sourceNote: 'inferred' }).ok, false);
  const oos = interpretResult({ price: null, availability: 'out_of_stock' });
  assert.equal(oos.ok, true);
  assert.equal(oos.observation.price, null);
  const good = interpretResult({ price: '1,299'.replace(',', ''), availability: 'in_stock', mrp: 1999 });
  assert.equal(good.observation.price, 1299);
  assert.equal(interpretResult({ price: -5, availability: 'unknown' }).ok, false);

  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 404 }), false);
  assert.equal(isTransient(new Error('Navigation timeout of 20000 ms exceeded')), true);
});

test('transient failures are retried up to the limit', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('timeout'), { status: 503 });
      return 'ok';
    },
    { maxRetries: 2, baseDelayMs: 1 }
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw Object.assign(new Error('not found'), { status: 404 });
    }, { maxRetries: 2, baseDelayMs: 1 })
  );
  assert.equal(calls, 1);
});

test('OTP endpoints are rate-limited per IP', async () => {
  const express = require('express');
  const { otpLimiter } = require('../middleware/rateLimiter');
  const app = express();
  app.post('/otp', otpLimiter, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/otp`;
    const statuses = [];
    for (let i = 0; i < 16; i++) statuses.push((await fetch(url, { method: 'POST' })).status);
    assert.equal(statuses.filter((s) => s === 200).length, 15);
    assert.equal(statuses.at(-1), 429);
  } finally {
    server.close();
  }
});

test('listing keys only accept real store URLs for the claimed retailer', () => {
  assert.equal(listingKeyFor('amazon_in', 'https://www.amazon.in/dp/B0CHX1W1XY?ref=x'), 'amazon_in|amazon:B0CHX1W1XY');
  assert.equal(listingKeyFor('flipkart', 'https://www.amazon.in/dp/B0CHX1W1XY'), null);
  assert.equal(listingKeyFor('amazon_in', 'https://evil.example.com/dp/B0CHX1W1XY'), null);
  assert.equal(listingKeyFor('amazon_in', 'javascript:alert(1)'), null);
});

test('emails escape product text and include every required detail', () => {
  const mail = priceDropEmail({
    name: 'Priya',
    productName: '<img src=x onerror=alert(1)> Phone',
    retailer: 'Flipkart',
    previousPrice: 2500,
    currentPrice: 1950,
    targetPrice: 2000,
    productUrl: 'https://www.flipkart.com/p/itm1',
  });
  assert.doesNotMatch(mail.html, /<img src=x/);
  for (const part of ['Flipkart', '₹2,500', '₹1,950', '₹2,000', 'https://www.flipkart.com/p/itm1']) {
    assert.ok(mail.html.includes(part), part);
  }
  const code = otpEmail({ purpose: 'register', code: '123456', minutes: 5 });
  assert.match(code.html, /123456/);
  assert.match(code.text, /expires in 5 minutes/);
});
