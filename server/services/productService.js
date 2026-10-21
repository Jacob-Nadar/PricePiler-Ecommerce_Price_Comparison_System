const db = require('../config/db');
const adapters = require('../adapters');
const { normalizeText } = require('../utils/productUtils');
const { matchScore, pickBestMatch, relevanceScore } = require('../utils/matchUtils');
const comparison = require('./comparisonService');

// Prices move quickly during sales; keep cached store results short-lived.
const STORE_CACHE_TTL_MS = 10 * 60_000;
const STORE_CACHE_MAX_ENTRIES = 250;
const STORE_FAILURE_INITIAL_BACKOFF_MS = 60_000;
const STORE_FAILURE_MAX_BACKOFF_MS = 15 * 60_000;
const storeSearchCache = new Map();
const storeFailureState = new Map();
const storeSearchesInFlight = new Map();

const CATEGORY_SEARCH_TERMS = {
  'grocery pantry': ['tomato', 'basmati rice', 'atta', 'cooking oil', 'coffee'],
  grocery: ['tomato', 'basmati rice', 'atta', 'cooking oil', 'coffee'],
  'home kitchen': ['pressure cooker', 'bedsheet', 'storage containers', 'table lamp'],
  'clothing footwear': ['men t shirt', 'jeans', 'kurta', 'running shoes'],
  'beauty personal care': ['shampoo', 'sunscreen', 'face moisturizer', 'face wash'],
  'books stationery': ['bestseller book', 'notebook', 'ball pens', 'school supplies'],
  'books toys': ['children books', 'building blocks toy', 'board game'],
  'toys games': ['building blocks toy', 'board game', 'kids puzzle'],
  'sports fitness': ['yoga mat', 'water bottle', 'dumbbells', 'sports bag'],
  'sports outdoors': ['yoga mat', 'water bottle', 'dumbbells', 'sports bag'],
  electronics: ['smartphone', 'laptop', 'wireless earphones'],
  'baby kids': ['baby diapers', 'baby lotion', 'kids t shirt', 'soft toy'],
  'pet supplies': ['dog food', 'cat food', 'pet shampoo', 'pet toy'],
};

function toProduct(item, allAdapters) {
  const offers = item.offers || {};
  const storeOffers = Object.entries(offers).map(([slug, info]) => {
    const ad = allAdapters.find((a) => a.slug === slug);
    const storeMeta = ad
      ? { storeId: ad.store.id, storeSlug: ad.slug, storeName: ad.store.name }
      : { storeId: null, storeSlug: slug, storeName: slug };
    return {
      ...storeMeta,
      externalId: item.id,
      name: item.name,
      title: item.name,
      brand: item.brand,
      model: item.model,
      productUrl: info.url,
      imageUrl: item.image,
      price: info.price,
      mrp: info.mrp ?? null,
      discountPercent:
        info.mrp && info.price ? Math.round(((info.mrp - info.price) / info.mrp) * 100) : null,
      rating: item.rating ?? null,
      ratingCount: item.ratingCount ?? null,
      sponsored: Boolean(item.sponsored),
      availability: info.availability,
      lastChecked: item.checkedAt || null,
      specifications: item.specifications,
    };
  });
  return {
    query: item.name,
    name: item.name,
    brand: item.brand,
    model: item.model,
    category: item.category,
    imageUrl: item.image,
    specifications: item.specifications,
    rating: item.rating ?? null,
    ratingCount: item.ratingCount ?? null,
    offers: storeOffers,
    source: 'live',
  };
}

