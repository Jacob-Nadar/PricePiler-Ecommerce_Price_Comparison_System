// Price-drop and back-in-stock alerts: CRUD for the owning user, and evaluation
// after each successful monitor check.
//
// Price alert lifecycle
//   active ──price ≤ target──▶ triggered (email sent once for this cycle)
//   triggered ──price > target──▶ active, notify_cycle + 1 (eligible for a new email)
//   paused / cancelled: never evaluated. Resume returns to active.
// Stock alert lifecycle
//   active ──confirmed in stock──▶ notified (email sent once)
//   notified ──confirmed out of stock──▶ active, notify_cycle + 1
//   "unknown" availability (blocked page, scrape failure) never changes anything.
const db = require('../config/db');
const notifications = require('./notificationService');
const { priceDropEmail, backInStockEmail } = require('./email/templates');
const logger = require('../utils/logger');

class AlertError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- pure decision functions (unit-tested) ----------

// observation: { price, availability } of the listing that decides this alert.
function decidePriceAlert(alert, observation) {
  if (!alert || !['active', 'triggered'].includes(alert.status)) return { action: 'none' };
  const price = observation?.price;
  if (price == null || !(Number(price) > 0)) return { action: 'none' };
  // A price you cannot buy at is not a deal.
  if (observation.availability === 'out_of_stock') return { action: 'none' };
  const target = Number(alert.target_price);
  if (Number(price) <= target) {
    return alert.status === 'active' ? { action: 'notify' } : { action: 'none' };
  }
  return alert.status === 'triggered' ? { action: 'rearm' } : { action: 'none' };
}

function decideStockAlert(alert, availability) {
  if (!alert || !['active', 'notified'].includes(alert.status)) return { action: 'none' };
  if (availability === 'in_stock') return alert.status === 'active' ? { action: 'notify' } : { action: 'none' };
  if (availability === 'out_of_stock') return alert.status === 'notified' ? { action: 'rearm' } : { action: 'none' };
  return { action: 'none' }; // unknown: a failed or blocked check is never a stock event
}

// The listing that decides an alert: the chosen one, or the cheapest buyable one.
function pickDecidingListing(alert, listings) {
  const candidates = listings.filter(
    (l) => (alert.listing_id ? l.id === alert.listing_id : true) && l.current_price != null && l.availability !== 'out_of_stock'
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, l) => (Number(l.current_price) < Number(best.current_price) ? l : best));
}

// ---------- evaluation (called by the monitor) ----------

async function listingsForProduct(productId) {
  return db.query(
    `SELECT l.*, r.name AS retailer_name, r.slug AS retailer_slug, p.name AS product_name, p.image_url AS product_image
       FROM product_listings l
       JOIN retailers r ON r.id = l.retailer_id
       JOIN products p ON p.id = l.product_id
      WHERE l.product_id = ?`,
    [productId]
  );
}

