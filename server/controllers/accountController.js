// Signed-in user's saved products, price alerts, stock alerts and notifications.
// The user id always comes from the session (req.user), never from the request,
// and every query is scoped by it — changing an id in the URL cannot reach
// another user's data (it simply returns 404).
const { asyncHandler } = require('../middleware/errorHandler');
const db = require('../config/db');
const catalog = require('../services/catalogService');
const alerts = require('../services/alertService');
const users = require('../services/userService');
const notifications = require('../services/notificationService');
const monitor = require('../services/monitorService');
const logger = require('../utils/logger');

const fail = (res, status, error) => res.status(status).json({ success: false, error });

function handle(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof alerts.AlertError) return fail(res, err.status, err.message);
      throw err;
    }
  });
}

const positiveId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Resolves the product an action refers to. The client sends what it is looking
// at — a product snapshot plus its store listings — and the server stores only
// validated identity fields (names, URLs on supported stores). Client prices are
// never trusted; the monitor fetches verified prices itself.
async function resolveProduct(body) {
  const productId = positiveId(body?.productId);
  if (productId) {
    const [row] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
    if (!row) throw new alerts.AlertError('Product not found.', 404);
    const listings = await db.query(
      'SELECT l.id, l.listing_key AS `key`, l.product_url AS productUrl, r.slug AS storeSlug FROM product_listings l JOIN retailers r ON r.id = l.retailer_id WHERE l.product_id = ?',
      [productId]
    );
    return { productId, listings };
  }
  const product = body?.product;
  const offers = Array.isArray(body?.offers) ? body.offers.slice(0, 20) : [];
  if (!product || typeof product !== 'object' || !String(product.name || '').trim()) {
    throw new alerts.AlertError('Product details are required.');
  }
  if (!offers.length) throw new alerts.AlertError('At least one store listing is required.');
  const resolved = await catalog.ensureProductWithListings(
    {
      name: String(product.name).slice(0, 500),
      brand: product.brand ? String(product.brand).slice(0, 150) : '',
      category: product.category ? String(product.category).slice(0, 150) : '',
      imageUrl: product.imageUrl,
      specifications: product.specifications && typeof product.specifications === 'object' ? product.specifications : {},
    },
    offers,
    { observations: false }
  );
  if (!resolved.productId) throw new alerts.AlertError('None of the store links are valid Amazon.in, Flipkart or Myntra product pages.');
  return resolved;
}

// Picks one listing of the resolved product from { storeSlug, productUrl } or listingId.
function pickListing(resolved, body) {
  const listingId = positiveId(body?.listingId);
  if (listingId) return resolved.listings.find((l) => l.id === listingId) || null;
  if (body?.productUrl && body?.storeSlug) {
    const key = catalog.listingKeyFor(String(body.storeSlug), String(body.productUrl));
    return resolved.listings.find((l) => l.key === key) || null;
  }
  return null;
}

// ---------- dashboard & saved products ----------

const dashboard = handle(async (req, res) => {
  res.json({ success: true, data: { user: req.user, ...(await users.dashboard(req.user.id)) } });
});

const listSaved = handle(async (req, res) => {
  res.json({ success: true, data: { items: await users.listSaved(req.user.id) } });
});

const saveProduct = handle(async (req, res) => {
  const resolved = await resolveProduct(req.body);
  await users.saveProduct(req.user.id, resolved.productId, req.body?.clientKey);
  await monitor.scheduleSoon(resolved.listings.map((l) => l.id)).catch(() => {});
  logger.info('saved.added', { userId: req.user.id, productId: resolved.productId });
  res.status(201).json({ success: true, data: { productId: resolved.productId } });
});

const unsaveProduct = handle(async (req, res) => {
  const productId = positiveId(req.params.productId);
  if (!productId) return fail(res, 400, 'Invalid product id.');
  if (!(await users.unsaveProduct(req.user.id, productId))) return fail(res, 404, 'Saved product not found.');
  res.json({ success: true, data: { removed: true } });
});

// ---------- price alerts ----------

const listPriceAlerts = handle(async (req, res) => {
  res.json({ success: true, data: { items: await alerts.listPriceAlerts(req.user.id) } });
});

const createPriceAlert = handle(async (req, res) => {
  const resolved = await resolveProduct(req.body);
  let listingId = null;
  if (req.body?.scope === 'retailer' || req.body?.listingId || (req.body?.productUrl && req.body?.storeSlug)) {
    const listing = pickListing(resolved, req.body);
    if (!listing) return fail(res, 400, 'Choose a valid retailer listing for this product.');
    listingId = listing.id;
  }
  const alert = await alerts.createPriceAlert(req.user.id, {
    productId: resolved.productId,
    listingId,
    targetPrice: req.body?.targetPrice,
  });
  // Get a verified price soon rather than waiting for the regular interval.
  await monitor.scheduleSoon(listingId ? [listingId] : resolved.listings.map((l) => l.id)).catch(() => {});
  logger.info('alert.price_created', { userId: req.user.id, alertId: alert.id });
  res.status(201).json({ success: true, data: { alert } });
});

const updatePriceAlert = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid alert id.');
  const alert = await alerts.updatePriceAlert(req.user.id, id, {
    targetPrice: req.body?.targetPrice,
    action: req.body?.action,
  });
  res.json({ success: true, data: { alert } });
});

const deletePriceAlert = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid alert id.');
  await alerts.deletePriceAlert(req.user.id, id);
  res.json({ success: true, data: { deleted: true } });
});

// ---------- stock alerts ----------

const listStockAlerts = handle(async (req, res) => {
  res.json({ success: true, data: { items: await alerts.listStockAlerts(req.user.id) } });
});

const createStockAlert = handle(async (req, res) => {
  const resolved = await resolveProduct(req.body);
  const listing = pickListing(resolved, req.body);
  if (!listing) return fail(res, 400, 'Choose the store listing you want to be notified about.');
  const alert = await alerts.createStockAlert(req.user.id, listing.id);
  await monitor.scheduleSoon([listing.id]).catch(() => {});
  logger.info('alert.stock_created', { userId: req.user.id, alertId: alert.id });
  res.status(201).json({ success: true, data: { alert } });
});

const updateStockAlert = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid subscription id.');
  const alert = await alerts.updateStockAlert(req.user.id, id, { action: req.body?.action });
  res.json({ success: true, data: { alert } });
});

const deleteStockAlert = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid subscription id.');
  await alerts.deleteStockAlert(req.user.id, id);
  res.json({ success: true, data: { deleted: true } });
});

// ---------- notifications ----------

const listNotifications = handle(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({ success: true, data: await notifications.listForUser(req.user.id, { limit, offset }) });
});

module.exports = {
  dashboard,
  listSaved,
  saveProduct,
  unsaveProduct,
  listPriceAlerts,
  createPriceAlert,
  updatePriceAlert,
  deletePriceAlert,
  listStockAlerts,
  createStockAlert,
  updateStockAlert,
  deleteStockAlert,
  listNotifications,
};
