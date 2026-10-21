// Background price & stock monitoring, independent of the Express routes.
//
// Each run picks listings that someone tracks (saved product, price alert or
// stock alert) and whose next_check_at is due, claims each one with a short
// database lock (so overlapping runs or several server processes never check the
// same listing twice), fetches it through the retailer adapter, and then:
//   success → update price/stock (only fields that were actually read), store a
//             snapshot if it changed, evaluate alerts, schedule the next check;
//   failure → keep all existing data, record last_error, back off exponentially.
const crypto = require('crypto');
const db = require('../config/db');
const config = require('../config');
const adapters = require('../adapters');
const alerts = require('./alertService');
const { recordSnapshot } = require('./priceHistoryService');
const { validPrice } = require('./catalogService');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let running = false;

// Pure: minutes until the next check after `failures` consecutive failures.
function backoffMinutes(failures, { intervalMinutes, maxBackoffMinutes } = config.monitor) {
  if (failures <= 0) return intervalMinutes;
  return Math.min(15 * 2 ** (failures - 1), maxBackoffMinutes);
}

// Pure: turn an adapter result into a usable observation, or explain why not.
// Name-only fallbacks (price unknown AND stock unknown) carry no new information.
function interpretResult(result) {
  if (!result) return { ok: false, error: 'The store page returned no product data.' };
  const price = validPrice(result.price);
  const availability = ['in_stock', 'out_of_stock'].includes(result.availability) ? result.availability : 'unknown';
  if (price == null && availability === 'unknown') {
    return { ok: false, error: result.sourceNote || 'Price and availability could not be read from the store page.' };
  }
  return {
    ok: true,
    observation: {
      price,
      mrp: validPrice(result.mrp),
      availability,
      rating: Number(result.rating) > 0 && Number(result.rating) <= 5 ? Number(result.rating) : null,
      ratingCount: Number.isInteger(result.ratingCount) ? result.ratingCount : null,
    },
  };
}

// Temporary failures worth retrying in the same run (timeouts, 429/5xx, blocks).
function isTransient(err) {
  const status = Number(err?.status);
  return !status || status === 429 || status >= 500 || /timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(String(err?.message));
}

async function withRetry(fn, { maxRetries = config.monitor.maxRetries, baseDelayMs = config.monitor.retryBaseDelayMs } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= maxRetries || !isTransient(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      attempt++;
      logger.warn('monitor.retry', { attempt, delayMs: delay, reason: String(err.message).slice(0, 160) });
      await sleep(delay);
    }
  }
}

// Listings someone cares about whose check is due and not currently locked.
async function dueListings(limit) {
  return db.query(
    `SELECT l.id, l.product_id, l.product_url, l.current_price, l.availability, l.consecutive_failures, r.slug AS retailer_slug
       FROM product_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE (l.next_check_at IS NULL OR l.next_check_at <= UTC_TIMESTAMP())
        AND (l.locked_until IS NULL OR l.locked_until < UTC_TIMESTAMP())
        AND r.is_active = 1
        AND (
          EXISTS (SELECT 1 FROM price_alerts a WHERE a.status IN ('active','triggered')
                   AND (a.listing_id = l.id OR (a.listing_id IS NULL AND a.product_id = l.product_id)))
          OR EXISTS (SELECT 1 FROM stock_alerts s WHERE s.listing_id = l.id AND s.status IN ('active','notified'))
          OR EXISTS (SELECT 1 FROM saved_products sp WHERE sp.product_id = l.product_id)
        )
      ORDER BY l.next_check_at IS NOT NULL, l.next_check_at ASC
      LIMIT ?`,
    [limit]
  );
}

async function claim(listingId) {
  const token = crypto.randomBytes(16).toString('hex');
  const result = await db.execute(
    `UPDATE product_listings SET lock_token = ?, locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE
      WHERE id = ? AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP())`,
    [token, config.monitor.lockMinutes, listingId]
  );
  return result.affectedRows ? token : null;
}

async function recordFailure(listing, token, message) {
  const failures = listing.consecutive_failures + 1;
  const minutes = backoffMinutes(failures);
  await db.execute(
    `UPDATE product_listings SET last_checked_at = UTC_TIMESTAMP(), last_error = ?, last_error_at = UTC_TIMESTAMP(),
            consecutive_failures = ?, next_check_at = UTC_TIMESTAMP() + INTERVAL ? MINUTE,
            lock_token = NULL, locked_until = NULL
      WHERE id = ? AND lock_token = ?`,
    [String(message).slice(0, 500), failures, minutes, listing.id, token]
  );
  logger.warn('monitor.check_failed', {
    listingId: listing.id,
    retailer: listing.retailer_slug,
    failures,
    nextCheckInMinutes: minutes,
    reason: String(message).slice(0, 200),
  });
}