async function evaluatePriceAlerts(productId) {
  const alerts = await db.query(
    `SELECT a.*, u.email, u.full_name FROM price_alerts a JOIN users u ON u.id = a.user_id
      WHERE a.product_id = ? AND a.status IN ('active','triggered')`,
    [productId]
  );
  if (!alerts.length) return { notified: 0, rearmed: 0 };
  const listings = await listingsForProduct(productId);
  let notified = 0;
  let rearmed = 0;

  for (const alert of alerts) {
    const listing = pickDecidingListing(alert, listings);
    // For a single-retailer alert that is currently out of stock, keep the
    // listing's price for re-arm decisions but never notify.
    const scoped = alert.listing_id ? listings.find((l) => l.id === alert.listing_id) : null;
    const observation = listing
      ? { price: listing.current_price, availability: listing.availability }
      : scoped
        ? { price: scoped.current_price, availability: scoped.availability }
        : null;
    const decision = decidePriceAlert(alert, observation);

    if (decision.action === 'rearm') {
      const result = await db.execute(
        `UPDATE price_alerts SET status = 'active', notify_cycle = notify_cycle + 1, last_seen_price = ?
          WHERE id = ? AND status = 'triggered' AND notify_cycle = ?`,
        [observation.price, alert.id, alert.notify_cycle]
      );
      if (result.affectedRows) {
        rearmed++;
        logger.info('alert.price_rearmed', { alertId: alert.id, price: observation.price });
      }
      continue;
    }

    if (decision.action === 'notify') {
      // Claim the state transition first; a concurrent run sees affectedRows = 0.
      const claimed = await db.execute(
        `UPDATE price_alerts SET status = 'triggered', last_notified_at = UTC_TIMESTAMP(),
                last_notified_price = ?, last_notified_listing_id = ?, last_seen_price = ?
          WHERE id = ? AND status = 'active' AND notify_cycle = ?`,
        [listing.current_price, listing.id, listing.current_price, alert.id, alert.notify_cycle]
      );
      if (!claimed.affectedRows) continue;
      const previousPrice = alert.last_seen_price ?? alert.price_at_creation;
      const outcome = await notifications.send({
        to: alert.email,
        userId: alert.user_id,
        type: 'price_drop',
        eventKey: `price_drop:${alert.id}:${alert.notify_cycle}`,
        priceAlertId: alert.id,
        listingId: listing.id,
        details: {
          productName: listing.product_name,
          retailer: listing.retailer_name,
          previousPrice,
          currentPrice: Number(listing.current_price),
          targetPrice: Number(alert.target_price),
          productUrl: listing.product_url,
        },
        email: priceDropEmail({
          name: alert.full_name,
          productName: listing.product_name,
          retailer: listing.retailer_name,
          previousPrice,
          currentPrice: listing.current_price,
          targetPrice: alert.target_price,
          productUrl: listing.product_url,
          imageUrl: listing.image_url || listing.product_image,
        }),
      });
      if (outcome.status === 'failed') {
        // Undo so the next check retries; the failed attempt stays in the log.
        await db.execute(
          `UPDATE price_alerts SET status = 'active', notify_cycle = notify_cycle + 1 WHERE id = ? AND status = 'triggered'`,
          [alert.id]
        );
        logger.warn('alert.price_email_failed_will_retry', { alertId: alert.id });
      } else {
        notified++;
        logger.info('alert.price_triggered', { alertId: alert.id, listingId: listing.id, price: listing.current_price, target: alert.target_price });
      }
      continue;
    }

    if (observation?.price != null && Number(observation.price) !== Number(alert.last_seen_price)) {
      await db.execute('UPDATE price_alerts SET last_seen_price = ? WHERE id = ?', [observation.price, alert.id]);
    }
  }
  return { notified, rearmed };
}

async function evaluateStockAlerts(listingId, availability) {
  if (availability === 'unknown' || !availability) return { notified: 0, rearmed: 0 };
  const alerts = await db.query(
    `SELECT s.*, u.email, u.full_name FROM stock_alerts s JOIN users u ON u.id = s.user_id
      WHERE s.listing_id = ? AND s.status IN ('active','notified')`,
    [listingId]
  );
  if (!alerts.length) return { notified: 0, rearmed: 0 };
  const [listing] = await db.query(
    `SELECT l.*, r.name AS retailer_name, p.name AS product_name, p.image_url AS product_image
       FROM product_listings l JOIN retailers r ON r.id = l.retailer_id JOIN products p ON p.id = l.product_id
      WHERE l.id = ?`,
    [listingId]
  );
  let notified = 0;
  let rearmed = 0;
  for (const alert of alerts) {
    const decision = decideStockAlert(alert, availability);
    if (decision.action === 'rearm') {
      const result = await db.execute(
        `UPDATE stock_alerts SET status = 'active', notify_cycle = notify_cycle + 1 WHERE id = ? AND status = 'notified' AND notify_cycle = ?`,
        [alert.id, alert.notify_cycle]
      );
      if (result.affectedRows) rearmed++;
      continue;
    }
    if (decision.action !== 'notify') continue;
    const claimed = await db.execute(
      `UPDATE stock_alerts SET status = 'notified', last_notified_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active' AND notify_cycle = ?`,
      [alert.id, alert.notify_cycle]
    );
    if (!claimed.affectedRows) continue;
    const outcome = await notifications.send({
      to: alert.email,
      userId: alert.user_id,
      type: 'back_in_stock',
      eventKey: `back_in_stock:${alert.id}:${alert.notify_cycle}`,
      stockAlertId: alert.id,
      listingId,
      details: {
        productName: listing.product_name,
        retailer: listing.retailer_name,
        availability: 'in_stock',
        price: listing.current_price,
        productUrl: listing.product_url,
      },
      email: backInStockEmail({
        name: alert.full_name,
        productName: listing.product_name,
        retailer: listing.retailer_name,
        price: listing.current_price,
        productUrl: listing.product_url,
        imageUrl: listing.image_url || listing.product_image,
      }),
    });
    if (outcome.status === 'failed') {
      await db.execute(
        `UPDATE stock_alerts SET status = 'active', notify_cycle = notify_cycle + 1 WHERE id = ? AND status = 'notified'`,
        [alert.id]
      );
    } else {
      notified++;
      logger.info('alert.stock_triggered', { alertId: alert.id, listingId });
    }
  }
  return { notified, rearmed };
}

