// Lightweight price tracker: records every live price we observe for an offer so
// the app can show price history and "price dropped" signals without MySQL.
// Data lives in a single JSON file (server/data/price-history.json by default).
const fs = require('fs');
const path = require('path');

const DATA_FILE =
  process.env.PRICE_HISTORY_FILE || path.join(__dirname, '..', 'data', 'price-history.json');
const MIN_INTERVAL_MS = 60 * 60_000; // one data point per offer per hour unless the price changes
const MAX_POINTS_PER_OFFER = 180;
const MAX_OFFERS = 5000;
const SAVE_DELAY_MS = 1500;

let store = null; // { [offerKey]: { title, storeName, url, points: [{ t, p, a }] } }
let saveTimer = null;

function load() {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!store || typeof store !== 'object' || Array.isArray(store)) store = {};
  } catch {
    store = {};
  }
  return store;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

function flush() {
  if (!store) return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.warn('[price-tracker] could not save price history:', err.message);
  }
}

// Stable identity for an offer: store + product URL without tracking params.
function offerKey(offer) {
  const slug = offer?.storeSlug;
  const raw = offer?.productUrl || offer?.url;
  if (!slug || !raw) return null;
  try {
    const url = new URL(raw);
    const asin = url.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
    if (asin) return `${slug}|amazon:${asin[1].toUpperCase()}`;
    const pid = url.searchParams.get('pid');
    return `${slug}|${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${pid ? `?pid=${pid}` : ''}`;
  } catch {
    return null;
  }
}

function statsFor(points, currentPrice) {
  const priced = points.filter((pt) => pt.p != null);
  if (priced.length === 0) return null;
  const prices = priced.map((pt) => pt.p);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  // The most recent recorded price that differs from today's price.
  const previous = [...priced].reverse().find((pt) => pt.p !== currentPrice);
  return {
    lowest,
    highest,
    points: priced.length,
    firstSeen: new Date(priced[0].t).toISOString(),
    previousPrice: previous ? previous.p : null,
    change: previous && currentPrice != null ? Math.round((currentPrice - previous.p) * 100) / 100 : 0,
    isLowest: currentPrice != null && currentPrice <= lowest,
  };
}

// Attach history stats to each offer (based on what was seen before), then record
// the current observation. Returns new offer objects; inputs are not mutated.
function trackOffers(offers) {
  const data = load();
  const now = Date.now();
  let changed = false;
  const annotated = (offers || []).map((offer) => {
    const key = offerKey(offer);
    if (!key) return offer;
    const entry = data[key] || { points: [] };
    const priceHistory = statsFor(entry.points, offer.price ?? null);

    if (offer.price != null) {
      const last = entry.points[entry.points.length - 1];
      const due =
        !last || last.p !== offer.price || last.a !== offer.availability || now - last.t >= MIN_INTERVAL_MS;
      if (due) {
        entry.points.push({ t: now, p: offer.price, a: offer.availability || 'unknown' });
        if (entry.points.length > MAX_POINTS_PER_OFFER) entry.points.splice(0, entry.points.length - MAX_POINTS_PER_OFFER);
        entry.title = offer.title || offer.name || entry.title || '';
        entry.storeName = offer.storeName || entry.storeName || '';
        entry.url = offer.productUrl || entry.url || '';
        entry.updatedAt = now;
        data[key] = entry;
        changed = true;
      }
    }
    return priceHistory ? { ...offer, priceHistory } : offer;
  });

  if (changed) {
    const keys = Object.keys(data);
    if (keys.length > MAX_OFFERS) {
      keys
        .sort((a, b) => (data[a].updatedAt || 0) - (data[b].updatedAt || 0))
        .slice(0, keys.length - MAX_OFFERS)
        .forEach((key) => delete data[key]);
    }
    scheduleSave();
  }
  return annotated;
}

// Full recorded series for the given offers, keyed by store slug + URL.
function getHistory(offers) {
  const data = load();
  return (offers || [])
    .map((offer) => {
      const key = offerKey(offer);
      const entry = key && data[key];
      if (!entry) return null;
      return {
        key,
        storeSlug: offer.storeSlug,
        storeName: offer.storeName || entry.storeName,
        productUrl: offer.productUrl,
        points: entry.points.map((pt) => ({
          recordedAt: new Date(pt.t).toISOString(),
          price: pt.p,
          availability: pt.a,
        })),
      };
    })
    .filter(Boolean);
}

module.exports = { trackOffers, getHistory, offerKey, flush, statsFor };
