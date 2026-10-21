const { normalizeText, tokenize } = require('./productUtils');

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'a',
  'an',
  'of',
  'in',
  'on',
  'to',
  'by',
]);

const ACCESSORY_WORDS = [
  'case',
  'cover',
  'protector',
  'charger',
  'cable',
  'pouch',
  'stand',
  'holder',
  'skin',
  'film',
  'tempered',
  'guard',
  'adapter',
  'earphone',
  'earbuds',
  'screen guard',
  'back cover',
  'mobile cover',
  'flip cover',
  'silicone',
  'magsafe',
  'mag safe',
  'bumper',
  'wallet',
  'ring holder',
  'strap',
  'sling',
  'sleeve',
  'popsocket',
  'pop socket',
  'grip',
  'dock',
  'accessory',
  'accessories',
  'keychain',
  'stylus',
  'band',
  'wristband',
  'mount',
  'cord',
  'replacement',
  'decal',
  'back panel',
  'back door',
  'screen protector',
  'camera protector',
  'lens protector',
  'tempered glass',
  'protective glass',
  'replacement screen',
  'replacement display',
  'phone holder',
  'mobile holder',
  'phone stand',
  'mobile stand',
  'phone skin',
  'mobile skin',
  'housing',
  'back shell',
  'book cover',
];

const ELECTRONICS_KEYWORDS = [
  'phone',
  'smartphone',
  'mobile',
  'iphone',
  'galaxy',
  'pixel',
  'oneplus',
  'laptop',
  'macbook',
  'notebook',
  'ultrabook',
  'thinkpad',
  'zenbook',
  'playstation',
  'ps5',
  'ps4',
  'xbox',
  'nintendo',
  'console',
  'tablet',
  'ipad',
  'tv',
  'television',
  'monitor',
  'gpu',
  'graphics card',
  'rtx',
];

const APPAREL_WORDS = [
  't-shirt',
  'tshirt',
  'shirt',
  'dress',
  'jeans',
  'top',
  'trousers',
  'pants',
  'hoodie',
  'sweatshirt',
  'kurta',
  'kurti',
  'saree',
  'skirt',
  'bra',
  'briefs',
  'boxer',
  'underwear',
  'socks',
  'footwear',
  'shoes',
  'sneakers',
  'sandals',
  'slippers',
  'boots',
];

// Accessory words that are also ordinary parts of other products (earbuds ship in a
// "charging case", watches have a "band"); only applied to device searches.
const DEVICE_CONTEXT_ACCESSORY_WORDS = new Set([
  'case', 'charger', 'cable', 'pouch', 'stand', 'holder', 'adapter', 'earphone', 'earbuds', 'silicone',
  'wallet', 'strap', 'sling', 'sleeve', 'grip', 'dock', 'band', 'wristband', 'mount', 'cord',
]);
const DEVICE_BRANDS = [
  'samsung', 'redmi', 'xiaomi', 'realme', 'oppo', 'vivo', 'motorola', 'moto', 'poco', 'iqoo', 'nothing',
  'nokia', 'lenovo', 'hp', 'dell', 'asus', 'acer', 'msi', 'lg', 'sony', 'tcl', 'apple',
];
const AUDIO_WEARABLE_WORDS = [
  'bud', 'buds', 'earbud', 'earbuds', 'airpod', 'airpods', 'airdope', 'airdopes', 'headphone', 'earphone',
  'neckband', 'tws', 'watch', 'smartwatch', 'band', 'speaker', 'soundbar', 'charger', 'case', 'cover', 'cable',
];

const VARIANT_MARKERS = ['pro', 'plus', 'max', 'mini', 'ultra', 'fe', 'air', 'lite', 'se'];
const PRODUCT_FORM_CONFLICTS = {
  liquid: ['soap', 'bar', 'wipes', 'powder', 'cream', 'lotion', 'handwash'],
  soap: ['liquid', 'handwash', 'sanitizer', 'wipes'],
  shampoo: ['conditioner', 'soap', 'bodywash'],
  oil: ['cream', 'lotion', 'shampoo'],
  detergent: ['bar', 'cake', 'soap'],
};
const SEARCH_TERM_EQUIVALENTS = {
  antiseptic: ['disinfectant'],
  disinfectant: ['antiseptic'],
};
const BRANDLESS_MODEL_PREFIXES = new Set(['redmi']);