// Rank merged products: closest title match first, then listings available at more
// stores (a real comparison), then in-stock, well-reviewed, non-sponsored listings.
function rankProducts(products, query) {
  const scored = products.map((product, index) => {
    const relevance = Math.max(
      relevanceScore(query, product.name),
      ...product.offers.map((o) => relevanceScore(query, o.title || o.name || ''))
    );
    const storeCount = new Set(product.offers.map((o) => o.storeSlug)).size;
    const inStock = product.offers.some((o) => o.availability === 'in_stock' && o.price != null);
    const allSponsored = product.offers.length > 0 && product.offers.every((o) => o.sponsored);
    const reviewed = product.rating && product.ratingCount >= 20 ? (product.rating / 5) * 0.08 : 0;
    const score =
      relevance + 0.12 * (storeCount - 1) + (inStock ? 0.06 : 0) + reviewed - (allSponsored ? 0.1 : 0);
    return { product, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((row) => row.product);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function searchStore(adapter, query, { fresh = false } = {}) {
  const key = `${adapter.slug}:${normalizeText(query)}`;
  const inFlight = storeSearchesInFlight.get(key);
  if (inFlight) return inFlight;

  const cached = storeSearchCache.get(key);
  if (!fresh && cached && Date.now() - cached.cachedAt < STORE_CACHE_TTL_MS) {
    return cached.result;
  }
  if (cached) storeSearchCache.delete(key);

  const failure = storeFailureState.get(adapter.slug);
  if (failure && failure.retryAt > Date.now()) {
    const retrySeconds = Math.ceil((failure.retryAt - Date.now()) / 1000);
    const error = new Error(
      `${adapter.store.name} is temporarily unavailable after a recent request failure. Retrying in about ${retrySeconds} seconds.`
    );
    error.status = 503;
    error.storeCooldown = true;
    throw error;
  }

  const request = (async () => {
    try {
      const found = await adapter.search(query);
      storeFailureState.delete(adapter.slug);
      const best = pickBestMatch(query, found);
      const checkedAt = new Date().toISOString();
      const result = best
        ? { item: { ...best.item, checkedAt }, found, checkedAt }
        : { item: null, found, checkedAt };
      storeSearchCache.delete(key);
      storeSearchCache.set(key, { result, cachedAt: Date.now() });
      while (storeSearchCache.size > STORE_CACHE_MAX_ENTRIES) {
        storeSearchCache.delete(storeSearchCache.keys().next().value);
      }
      return result;
    } catch (cause) {
      const failures = (failure?.failures || 0) + 1;
      const backoffMs = Math.min(
        STORE_FAILURE_INITIAL_BACKOFF_MS * (2 ** (failures - 1)),
        STORE_FAILURE_MAX_BACKOFF_MS
      );
      const retryAt = Date.now() + backoffMs;
      storeFailureState.set(adapter.slug, { failures, retryAt });
      const error = new Error(
        `${adapter.store.name} is temporarily unavailable${cause.status ? ` (HTTP ${cause.status})` : ''}. Retrying in about ${Math.ceil(backoffMs / 1000)} seconds.`
      );
      error.status = 503;
      error.cause = cause;
      console.warn(`[search] ${adapter.slug} unavailable; pausing retries for ${Math.ceil(backoffMs / 1000)} seconds:`, cause.message);
      throw error;
    }
  })();
  storeSearchesInFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (storeSearchesInFlight.get(key) === request) {
      storeSearchesInFlight.delete(key);
    }
  }
}

// options.matchQuery: text listings must match (defaults to the store query).
// options.fresh: bypass the short-lived result cache to re-check live prices.
async function searchProducts(query, options = {}) {
  await adapters.ensureLoaded();
  const all = adapters.getAdapters();
  const live = adapters.getLiveAdapters();
  const q = String(query || '').trim();
  const matchQ = String(options.matchQuery || q).trim();

  if (!q) return { results: [], storeStatus: [] };

  const storeHits = await Promise.all(
    live.map(async (adapter) => {
      try {
        const result = await searchStore(adapter, q, { fresh: options.fresh });
        return { adapter, ...result };
      } catch (err) {
        return { adapter, item: null, found: [], error: err };
      }
    })
  );

  const storeStatus = storeHits.map(({ adapter, item, found, error }) => ({
    storeSlug: adapter.slug,
    storeName: adapter.store.name,
    status: error
      ? 'unavailable'
      : (found || []).some((candidate) => matchScore(matchQ, candidate.name || candidate.title || '') >= 0.45)
        ? 'matched'
        : 'no_match',
    message: error ? error.message : null,
    resultCount: (found || []).length,
  }));
  const products = storeHits.flatMap(({ found, checkedAt }) =>
    (found || [])
      .filter((item) => matchScore(matchQ, item.name || item.title || '') >= 0.45)
      .map((item) => toProduct({ ...item, checkedAt }, all))
  );
  const merged = rankProducts(mergeEquivalentProducts(products, matchQ), matchQ);
  return {
    results: merged.slice(0, 30).map((product) => ({ ...product, storeStatus })),
    storeStatus,
  };
}

async function searchCategoryProducts(category) {
  const normalizedCategory = normalizeText(category);
  const queries = CATEGORY_SEARCH_TERMS[normalizedCategory] || [String(category || '').trim()];
  const results = [];
  const statusByStore = new Map();

  // Each query already fans out to every store; two at a time keeps the shared
  // browser responsive while cutting category load time roughly in half.
  const searches = await mapWithConcurrency(queries.filter(Boolean), 2, (query) => searchProducts(query));
  for (const search of searches) {
    results.push(...search.results);
    for (const status of search.storeStatus) {
      const current = statusByStore.get(status.storeSlug);
      if (!current || status.status === 'matched' || (status.status === 'unavailable' && current.status === 'no_match')) {
        statusByStore.set(status.storeSlug, status);
      }
    }
  }

  const unique = mergeEquivalentProducts(results).slice(0, 60);
  const storeStatus = [...statusByStore.values()];
  return {
    results: unique.map((product) => ({ ...product, storeStatus })),
    storeStatus,
  };
}

function mergeEquivalentProducts(products, query = '') {
  const merged = [];
  for (const p of products) {
    let matchIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      if (comparison.sameListingProduct(merged[i], p, query) && comparison.sameVariant(merged[i], p)) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx === -1) {
      merged.push({ ...p, offers: [...p.offers] });
    } else {
      const existing = merged[matchIdx];
      if (!existing.brand && p.brand) existing.brand = p.brand;
      if (p.rating && (!existing.ratingCount || (p.ratingCount || 0) > existing.ratingCount)) {
        existing.rating = p.rating;
        existing.ratingCount = p.ratingCount;
      }
      if (!existing.model && p.model) existing.model = p.model;
      if (!existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
      const seen = new Set(
        existing.offers.map((o) => `${o.storeSlug}::${o.externalId || o.productUrl}`)
      );
      for (const o of p.offers) {
        const key = `${o.storeSlug}::${o.externalId || o.productUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          existing.offers.push(o);
        }
      }
    }
  }
  return merged;
}





async function recordSearch(query, source, resultsCount) {
  try {
    await db.execute(
      `INSERT INTO search_history (query, source, results_count) VALUES (?, ?, ?)`,
      [query, source, resultsCount]
    );
  } catch {
    // ignore DB errors for search history
  }
}

async function getRecentSearches(limit = 8) {
  try {
    const rows = await db.query(
      `SELECT query, source, results_count AS resultsCount, created_at AS createdAt
       FROM search_history ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  } catch {
    return [];
  }
}

module.exports = {
  searchStore,
  searchProducts,
  searchCategoryProducts,
  recordSearch,
  getRecentSearches,
};
