// Saved products and the dashboard for the signed-in user.
const db = require('../config/db');
const alerts = require('./alertService');
const notifications = require('./notificationService');

async function listSaved(userId) {
  const rows = await db.query(
    `SELECT sp.product_id AS productId, sp.client_key AS clientKey, sp.created_at AS savedAt,
            p.name, p.brand, p.image_url AS imageUrl, p.specifications
       FROM saved_products sp JOIN products p ON p.id = sp.product_id
      WHERE sp.user_id = ? ORDER BY sp.created_at DESC`,
    [userId]
  );
  if (!rows.length) return [];
  const listings = await db.query(
    `SELECT l.id, l.product_id, l.title, l.product_url AS productUrl, l.current_price AS price, l.mrp,
            l.availability, l.last_success_at AS lastChecked, l.variant_label AS variant,
            r.slug AS storeSlug, r.name AS storeName
       FROM product_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE l.product_id IN (?)`,
    [rows.map((r) => r.productId)]
  );
  const firstPrice = await db.query(
    `SELECT l.product_id, MIN(ph.price) AS lowest
       FROM price_history ph JOIN product_listings l ON l.id = ph.listing_id
      WHERE l.product_id IN (?) GROUP BY l.product_id`,
    [rows.map((r) => r.productId)]
  );
  const lowestByProduct = new Map(firstPrice.map((r) => [r.product_id, Number(r.lowest)]));
  return rows.map((row) => {
    const offers = listings
      .filter((l) => l.product_id === row.productId)
      .map(({ product_id, ...l }) => ({ ...l, listingId: l.id }));
    const buyable = offers.filter((o) => o.price != null && o.availability !== 'out_of_stock');
    const best = buyable.length ? buyable.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const lastChecked = offers.reduce((t, o) => (o.lastChecked && (!t || o.lastChecked > t) ? o.lastChecked : t), null);
    return {
      ...row,
      specifications: typeof row.specifications === 'string' ? JSON.parse(row.specifications) : row.specifications || {},
      offers,
      bestOffer: best,
      lowestRecorded: lowestByProduct.get(row.productId) ?? null,
      lastChecked,
    };
  });
}

async function saveProduct(userId, productId, clientKey) {
  await db.execute(
    `INSERT INTO saved_products (user_id, product_id, client_key) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE client_key = COALESCE(VALUES(client_key), client_key)`,
    [userId, productId, clientKey ? String(clientKey).slice(0, 64) : null]
  );
}

async function unsaveProduct(userId, productId) {
  const result = await db.execute('DELETE FROM saved_products WHERE user_id = ? AND product_id = ?', [userId, productId]);
  return result.affectedRows > 0;
}

async function dashboard(userId) {
  const [saved, priceAlerts, stockAlerts, recent] = await Promise.all([
    listSaved(userId),
    alerts.listPriceAlerts(userId),
    alerts.listStockAlerts(userId),
    notifications.listForUser(userId, { limit: 10 }),
  ]);
  const count = (list, statuses) => list.filter((a) => statuses.includes(a.status)).length;
  return {
    stats: {
      savedProducts: saved.length,
      activePriceAlerts: count(priceAlerts, ['active']),
      triggeredPriceAlerts: count(priceAlerts, ['triggered']),
      activeStockAlerts: count(stockAlerts, ['active']),
      notifications: recent.total,
    },
    saved,
    priceAlerts,
    stockAlerts,
    notifications: recent.items,
  };
}

module.exports = { listSaved, saveProduct, unsaveProduct, dashboard };