function isExactBrandlessModelMatch(queryTokensList, titleTokens) {
  const omittedBrand = queryTokensList.find((token) => BRANDLESS_MODEL_PREFIXES.has(token));
  if (!omittedBrand || titleTokens.has(omittedBrand)) return false;
  const modelTokens = queryTokensList.filter((token) => token !== omittedBrand);
  return modelTokens.length > 0 &&
    modelTokens.every((token) => titleTokens.has(token)) &&
    modelTokens.some((token) => /[a-z]/.test(token) && /\d/.test(token));
}

const MEASUREMENT_UNITS = 'cm|mm|inch|inches|in|mah|w|watt|watts|hz|mp|kg|kgs|g|gm|gms|gram|grams|ml|l|ltr|litre|liter|m|ft|v|pcs|pack';
const GLUED_UNIT_PATTERN = new RegExp(`(\\d)(${MEASUREMENT_UNITS})\\b`, 'gi');
// Decimal numbers and number+unit pairs ("15.40 cm", "6.1″", "5000 mAh") describe a
// measurement, not a model number, so "iPhone 15" must not match "15.40 cm".
const MEASUREMENT_PATTERN = new RegExp(
  `\\d+(?:\\.\\d+)?\\s*(?:["″']|(?:${MEASUREMENT_UNITS})\\b)|\\d+\\.\\d+`,
  'gi'
);
// "Compatible with iPhone 15" / "Suitable for Galaxy S24" listings are accessories or parts.
const COMPATIBILITY_PATTERN = /\b(?:compatible|suitable|designed|made)\s+(?:with|for)\b|\bdigitizer\b|\blcd\b/i;

function splitGluedUnits(value) {
  return String(value || '').replace(GLUED_UNIT_PATTERN, '$1 $2');
}

function stripMeasurements(value) {
  return splitGluedUnits(value).replace(MEASUREMENT_PATTERN, ' ');
}

function queryTokens(query) {
  const withoutCapacities = splitGluedUnits(query).replace(/\b\d+\s*(?:gb|tb)\b/gi, ' ');
  return [...new Set(
    tokenize(withoutCapacities)
      .map((token) => {
        if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
        if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2);
        if (token.length > 4 && /(?:ch|sh|x)es$/.test(token)) return token.slice(0, -2);
        if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
        return token;
      })
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  )];
}

function isAccessoryTitle(title, query) {
  const titleTokens = new Set(queryTokens(title));
  const queryTokenSet = new Set(queryTokens(query));
  const titleText = normalizeText(title);
  const queryText = normalizeText(query);
  if (COMPATIBILITY_PATTERN.test(title) && !COMPATIBILITY_PATTERN.test(query)) return true;
  // Words like "earbuds", "case" or "band" are only accessory signals when the user is
  // shopping for a phone/laptop/TV — for "boAt Airdopes" they describe the product itself.
  const deviceQuery =
    (ELECTRONICS_KEYWORDS.some((word) => queryTokenSet.has(word) || queryText.includes(word)) ||
      DEVICE_BRANDS.some((word) => queryTokenSet.has(word))) &&
    !AUDIO_WEARABLE_WORDS.some((word) => queryTokenSet.has(word));
  if (ACCESSORY_WORDS.some((word) => {
    if (DEVICE_CONTEXT_ACCESSORY_WORDS.has(word) && !deviceQuery) return false;
    const normalizedWord = normalizeText(word);
    const wordTokens = queryTokens(normalizedWord);
    const titleHasWord = wordTokens.length === 1
      ? titleTokens.has(wordTokens[0])
      : titleText.includes(normalizedWord);
    const queryHasWord = wordTokens.length === 1
      ? queryTokenSet.has(wordTokens[0])
      : queryText.includes(normalizedWord);
    return titleHasWord && !queryHasWord;
  })) return true;

  // Query is for an electronic device/console but title is apparel (clothing/shoes)
  const isQueryElectronics = ELECTRONICS_KEYWORDS.some((word) => queryText.includes(word));
  if (isQueryElectronics) {
    const isTitleApparel = APPAREL_WORDS.some((word) => titleText.includes(word) && !queryText.includes(word));
    if (isTitleApparel) return true;
  }

  // Query specifies storage capacity but title has none → likely an accessory/case, not the device
  const qStorage = storageTokens(query);
  const tStorage = storageTokens(title);
  if (qStorage.length && !tStorage.length) return true;
  return false;
}

