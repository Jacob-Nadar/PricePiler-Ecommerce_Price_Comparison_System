const { asyncHandler } = require('../middleware/errorHandler');
const productService = require('../services/productService');
const comparison = require('../services/comparisonService');
const adapters = require('../adapters');
const priceHistory = require('../services/priceHistoryService');
const db = require('../config/db');
const mailer = require('../services/email/mailer');
const config = require('../config');
const { parseStoreFromUrl, resolveStoreUrl } = require('../utils/httpClient');
const { safeDiagnosticMessage } = require('../utils/scraperDebug');
const { buildSearchQuery } = require('../utils/matchUtils');
const { normalizeText } = require('../utils/productUtils');

const health = asyncHandler(async (_req, res) => {
  const dbOk = await require('../config/db').testConnection();
  const adapterList = adapters.getAdapters().map((a) => ({
    slug: a.slug,
    name: a.store.name,
    available: a.isAvailable(),
  }));
  res.json({
    success: true,
    data: {
      status: 'ok',
      database: dbOk ? 'connected' : 'disconnected',
      email: mailer.mode(),
      monitor: { enabled: config.monitor.enabled, cron: config.monitor.cron, intervalMinutes: config.monitor.intervalMinutes },
      adapters: adapterList,
      mode: 'live',
      timestamp: new Date().toISOString(),
    },
  });
});

function enrichResult(r) {
  const cmp = comparison.compareOffers(r.offers);
  return {
    name: r.name,
    query: r.query || r.name,
    brand: r.brand,
    model: r.model,
    category: r.category,
    imageUrl: r.imageUrl,
    specifications: r.specifications,
    rating: r.rating ?? null,
    ratingCount: r.ratingCount ?? null,
    storeStatus: r.storeStatus || [],
    source: 'live',
    offers: cmp.offers,
    bestOffer: cmp.bestOffer,
    bestOfferId: cmp.bestOfferId,
    hasInStock: cmp.hasInStock,
    noInStockReason: cmp.noInStockReason,
    savings: cmp.savings,
    note: cmp.note,
  };
}

// Adds price-history stats to every offer (and records this search's prices), then
// computes the comparison for each product.
async function enrichAll(results) {
  const prepared = await priceHistory.prepareSearchResults(results);
  return prepared.map(enrichResult);
}

const isFresh = (req) => /^(1|true|yes)$/i.test(String(req.query.fresh || req.body?.fresh || ''));

