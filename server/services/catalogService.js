// Products and retailer listings in MySQL. Search results and user actions
// (save, alert) go through here so every listing has one row keyed by a stable,
// URL-derived listing_key.
const db = require('../config/db');
const { parseStoreFromUrl } = require('../utils/httpClient');
const { offerKey } = require('./priceTracker');
const { normalizeText } = require('../utils/productUtils');

let retailerCache = null;

async function retailers() {
  if (!retailerCache) {
    const rows = await db.query('SELECT id, slug, name FROM retailers');
    retailerCache = new Map(rows.map((r) => [r.slug, r]));
  }
  return retailerCache;
}

// Stable listing identity, or null when the URL is not a supported store page
// for the claimed retailer (rejects spoofed or mismatched client input).
function listingKeyFor(storeSlug, productUrl) {
  if (typeof productUrl !== 'string' || productUrl.length > 1000) return null;
  if (parseStoreFromUrl(productUrl) !== storeSlug) return null;
  return offerKey({ storeSlug, productUrl });
}

const validPrice = (value) => {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
};

const AVAILABILITY = new Set(['in_stock', 'out_of_stock', 'unknown']);

// Short human label for the variant a listing represents (storage, size, colour...).
function variantLabel(specifications = {}, title = '') {
  const specs = specifications || {};
  const parts = [];
  if (specs.ram) parts.push(`${specs.ram} RAM`);
  if (specs.storage) parts.push(String(specs.storage));
  if (specs.size) parts.push(String(specs.size));
  if (specs.quantity) parts.push(String(specs.quantity));
  if (specs.packOf) parts.push(`Pack of ${specs.packOf}`);
  if (specs.color) parts.push(String(specs.color));
  if (!parts.length) {
    const paren = String(title).match(/\(([^)]{2,60})\)/);
    if (paren) parts.push(paren[1]);
  }
  return parts.join(' · ').slice(0, 255) || null;
}

const json = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : null);

function cleanOffer(offer) {
  return {
    storeSlug: String(offer?.storeSlug || ''),
    productUrl: String(offer?.productUrl || ''),
    title: String(offer?.title || offer?.name || '').slice(0, 500),
    externalId: offer?.externalId != null ? String(offer.externalId).slice(0, 255) : null,
    imageUrl: /^https:\/\//.test(String(offer?.imageUrl || '')) ? String(offer.imageUrl).slice(0, 1000) : null,
    specifications: offer?.specifications && typeof offer.specifications === 'object' ? offer.specifications : {},
  };
}

/**
 * Makes sure a product and its listings exist. Listings already known keep their
 * product; new ones join the product of any known sibling (or a new product).
 *
 * observations: when true, offer price/stock/rating are written to the listing.
 * Only pass true for data scraped by the server — never for client-supplied offers.
 * Returns { productId, listings: [{ id, key, storeSlug, productUrl, isNew }] }.
 */
async function ensureProductWithListings(product, offers, options = {}) {
  // Concurrent writers (another search, another server process) can deadlock on
  // the same listing rows; MySQL rolls one back, so retry it once.
  try {
    return await ensureOnce(product, offers, options);
  } catch (err) {
    if (err.code !== 'ER_LOCK_DEADLOCK' && err.code !== 'ER_LOCK_WAIT_TIMEOUT') throw err;
    return ensureOnce(product, offers, options);
  }
}