function storageTokens(text) {
  return (normalizeText(text).match(/\d+\s*(?:gb|tb)/g) || []).map((s) => s.replace(/\s+/g, ''));
}

function variantPenalty(query, title) {
  const q = new Set(queryTokens(query));
  const t = new Set(tokenize(title));
  for (const marker of VARIANT_MARKERS) {
    if (t.has(marker) && !q.has(marker)) return Infinity;
  }
  for (const [form, conflicts] of Object.entries(PRODUCT_FORM_CONFLICTS)) {
    if (q.has(form) && conflicts.some((conflict) => t.has(conflict) && !q.has(conflict))) {
      return Infinity;
    }
  }
  const qStorage = storageTokens(query);
  const tStorage = storageTokens(title);
  if (qStorage.length && tStorage.length && qStorage.some((s) => !tStorage.includes(s))) {
    return Infinity;
  }
  return 0;
}

function matchScore(query, title) {
  if (!query || !title) return 0;
  if (isAccessoryTitle(title, query)) return 0;
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const titleTokens = new Set(queryTokens(title));
  // Bare numbers the user typed as a model ("iphone 15") must appear as standalone
  // numbers in the title, not inside a measurement ("15.40 cm").
  const modelNumbers = new Set(queryTokens(stripMeasurements(query)).filter((t) => /^\d+$/.test(t)));
  const titleModelTokens = new Set(queryTokens(stripMeasurements(title)));
  const hasToken = (token) =>
    modelNumbers.has(token)
      ? titleModelTokens.has(token)
      : [token, ...(SEARCH_TERM_EQUIVALENTS[token] || [])].some((equivalent) => titleTokens.has(equivalent));
  const matched = tokens.every(hasToken) || isExactBrandlessModelMatch(tokens, titleModelTokens);
  if (!matched) return 0;
  const penalty = variantPenalty(query, title);
  return Number.isFinite(penalty) ? 1 : 0;
}

// Graded 0..1 relevance used to rank listings that already pass matchScore.
// Titles where the query makes up more of the leading product name rank higher,
// so "Apple iPhone 15 (Blue, 128 GB)" outranks a long keyword-stuffed listing.
function relevanceScore(query, title) {
  if (!matchScore(query, title)) return 0;
  const tokens = queryTokens(query);
  const head = queryTokens(String(title).split(/\s[|｜:–-]\s|[,(]/, 1)[0]).slice(0, 12);
  const titleTokens = queryTokens(title);
  const inHead = tokens.filter((t) => head.includes(t)).length / tokens.length;
  const density = Math.min(1, tokens.length / Math.max(1, Math.min(titleTokens.length, 20)) * 2.5);
  return Math.round((0.5 + 0.3 * inHead + 0.2 * density) * 1000) / 1000;
}

// Turn a long store title into a concise cross-store search query:
// "Apple iPhone 15 (128 GB) - Black | A16 chip ..." -> "Apple iPhone 15".
function buildSearchQuery(name, brand = '') {
  const core = String(name || '')
    .split(/\s[|｜:–-]\s|[,:|(\[]/, 1)[0]
    .replace(/\s+/g, ' ')
    .trim();
  const words = core.split(' ').filter(Boolean).slice(0, 8);
  const brandText = String(brand || '').trim();
  if (brandText && !normalizeText(words.join(' ')).includes(normalizeText(brandText))) {
    words.unshift(brandText);
  }
  return words.join(' ');
}

function pickBestMatch(query, items, minScore = 0.55) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const scored = items
    .map((item) => ({ item, score: matchScore(query, item.name || item.title || '') }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) return { item: scored[0].item, score: scored[0].score };
  return null;
}

function pickMatchForCanonical(canonicalName, items) {
  return pickBestMatch(canonicalName, items, 0.5);
}

module.exports = {
  matchScore,
  relevanceScore,
  buildSearchQuery,
  stripMeasurements,
  queryTokens,
  pickBestMatch,
  pickMatchForCanonical,
  isAccessoryTitle,
};