// ---------- CRUD for the signed-in user (every query is scoped by user_id) ----------

const PRICE_ALERT_SELECT = `
  SELECT a.id, a.product_id AS productId, a.listing_id AS listingId, a.target_price AS targetPrice, a.status,
         a.price_at_creation AS priceAtCreation, a.last_seen_price AS lastSeenPrice,
         a.last_notified_at AS lastNotifiedAt, a.last_notified_price AS lastNotifiedPrice,
         a.created_at AS createdAt, a.updated_at AS updatedAt,
         p.name AS productName, p.brand, p.image_url AS imageUrl,
         l.product_url AS listingUrl, l.current_price AS listingPrice, l.availability AS listingAvailability,
         r.name AS retailerName, r.slug AS retailerSlug
    FROM price_alerts a
    JOIN products p ON p.id = a.product_id
    LEFT JOIN product_listings l ON l.id = a.listing_id
    LEFT JOIN retailers r ON r.id = l.retailer_id`;

async function bestPrices(productIds) {
  if (!productIds.length) return new Map();
  const rows = await db.query(
    `SELECT l.product_id, l.id, l.current_price, l.availability, l.product_url, l.last_success_at, r.name AS retailer_name, r.slug AS retailer_slug
       FROM product_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE l.product_id IN (?)`,
    [productIds]
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(row);
  }
  return map;
}

async function listPriceAlerts(userId) {
  const rows = await db.query(`${PRICE_ALERT_SELECT} WHERE a.user_id = ? ORDER BY a.updated_at DESC`, [userId]);
  const listings = await bestPrices([...new Set(rows.map((r) => r.productId))]);
  return rows.map((row) => {
    const all = listings.get(row.productId) || [];
    const deciding = pickDecidingListing({ listing_id: row.listingId }, all);
    const lastChecked = all.reduce((t, l) => (l.last_success_at && (!t || l.last_success_at > t) ? l.last_success_at : t), null);
    return {
      ...row,
      scope: row.listingId ? 'retailer' : 'all',
      currentPrice: deciding ? Number(deciding.current_price) : null,
      currentRetailer: deciding?.retailer_name || null,
      currentUrl: deciding?.product_url || row.listingUrl || null,
      lastCheckedAt: lastChecked,
    };
  });
}

async function getPriceAlert(userId, alertId) {
  const [row] = await db.query(`${PRICE_ALERT_SELECT} WHERE a.user_id = ? AND a.id = ?`, [userId, alertId]);
  return row || null;
}

function parseTarget(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AlertError('Target price must be a positive number.');
  if (n > 10_000_000) throw new AlertError('Target price is too large.');
  return Math.round(n * 100) / 100;
}

async function createPriceAlert(userId, { productId, listingId, targetPrice }) {
  const target = parseTarget(targetPrice);
  const listings = await db.query('SELECT id, current_price, availability FROM product_listings WHERE product_id = ?', [productId]);
  if (listingId && !listings.some((l) => l.id === listingId)) throw new AlertError('That retailer listing does not belong to this product.');
  const deciding = pickDecidingListing({ listing_id: listingId || null }, listings);
  const scopeKey = listingId || 0;
  try {
    const result = await db.execute(
      `INSERT INTO price_alerts (user_id, product_id, listing_id, scope_key, target_price, status, price_at_creation, last_seen_price)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [userId, productId, listingId || null, scopeKey, target, deciding?.current_price ?? null, deciding?.current_price ?? null]
    );
    return getPriceAlert(userId, result.insertId);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Same product + retailer scope already has an alert: update its target and reactivate it.
      await db.execute(
        `UPDATE price_alerts SET target_price = ?, status = 'active', notify_cycle = notify_cycle + 1
          WHERE user_id = ? AND product_id = ? AND scope_key = ?`,
        [target, userId, productId, scopeKey]
      );
      const [row] = await db.query('SELECT id FROM price_alerts WHERE user_id = ? AND product_id = ? AND scope_key = ?', [userId, productId, scopeKey]);
      return getPriceAlert(userId, row.id);
    }
    throw err;
  }
}

const STATUS_CHANGES = { pause: 'paused', resume: 'active', cancel: 'cancelled' };

async function updatePriceAlert(userId, alertId, { targetPrice, action }) {
  const existing = await getPriceAlert(userId, alertId);
  if (!existing) throw new AlertError('Alert not found.', 404);
  const sets = [];
  const params = [];
  if (targetPrice !== undefined) {
    sets.push('target_price = ?');
    params.push(parseTarget(targetPrice));
    // A new target is a new question: allow a fresh notification.
    if (existing.status === 'triggered') sets.push("status = 'active'", 'notify_cycle = notify_cycle + 1');
  }
  if (action !== undefined) {
    const status = STATUS_CHANGES[action];
    if (!status) throw new AlertError('Unknown action.');
    if (existing.status === 'cancelled' && action === 'pause') throw new AlertError('A cancelled alert cannot be paused. Resume it first.');
    sets.push('status = ?');
    params.push(status);
    if (action === 'resume') sets.push('notify_cycle = notify_cycle + 1');
  }
  if (!sets.length) throw new AlertError('Nothing to update.');
  await db.execute(`UPDATE price_alerts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, alertId, userId]);
  return getPriceAlert(userId, alertId);
}