// Search every store for one specific product (manual brand/model search or a pasted
// URL) and return a single comparison containing every matching listing.
async function compareTargetProduct({ name, brand, model, specifications }, { fresh, source }) {
  const core = buildSearchQuery([model, name].filter(Boolean).join(' '), '');
  const storeQuery = buildSearchQuery(core, brand);
  // Listing titles often omit the brand ("iPhone 15 (128 GB) - Black"), so match on
  // the model name alone; sameProduct still rejects a conflicting brand.
  const brandWords = new Set(normalizeText(brand).split(' ').filter(Boolean));
  const withoutBrand = normalizeText(core)
    .split(' ')
    .filter((word) => !brandWords.has(word))
    .join(' ');
  const matchQuery = withoutBrand || core;
  const capacity = ['ram', 'storage']
    .map((key) => specifications?.[key])
    .filter(Boolean)
    .join(' ');

  const { results, storeStatus } = await productService.searchProducts(
    [storeQuery, capacity].filter(Boolean).join(' '),
    { matchQuery, fresh }
  );
  await productService.recordSearch(storeQuery, source, results.length);

  const target = { name: core, brand, model, specifications };
  const seen = new Set();
  const candidates = [];
  let base = null;
  for (const result of results) {
    const matched = comparison.matchProductToOffers(target, result.offers).candidates;
    if (matched.length && !base) base = result;
    for (const offer of matched) {
      const key = `${offer.storeSlug}::${offer.externalId || offer.productUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(offer);
    }
  }

  const enriched = base ? await enrichAll([{ ...base, offers: candidates, storeStatus }]) : [];
  return { query: storeQuery, results: enriched, storeStatus };
}

const searchProducts = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const q = String(req.query.q || body.q || '').trim();
  const category = String(req.query.category || body.category || '').trim();
  const query = q || category;
  const search = !q && category
    ? productService.searchCategoryProducts(category)
    : productService.searchProducts(query, { fresh: isFresh(req) });
  const { results, storeStatus } = await search;
  await productService.recordSearch(query, 'manual', results.length);

  res.json({
    success: true,
    data: {
      query: q,
      category: category || null,
      count: results.length,
      results: await enrichAll(results),
      storeStatus,
    },
  });
});

const searchProductsPost = asyncHandler(async (req, res) => {
  const { category } = req.body;
  const { query, results, storeStatus } = await compareTargetProduct(req.body, {
    fresh: isFresh(req),
    source: 'manual',
  });

  res.json({
    success: true,
    data: {
      query,
      category: category || null,
      count: results.length,
      results,
      storeStatus,
    },
  });
});

// Recorded price series for a set of offers (identified by store + product URL).
const getOfferHistory = asyncHandler(async (req, res) => {
  const offers = Array.isArray(req.body?.offers) ? req.body.offers.slice(0, 50) : null;
  if (!offers) {
    return res.status(400).json({ success: false, error: 'offers must be an array' });
  }
  const valid = offers.filter(
    (o) => o && typeof o.storeSlug === 'string' && typeof o.productUrl === 'string' && parseStoreFromUrl(o.productUrl)
  );
  const range = priceHistory.RANGES[req.body?.range] !== undefined ? req.body.range : 'all';
  const data = await priceHistory.getHistory({ offers: valid, range });
  res.json({ success: true, data: { history: data.series, range: data.range, source: data.source } });
});

const extractUrl = asyncHandler(async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  const storeSlug = parseStoreFromUrl(rawUrl);
  if (!storeSlug) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported website. Currently supported: amazon.in, flipkart.com, and myntra.com.',
    });
  }

  const url = await resolveStoreUrl(rawUrl);

  await adapters.ensureLoaded();
  const adapter = adapters.getAdapterBySlug(storeSlug);
  if (!adapter || !adapter.isAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'Live store adapter is not available for this URL.',
    });
  }

  let product;
  try {
    product = await adapter.extractFromUrl(url);
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 502;
    console.warn(`[extract] ${storeSlug} failed:`, safeDiagnosticMessage(error.message));
    return res.status(status).json({
      success: false,
      error: `Could not extract product details from this store: ${safeDiagnosticMessage(error.message)}`,
    });
  }
  if (!product) {
    return res.status(404).json({
      success: false,
      error: 'Could not extract product details from this URL.',
    });
  }

  res.json({
    success: true,
    data: {
      ...product,
      storeSlug,
      source: 'live',
      sourceNote: product.sourceNote || 'Live price and stock extracted from the store website.',
    },
  });
});

const compareProduct = asyncHandler(async (req, res) => {
  const { query, results, storeStatus } = await compareTargetProduct(req.body, {
    fresh: isFresh(req),
    source: 'url',
  });

  res.json({
    success: true,
    data: {
      query,
      count: results.length,
      results,
      storeStatus,
    },
  });
});

// A stored product (MySQL) in the same shape as a live search result.
async function loadStoredProduct(id) {
  const [product] = await db.query('SELECT id, name, brand, category, image_url, specifications FROM products WHERE id = ?', [id]);
  if (!product) return null;
  const listings = await db.query(
    `SELECT l.id, l.title, l.product_url, l.image_url, l.current_price, l.mrp, l.availability, l.rating, l.rating_count,
            l.last_success_at, l.variant_label, l.external_id, r.slug, r.name AS store_name
       FROM product_listings l JOIN retailers r ON r.id = l.retailer_id WHERE l.product_id = ?`,
    [id]
  );
  const offers = listings.map((l) => ({
    id: l.id,
    listingId: l.id,
    storeSlug: l.slug,
    storeName: l.store_name,
    externalId: l.external_id,
    title: l.title,
    name: l.title,
    productUrl: l.product_url,
    imageUrl: l.image_url,
    price: l.current_price,
    mrp: l.mrp,
    discountPercent: l.mrp && l.current_price ? Math.round(((l.mrp - l.current_price) / l.mrp) * 100) : null,
    rating: l.rating,
    ratingCount: l.rating_count,
    availability: l.availability,
    lastChecked: l.last_success_at,
    variant: l.variant_label,
  }));
  const cmp = comparison.compareOffers(offers);
  const rated = offers.filter((o) => o.rating).sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0))[0];
  return {
    id: product.id,
    productId: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    imageUrl: product.image_url || offers.find((o) => o.imageUrl)?.imageUrl || '',
    specifications: typeof product.specifications === 'string' ? JSON.parse(product.specifications) : product.specifications || {},
    rating: rated?.rating ?? null,
    ratingCount: rated?.ratingCount ?? null,
    source: 'database',
    offers: cmp.offers,
    bestOffer: cmp.bestOffer,
    hasInStock: cmp.hasInStock,
    noInStockReason: cmp.noInStockReason,
    savings: cmp.savings,
    note: cmp.note,
  };
}

const productIdParam = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid product id' });
    return null;
  }
  if (!db.isAvailable()) {
    res.status(503).json({ success: false, error: 'Stored products need the MySQL database, which is not connected.' });
    return null;
  }
  return id;
};

const getProduct = asyncHandler(async (req, res) => {
  const id = productIdParam(req, res);
  if (!id) return;
  const product = await loadStoredProduct(id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, data: product });
});

const getProductOffers = asyncHandler(async (req, res) => {
  const id = productIdParam(req, res);
  if (!id) return;
  const product = await loadStoredProduct(id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  const { offers, bestOffer, hasInStock, noInStockReason, savings } = product;
  res.json({ success: true, data: { productId: id, offers, bestOffer, hasInStock, noInStockReason, savings } });
});

// GET /api/products/:id/price-history?range=7d|30d|90d|all
const getPriceHistory = asyncHandler(async (req, res) => {
  const id = productIdParam(req, res);
  if (!id) return;
  const listings = await db.query('SELECT id FROM product_listings WHERE product_id = ?', [id]);
  const range = priceHistory.RANGES[req.query.range] !== undefined ? req.query.range : 'all';
  const data = await priceHistory.getHistory({ listingIds: listings.map((l) => l.id), range });
  res.json({ success: true, data: { productId: id, range: data.range, history: data.series } });
});

module.exports = {
  health,
  searchProducts,
  searchProductsPost,
  extractUrl,
  compareProduct,
  getOfferHistory,
  getProduct,
  getProductOffers,
  getPriceHistory,
};