async function ensureOnce(product, offers, { observations = false } = {}) {
  const retailerMap = await retailers();
  const candidates = [];
  for (const raw of offers || []) {
    const offer = cleanOffer(raw);
    const key = listingKeyFor(offer.storeSlug, offer.productUrl);
    const retailer = retailerMap.get(offer.storeSlug);
    if (!key || !retailer || !offer.title) continue;
    candidates.push({ offer, raw, key, retailer });
  }
  if (!candidates.length) return { productId: null, listings: [] };

  return db.transaction(async (conn) => {
    const keys = candidates.map((c) => c.key);
    const existing = await conn.query(
      'SELECT id, product_id, listing_key FROM product_listings WHERE listing_key IN (?)',
      [keys]
    );
    const byKey = new Map(existing.map((row) => [row.listing_key, row]));

    let productId = existing[0]?.product_id || null;
    let createdProductId = null;
    if (!productId) {
      const name = String(product?.name || candidates[0].offer.title).slice(0, 500);
      const result = await conn.execute(
        `INSERT INTO products (name, normalized_name, brand, category, image_url, specifications)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          name,
          normalizeText(name).slice(0, 500),
          product?.brand ? String(product.brand).slice(0, 150) : null,
          product?.category ? String(product.category).slice(0, 150) : null,
          /^https:\/\//.test(String(product?.imageUrl || '')) ? String(product.imageUrl).slice(0, 1000) : null,
          json(product?.specifications),
        ]
      );
      productId = result.insertId;
      createdProductId = productId;
    }

    const listings = [];
    for (const { offer, raw, key, retailer } of candidates) {
      const known = byKey.get(key);
      const price = observations ? validPrice(raw.price) : null;
      const mrp = observations ? validPrice(raw.mrp) : null;
      const availability = observations && AVAILABILITY.has(raw.availability) ? raw.availability : null;
      const rating = observations && Number(raw.rating) > 0 && Number(raw.rating) <= 5 ? Number(raw.rating) : null;
      const ratingCount = observations && Number.isInteger(Number(raw.ratingCount)) ? Number(raw.ratingCount) : null;

      if (known) {
        if (observations) {
          // Only overwrite fields the scrape actually produced; never replace good data with blanks.
          await conn.execute(
            `UPDATE product_listings SET
               title = ?, image_url = COALESCE(?, image_url),
               current_price = COALESCE(?, current_price), mrp = COALESCE(?, mrp),
               availability = IF(? IS NULL OR ? = 'unknown', availability, ?),
               rating = COALESCE(?, rating), rating_count = COALESCE(?, rating_count),
               last_checked_at = UTC_TIMESTAMP(),
               last_success_at = IF(? IS NULL, last_success_at, UTC_TIMESTAMP())
             WHERE id = ?`,
            [offer.title, offer.imageUrl, price, mrp, availability, availability, availability, rating, ratingCount, price, known.id]
          );
        }
        listings.push({ id: known.id, key, storeSlug: offer.storeSlug, productUrl: offer.productUrl, productId: known.product_id, isNew: false, price, mrp, availability });
        continue;
      }

      const result = await conn.execute(
        `INSERT INTO product_listings
           (product_id, retailer_id, listing_key, external_id, title, product_url, image_url, variant_label,
            specifications, current_price, mrp, availability, rating, rating_count, last_checked_at, last_success_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [
          productId,
          retailer.id,
          key,
          offer.externalId,
          offer.title,
          offer.productUrl,
          offer.imageUrl,
          variantLabel(offer.specifications, offer.title),
          json(offer.specifications),
          price,
          mrp,
          availability || 'unknown',
          rating,
          ratingCount,
          observations ? new Date() : null,
          price != null ? new Date() : null,
        ]
      );
      listings.push({ id: result.insertId, key, storeSlug: offer.storeSlug, productUrl: offer.productUrl, productId, isNew: true, price, mrp, availability });
    }

    // Another writer may have inserted some of these listings first (the
    // ON DUPLICATE KEY path keeps its product). Read the real owners back.
    // A locking read sees other transactions' committed rows; a plain SELECT would
    // read this transaction's REPEATABLE READ snapshot and miss them.
    const owners = await conn.query(
      'SELECT listing_key, product_id FROM product_listings WHERE listing_key IN (?) FOR UPDATE',
      [keys]
    );
    const ownerByKey = new Map(owners.map((row) => [row.listing_key, row.product_id]));
    for (const listing of listings) listing.productId = ownerByKey.get(listing.key) ?? listing.productId;
    if (createdProductId && !listings.some((l) => l.productId === createdProductId)) {
      // Lost the race for every listing: drop the empty product we just made.
      await conn.execute('DELETE FROM products WHERE id = ?', [createdProductId]);
      productId = listings[0]?.productId ?? null;
    }
    return { productId, listings };
  });
}

async function getListingByKey(key) {
  const [row] = await db.query('SELECT * FROM product_listings WHERE listing_key = ?', [key]);
  return row || null;
}

module.exports = { ensureProductWithListings, listingKeyFor, variantLabel, validPrice, getListingByKey, retailers };
