// Price history in MySQL (price_history), with the JSON-file tracker as a fallback
// when the database is not connected, so search still shows history badges.
const db = require('../config/db');
const config = require('../config');
const fileTracker = require('./priceTracker');
const catalog = require('./catalogService');
const logger = require('../utils/logger');

const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };
let recordQueue = Promise.resolve();

// Pure: should this observation become a new snapshot? Records when there is no
// earlier snapshot, the price or stock changed, or the last snapshot is older than
// the heartbeat (so an unchanged price still shows up on the chart periodically).
function shouldRecordSnapshot(last, next, now = new Date(), heartbeatMs = config.monitor.snapshotHeartbeatHours * 3_600_000) {
  if (next?.price == null || !(Number(next.price) > 0)) return false;
  if (!last) return true;
  if (Number(last.price) !== Number(next.price)) return true;
  if ((next.availability || 'unknown') !== 'unknown' && last.availability !== next.availability) return true;
  return now - new Date(last.recorded_at) >= heartbeatMs;
}

// Must run inside a transaction: locking the listing row serialises concurrent
// writers, so two searches cannot both decide "no recent snapshot" and insert twice.
async function recordSnapshot(conn, listingId, observation, source) {
  await conn.query('SELECT id FROM product_listings WHERE id = ? FOR UPDATE', [listingId]);
  const [last] = await conn.query(
    'SELECT price, availability, recorded_at FROM price_history WHERE listing_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1',
    [listingId]
  );
  if (!shouldRecordSnapshot(last, observation)) return false;
  await conn.execute(
    'INSERT INTO price_history (listing_id, price, mrp, availability, source) VALUES (?, ?, ?, ?, ?)',
    [listingId, observation.price, observation.mrp ?? null, observation.availability || 'unknown', source]
  );
  return true;
}

// Pure: summary numbers for a series of points ({ price, recordedAt }) in time order.
function summarize(points, currentPrice) {
  const priced = points.filter((p) => p.price != null);
  if (!priced.length) return null;
  const prices = priced.map((p) => Number(p.price));
  // "current" is the live price when given (it can be newer than the last snapshot),
  // otherwise the latest snapshot. "previous" is the most recent different price before it.
  const current = currentPrice != null ? Number(currentPrice) : prices[prices.length - 1];
  const earlier = currentPrice != null ? priced : priced.slice(0, -1);
  const previous = [...earlier].reverse().find((p) => Number(p.price) !== current);
  const previousPrice = previous ? Number(previous.price) : null;
  const change = previousPrice != null ? Math.round((current - previousPrice) * 100) / 100 : 0;
  return {
    current,
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    previousPrice,
    change,
    direction: change < 0 ? 'down' : change > 0 ? 'up' : 'same',
    isLowest: current <= Math.min(...prices),
    points: priced.length,
    firstSeen: priced[0].recordedAt,
    lastRecorded: priced[priced.length - 1].recordedAt,
  };
}

async function pointsForListings(listingIds, days) {
  if (!listingIds.length) return new Map();
  const rows = await db.query(
    `SELECT listing_id, price, availability, recorded_at FROM price_history
      WHERE listing_id IN (?) ${days ? 'AND recorded_at >= UTC_TIMESTAMP() - INTERVAL ? DAY' : ''}
      ORDER BY recorded_at ASC, id ASC`,
    days ? [listingIds, days] : [listingIds]
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.listing_id)) map.set(row.listing_id, []);
    map.get(row.listing_id).push({
      recordedAt: new Date(row.recorded_at).toISOString(),
      price: Number(row.price),
      availability: row.availability,
    });
  }
  return map;
}

