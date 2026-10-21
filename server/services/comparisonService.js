const {
  normalizeText,
  tokenize,
  specsFingerprint,
  productKey,
  availabilityLabel,
  extractSpecsFromString,
} = require('../utils/productUtils');
const { queryTokens, stripMeasurements } = require('../utils/matchUtils');

const AVAILABILITY_RANK = { in_stock: 0, unknown: 1, out_of_stock: 2 };

// Only these specifications distinguish one product variant from another.
// Colour, the free-text "(…)" variant, material, clothing size and other page
// metadata differ in wording across stores and must not split identical products.
const IDENTITY_SPEC_KEYS = new Set(['ram', 'storage', 'ssd', 'size', 'quantity', 'packof']);

function identitySpecs(specifications) {
  return Object.fromEntries(
    Object.entries(specifications || {}).filter(([key, value]) => {
      const k = normalizeText(key);
      if (!IDENTITY_SPEC_KEYS.has(k)) return false;
      // "size" is only an identity spec for screen sizes, not clothing sizes like "M".
      return k !== 'size' || /\d\s*(?:inch|in|")/i.test(String(value));
    })
  );
}

function sameVariant(a, b) {
  if (!a || !b) return false;
  const specsA = identitySpecs(a.specifications);
  const specsB = identitySpecs(b.specifications);
  // A multi-pack is a different purchase from a single unit even if one listing omits the count.
  if (Number(specsA.packOf || 1) !== Number(specsB.packOf || 1)) return false;
  const keysA = Object.keys(specsA).filter((k) => specsA[k] != null && String(specsA[k]).trim() !== '');
  const keysB = Object.keys(specsB).filter((k) => specsB[k] != null && String(specsB[k]).trim() !== '');

  // If both sides have explicit specs, every spec present on the smaller set must match.
  // This lets a user search with partial specs (e.g. only RAM+storage) match a fully-specified offer.
  const compareKeys = keysA.length <= keysB.length ? keysA : keysB;
  for (const k of compareKeys) {
    const va = normalizeText(specsA[k]);
    const vb = normalizeText(specsB[k]);
    if (!va || !vb) continue;
    if (va !== vb) return false;
  }

  return true;
}

function normalizeSpecificationValue(value) {
  return normalizeText(value)
    .replace(/\b(\d+)\s+(gb|tb)\b/g, '$1$2')
    .replace(/\b(ram|rom|storage|internal memory)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCapacity(title, value, key) {
  const expected = normalizeSpecificationValue(value).match(/^(\d+)\s*(gb|tb)$/);
  if (!expected) return false;
  const normalizedTitle = normalizeText(title);
  const pattern =
    key === 'ram'
      ? /\b(\d+)\s*(gb|tb)\s*(?:ram|ddr\d?)\b/g
      : /\b(\d+)\s*(gb|tb)\s*(?:storage|rom|internal memory)\b/g;
  const capacities = [...normalizedTitle.matchAll(pattern)];
  return capacities.some((match) => match[1] === expected[1] && match[2] === expected[2]);
}

function matchesRequestedSpecifications(product, offer) {
  const requested = Object.entries(identitySpecs(product.specifications)).filter(
    ([, value]) => value != null && String(value).trim() !== ''
  );
  if (requested.length === 0) return true;

  const listingSpecifications = {
    ...extractSpecsFromString(offer.name || offer.title || ''),
    ...(offer.specifications || {}),
  };
  for (const [key, expectedValue] of requested) {
    const actualValue = listingSpecifications[key];
    if (actualValue != null && String(actualValue).trim() !== '') {
      if (normalizeSpecificationValue(actualValue) !== normalizeSpecificationValue(expectedValue)) {
        return false;
      }
      continue;
    }
    if (
      (key === 'ram' || key === 'storage') &&
      hasCapacity(offer.name || offer.title || '', expectedValue, key)
    ) {
      continue;
    }
    const normalizedTitle = normalizeSpecificationValue(offer.name || offer.title || '');
    if (normalizedTitle.includes(normalizeSpecificationValue(expectedValue))) continue;
    return false;
  }
  return true;
}

function sameProduct(a, b) {
  if (!a || !b) return false;
  const brandA = normalizeText(a.brand);
  const brandB = normalizeText(b.brand);
  const modelA = normalizeText(a.model);
  const modelB = normalizeText(b.model);

  if (brandA && brandB && brandA !== brandB) return false;
  if (modelA && modelB && modelA !== modelB) return false;

  const nameA = productIdentityTokens(a.name);
  const nameB = productIdentityTokens(b.name);
  if (nameA.length && nameB.length) {
    const overlap = nameA.filter((t) => nameB.includes(t)).length;
    const minLen = Math.min(nameA.length, nameB.length);
    return minLen > 0 && overlap / minLen >= 0.6;
  }
  return true;
}

function productIdentityTokens(name) {
  const colorAndSpecDetails = /\((?=[^)]*(?:\b(?:black|white|blue|red|green|grey|gray|silver|gold|pink|purple|beige|brown|yellow|orange|gb|tb|ram|storage|rom)\b))[^)]*\)/gi;
  const identity = String(name || '')
    .split(/\s[|｜]\s/, 1)[0]
    .replace(colorAndSpecDetails, ' ')
    .replace(/\b(\d+)\s+(gb|tb)\b/gi, '$1$2');
  return tokenize(identity);
}

// Words that say who/what a product is for rather than which product it is.
const GENERIC_LISTING_WORDS = new Set([
  'for', 'men', 'mens', 'man', 'women', 'womens', 'woman', 'boy', 'boys', 'girl', 'girls', 'kid', 'kids',
  'unisex', 'with', 'and', 'the', 'by', 'of', 'pack', 'set', 'new', 'latest', 'combo', 'size', 'in',
  'adult', 'adults', 'stylish', 'trendy', 'premium', 'original', 'best', 'each',
]);

// Sizes ("200ml") are compared by sameVariant, so they are not identity words here.
function distinctiveTokens(name, queryTokenSet) {
  return new Set(
    queryTokens(stripMeasurements(productIdentityTokens(name).join(' '))).filter(
      (t) => !queryTokenSet.has(t) && !GENERIC_LISTING_WORDS.has(t)
    )
  );
}

// Model identifiers such as "413", "800d", "s24" or "13c". Measurements ("45h",
// "11mm", "5000mah") and years ("2026") describe the product rather than name it.
const MEASUREMENT_SUFFIX = /^\d+(?:h|hr|hrs|hours?|mm|cm|m|mah|w|hz|mp|gb|tb|g|gm|kg|ml|l|x|k|v|in|db|pcs|ft)$/;
function modelTokens(name) {
  return new Set(
    tokenize(stripMeasurements(productIdentityTokens(name).join(' '))).filter(
      (t) => /\d/.test(t) && !/^(?:19|20)\d\d$/.test(t) && !MEASUREMENT_SUFFIX.test(t)
    )
  );
}

function mentionsBrand(product, brand) {
  const brandTokens = tokenize(brand);
  if (brandTokens.length === 0) return true;
  const nameTokens = new Set(tokenize(`${product.brand || ''} ${product.name || ''}`));
  return brandTokens.every((t) => nameTokens.has(t));
}

// Stricter identity check for merging search listings into one comparison row.
// Shared query words ("running shoes") are not evidence that two listings are the
// same product, so only the remaining distinctive words are compared. Listings from
// the same store must agree almost completely, since a store rarely lists one product twice.
function sameListingProduct(a, b, query = '') {
  if (!sameProduct(a, b)) return false;
  if (!mentionsBrand(b, a.brand) || !mentionsBrand(a, b.brand)) return false;
  // "Airdopes Prime 413" and "Airdopes Prime 800D" share every word except the model.
  const modelsA = modelTokens(a.name);
  const modelsB = modelTokens(b.name);
  if (modelsA.size && modelsB.size && ![...modelsA].some((t) => modelsB.has(t))) return false;
  const queryTokenSet = new Set(queryTokens(query));
  const tokensA = distinctiveTokens(a.name, queryTokenSet);
  const tokensB = distinctiveTokens(b.name, queryTokenSet);
  if (tokensA.size === 0 || tokensB.size === 0) return tokensA.size === tokensB.size;
  // The same product rarely costs 2.5x more at one store than another; a gap that
  // large means two different listings that merely share keywords.
  const lowestPrice = (p) => Math.min(...(p.offers || []).map((o) => o.price ?? Infinity));
  const [priceA, priceB] = [lowestPrice(a), lowestPrice(b)];
  if (Number.isFinite(priceA) && Number.isFinite(priceB) && Math.max(priceA, priceB) > 2.5 * Math.min(priceA, priceB)) {
    return false;
  }

  const overlap = [...tokensA].filter((t) => tokensB.has(t)).length;
  const storesA = new Set((a.offers || []).map((o) => o.storeSlug));
  const sharesStore = (b.offers || []).some((o) => storesA.has(o.storeSlug));
  // Unbranded, keyword-stuffed listings need to look alike in both directions.
  const branded = Boolean(normalizeText(a.brand) || normalizeText(b.brand));
  return sharesStore || !branded
    ? overlap / Math.max(tokensA.size, tokensB.size) >= (sharesStore ? 0.8 : 0.6)
    : overlap / Math.min(tokensA.size, tokensB.size) >= 0.75;
}

function dedupeOffers(offers) {
  const seen = new Set();
  const out = [];
  for (const o of offers) {
    const key = `${o.storeId || o.storeSlug}::${o.externalId || o.productUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function normalizeAvailability(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('in') && v.includes('stock')) return 'in_stock';
  if (v.includes('out') || v.includes('unavailable') || v.includes('sold')) return 'out_of_stock';
  if (v === 'in_stock' || v === 'out_of_stock' || v === 'unknown') return v;
  return 'unknown';
}

function sortOffersByBest(offers) {
  return [...offers].sort((a, b) => {
    const rankA = AVAILABILITY_RANK[a.availability] ?? 2;
    const rankB = AVAILABILITY_RANK[b.availability] ?? 2;
    if (rankA !== rankB) return rankA - rankB;
    const pa = a.price != null ? a.price : Infinity;
    const pb = b.price != null ? b.price : Infinity;
    return pa - pb;
  });
}

function selectBestPrice(offers) {
  const inStock = offers.filter((o) => o.availability === 'in_stock' && o.price != null);
  if (inStock.length === 0) {
    const allOutOfStock = offers.length > 0 && offers.every((o) => o.availability === 'out_of_stock');
    return {
      bestOffer: null,
      hasInStock: false,
      reason: allOutOfStock
        ? 'This product is out of stock at all matched stores.'
        : 'No confirmed in-stock offer is available from the matched listings.',
    };
  }
  const best = inStock.reduce((acc, o) => (o.price < acc.price ? o : acc), inStock[0]);
  return { bestOffer: best, hasInStock: true, reason: null };
}

// How much the best in-stock offer saves over the priciest in-stock offer
// from a different store. Same-store duplicates are not a real saving.
function computeSavings(offers, bestOffer) {
  if (!bestOffer) return null;
  const others = offers.filter(
    (o) => o.availability === 'in_stock' && o.price != null && o.storeSlug !== bestOffer.storeSlug
  );
  if (others.length === 0) return null;
  const highest = others.reduce((acc, o) => (o.price > acc.price ? o : acc), others[0]);
  const amount = Math.round((highest.price - bestOffer.price) * 100) / 100;
  if (amount <= 0) return null;
  return {
    amount,
    percent: Math.round((amount / highest.price) * 100),
    comparedTo: highest.storeName,
    highestPrice: highest.price,
  };
}

function compareOffers(offers) {
  const normalized = offers.map((o) => ({
    ...o,
    availability: normalizeAvailability(o.availability),
  }));
  const deduped = dedupeOffers(normalized);
  const sorted = sortOffersByBest(deduped);
  const { bestOffer, hasInStock, reason } = selectBestPrice(deduped);
  return {
    offers: sorted,
    bestOffer,
    bestOfferId: bestOffer ? bestOffer.id : null,
    hasInStock,
    noInStockReason: reason,
    savings: computeSavings(deduped, bestOffer),
    note:
      'Prices are listed product prices. Shipping, taxes, and other charges may differ across stores.',
  };
}

function matchProductToOffers(product, offers) {
  const key = productKey(product);
  const candidates = offers.filter((o) => {
    if (!sameProduct(product, o)) return false;
    return sameVariant(product, o) && matchesRequestedSpecifications(product, o);
  });
  return { candidates, productKey: key };
}

module.exports = {
  identitySpecs,
  computeSavings,
  sameVariant,
  matchesRequestedSpecifications,
  sameProduct,
  sameListingProduct,
  dedupeOffers,
  normalizeAvailability,
  sortOffersByBest,
  selectBestPrice,
  compareOffers,
  matchProductToOffers,
  availabilityLabel,
};