async function recordSuccess(listing, token, obs) {
  const snapshot = await db.transaction(async (conn) => {
    await conn.execute(
      `UPDATE product_listings SET
          current_price = COALESCE(?, current_price), mrp = COALESCE(?, mrp),
          availability = IF(? = 'unknown', availability, ?),
          rating = COALESCE(?, rating), rating_count = COALESCE(?, rating_count),
          last_checked_at = UTC_TIMESTAMP(), last_success_at = UTC_TIMESTAMP(),
          last_error = NULL, consecutive_failures = 0,
          next_check_at = UTC_TIMESTAMP() + INTERVAL ? MINUTE,
          lock_token = NULL, locked_until = NULL
        WHERE id = ? AND lock_token = ?`,
      [obs.price, obs.mrp, obs.availability, obs.availability, obs.rating, obs.ratingCount, config.monitor.intervalMinutes, listing.id, token]
    );
    return obs.price != null ? recordSnapshot(conn, listing.id, obs, 'scheduled') : false;
  });

  const priceChanged = obs.price != null && Number(listing.current_price) !== obs.price;
  const stockChanged = obs.availability !== 'unknown' && obs.availability !== listing.availability;
  logger.info('monitor.check_ok', {
    listingId: listing.id,
    retailer: listing.retailer_slug,
    price: obs.price,
    previousPrice: listing.current_price,
    availability: obs.availability,
    snapshot,
  });
  if (priceChanged) logger.info('monitor.price_changed', { listingId: listing.id, from: listing.current_price, to: obs.price });
  if (stockChanged) logger.info('monitor.stock_changed', { listingId: listing.id, from: listing.availability, to: obs.availability });

  // The check itself succeeded and is saved; an alert/email problem must not undo that.
  let priceResult = { notified: 0, rearmed: 0 };
  let stockResult = { notified: 0, rearmed: 0 };
  try {
    priceResult = await alerts.evaluatePriceAlerts(listing.product_id);
    stockResult = await alerts.evaluateStockAlerts(listing.id, obs.availability);
  } catch (err) {
    logger.error('monitor.alert_evaluation_failed', { listingId: listing.id, message: err.message });
  }
  return { snapshot, priceAlerts: priceResult, stockAlerts: stockResult };
}

// Checks one listing end to end. Returns a small summary for logs/tests.
async function checkListing(listing) {
  const token = await claim(listing.id);
  if (!token) return { listingId: listing.id, skipped: 'locked' };

  await adapters.ensureLoaded();
  const adapter = adapters.getAdapterBySlug(listing.retailer_slug);
  if (!adapter || !adapter.isAvailable()) {
    await recordFailure(listing, token, `No adapter available for ${listing.retailer_slug}.`);
    return { listingId: listing.id, ok: false };
  }

  try {
    const result = await withRetry(() => adapter.extractFromUrl(listing.product_url));
    const interpreted = interpretResult(result);
    if (!interpreted.ok) {
      await recordFailure(listing, token, interpreted.error);
      return { listingId: listing.id, ok: false, error: interpreted.error };
    }
    const outcome = await recordSuccess(listing, token, interpreted.observation);
    return { listingId: listing.id, ok: true, ...outcome };
  } catch (err) {
    await recordFailure(listing, token, err.message || 'Check failed');
    return { listingId: listing.id, ok: false, error: err.message };
  }
}

// One monitoring pass. Retailers are processed in parallel (up to `concurrency`),
// listings of the same retailer one at a time with a polite delay between requests.
async function runDueChecks({ limit = config.monitor.batchSize } = {}) {
  if (running) {
    logger.info('monitor.skip_overlap', {});
    return { skipped: true };
  }
  if (!db.isAvailable() && !(await db.testConnection())) {
    logger.warn('monitor.skip_no_database', {});
    return { skipped: true, reason: 'database' };
  }
  running = true;
  const startedAt = Date.now();
  try {
    const listings = await dueListings(limit);
    if (!listings.length) return { checked: 0 };
    const byRetailer = new Map();
    for (const l of listings) {
      if (!byRetailer.has(l.retailer_slug)) byRetailer.set(l.retailer_slug, []);
      byRetailer.get(l.retailer_slug).push(l);
    }
    const queues = [...byRetailer.values()];
    const results = [];
    const workers = Array.from({ length: Math.min(config.monitor.concurrency, queues.length) }, async () => {
      while (queues.length) {
        const queue = queues.shift();
        for (const [i, listing] of queue.entries()) {
          if (i > 0) await sleep(config.monitor.requestDelayMs);
          results.push(await checkListing(listing));
        }
      }
    });
    await Promise.all(workers);
    const summary = {
      checked: results.filter((r) => !r.skipped).length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => r.ok === false).length,
      priceEmails: results.reduce((n, r) => n + (r.priceAlerts?.notified || 0), 0),
      stockEmails: results.reduce((n, r) => n + (r.stockAlerts?.notified || 0), 0),
      elapsedMs: Date.now() - startedAt,
    };
    logger.info('monitor.run_complete', summary);
    return summary;
  } catch (err) {
    logger.error('monitor.run_failed', { message: err.message });
    return { error: err.message };
  } finally {
    running = false;
  }
}

// Ask for a listing to be checked on the next run (e.g. right after a new alert).
async function scheduleSoon(listingIds) {
  if (!listingIds.length) return;
  await db.execute(
    `UPDATE product_listings SET next_check_at = UTC_TIMESTAMP() WHERE id IN (?) AND (next_check_at IS NULL OR next_check_at > UTC_TIMESTAMP())`,
    [listingIds]
  );
}

module.exports = { runDueChecks, checkListing, scheduleSoon, backoffMinutes, interpretResult, isTransient, withRetry, dueListings };