// Adds `priceHistory` stats to each live offer from what was recorded *before*
// this search, then records the new observations in the background.
async function prepareSearchResults(results) {
  if (!db.isAvailable()) {
    return results.map((r) => ({ ...r, offers: fileTracker.trackOffers(r.offers) }));
  }
  try {
    const keyed = results.flatMap((r) => r.offers.map((o) => catalog.listingKeyFor(o.storeSlug, o.productUrl))).filter(Boolean);
    const known = keyed.length
      ? await db.query('SELECT id, listing_key FROM product_listings WHERE listing_key IN (?)', [[...new Set(keyed)]])
      : [];
    const idByKey = new Map(known.map((row) => [row.listing_key, row.id]));
    const points = await pointsForListings([...idByKey.values()], null);
    const annotated = results.map((r) => ({
      ...r,
      offers: r.offers.map((o) => {
        const id = idByKey.get(catalog.listingKeyFor(o.storeSlug, o.productUrl));
        const series = id ? points.get(id) : null;
        const stats = series?.length ? summarize(series, o.price) : null;
        return {
          ...o,
          listingId: id || null,
          ...(stats ? { priceHistory: { ...stats, points: stats.points } } : {}),
        };
      }),
    }));
    // One background recording at a time per process keeps overlapping searches
    // from contending for the same rows.
    recordQueue = recordQueue
      .then(() => recordSearchResults(results))
      .catch((err) => logger.error('history.search_record_failed', { message: err.message }));
    return annotated;
  } catch (err) {
    logger.error('history.annotate_failed', { message: err.message });
    return results;
  }
}

async function recordSearchResults(results) {
  let snapshots = 0;
  for (const product of results) {
    const { listings } = await catalog.ensureProductWithListings(product, product.offers, { observations: true });
    for (const listing of listings) {
      if (listing.price == null) continue;
      const recorded = await db.transaction((conn) => recordSnapshot(conn, listing.id, listing, 'search'));
      if (recorded) snapshots++;
    }
  }
  if (snapshots) logger.info('history.search_recorded', { products: results.length, snapshots });
}

/**
 * Series for the chart. `offers` are { storeSlug, productUrl } (live results) or
 * pass listingIds directly. Returns per-listing series + stats and overall stats.
 */
async function getHistory({ offers = [], listingIds = [], range = 'all' }) {
  const days = Object.prototype.hasOwnProperty.call(RANGES, range) ? RANGES[range] : null;
  if (!db.isAvailable()) {
    return { range, source: 'file', series: fileTracker.getHistory(offers).map((s) => ({ ...s, stats: summarize(s.points) })) };
  }
  let rows;
  if (listingIds.length) {
    rows = await db.query(
      `SELECT l.id, l.listing_key, l.product_url, l.title, l.variant_label, l.current_price, l.availability,
              l.last_success_at, r.slug AS store_slug, r.name AS store_name
         FROM product_listings l JOIN retailers r ON r.id = l.retailer_id WHERE l.id IN (?)`,
      [listingIds]
    );
  } else {
    const keys = offers.map((o) => catalog.listingKeyFor(o.storeSlug, o.productUrl)).filter(Boolean);
    rows = keys.length
      ? await db.query(
          `SELECT l.id, l.listing_key, l.product_url, l.title, l.variant_label, l.current_price, l.availability,
                  l.last_success_at, r.slug AS store_slug, r.name AS store_name
             FROM product_listings l JOIN retailers r ON r.id = l.retailer_id WHERE l.listing_key IN (?)`,
          [[...new Set(keys)]]
        )
      : [];
  }
  const points = await pointsForListings(rows.map((r) => r.id), days);
  const series = rows
    .map((row) => {
      const pts = points.get(row.id) || [];
      return {
        key: row.listing_key,
        listingId: row.id,
        storeSlug: row.store_slug,
        storeName: row.store_name,
        productUrl: row.product_url,
        title: row.title,
        variant: row.variant_label,
        availability: row.availability,
        lastSuccessAt: row.last_success_at,
        points: pts,
        stats: summarize(pts, row.current_price),
      };
    })
    .filter((s) => s.points.length);
  return { range, source: 'database', series };
}

module.exports = { shouldRecordSnapshot, recordSnapshot, summarize, prepareSearchResults, recordSearchResults, getHistory, RANGES };