async function deletePriceAlert(userId, alertId) {
  const result = await db.execute('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [alertId, userId]);
  if (!result.affectedRows) throw new AlertError('Alert not found.', 404);
}

const STOCK_ALERT_SELECT = `
  SELECT s.id, s.listing_id AS listingId, s.status, s.last_notified_at AS lastNotifiedAt,
         s.created_at AS createdAt, s.updated_at AS updatedAt,
         l.title AS listingTitle, l.product_url AS productUrl, l.current_price AS currentPrice,
         l.availability, l.last_success_at AS lastCheckedAt, l.variant_label AS variant,
         p.id AS productId, p.name AS productName, p.image_url AS imageUrl,
         r.name AS retailerName, r.slug AS retailerSlug
    FROM stock_alerts s
    JOIN product_listings l ON l.id = s.listing_id
    JOIN products p ON p.id = l.product_id
    JOIN retailers r ON r.id = s.retailer_id`;

async function listStockAlerts(userId) {
  return db.query(`${STOCK_ALERT_SELECT} WHERE s.user_id = ? ORDER BY s.updated_at DESC`, [userId]);
}

async function getStockAlert(userId, alertId) {
  const [row] = await db.query(`${STOCK_ALERT_SELECT} WHERE s.user_id = ? AND s.id = ?`, [userId, alertId]);
  return row || null;
}

async function createStockAlert(userId, listingId) {
  const [listing] = await db.query('SELECT id, retailer_id, availability FROM product_listings WHERE id = ?', [listingId]);
  if (!listing) throw new AlertError('Listing not found.', 404);
  if (listing.availability === 'in_stock') {
    throw new AlertError('This listing is in stock right now, so there is nothing to wait for.', 409);
  }
  await db.execute(
    `INSERT INTO stock_alerts (user_id, listing_id, retailer_id, status) VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE status = IF(status = 'notified', status, 'active')`,
    [userId, listing.id, listing.retailer_id]
  );
  const [row] = await db.query('SELECT id FROM stock_alerts WHERE user_id = ? AND listing_id = ?', [userId, listing.id]);
  return getStockAlert(userId, row.id);
}

async function updateStockAlert(userId, alertId, { action }) {
  const existing = await getStockAlert(userId, alertId);
  if (!existing) throw new AlertError('Subscription not found.', 404);
  const status = STATUS_CHANGES[action];
  if (!status) throw new AlertError('Unknown action.');
  await db.execute(
    `UPDATE stock_alerts SET status = ?, notify_cycle = notify_cycle + IF(? = 'active', 1, 0) WHERE id = ? AND user_id = ?`,
    [status, status, alertId, userId]
  );
  return getStockAlert(userId, alertId);
}

async function deleteStockAlert(userId, alertId) {
  const result = await db.execute('DELETE FROM stock_alerts WHERE id = ? AND user_id = ?', [alertId, userId]);
  if (!result.affectedRows) throw new AlertError('Subscription not found.', 404);
}

module.exports = {
  AlertError,
  decidePriceAlert,
  decideStockAlert,
  pickDecidingListing,
  evaluatePriceAlerts,
  evaluateStockAlerts,
  listPriceAlerts,
  getPriceAlert,
  createPriceAlert,
  updatePriceAlert,
  deletePriceAlert,
  listStockAlerts,
  getStockAlert,
  createStockAlert,
  updateStockAlert,
  deleteStockAlert,
};
