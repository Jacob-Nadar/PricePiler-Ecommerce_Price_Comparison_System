// Flipkart adapter backed by a headless Chromium (Playwright).
//
// Flipkart renders its listings with React and ships no API for us, so both the
// search page and the product page are read after the browser has rendered them:
//   - search: each result card carries a `data-id` (the product id), the full
//     title in the image `alt`, and the selling price / MRP as ₹ leaves.
//   - product page: Flipkart embeds a schema.org Product JSON-LD block (name,
//     images, brand, rating, price, availability), which is the primary source;
//     the rendered DOM fills in the MRP (shown without a ₹ sign) and is used as
//     a fallback when the JSON-LD block is missing.
const BaseAdapter = require('./baseAdapter');
const { newPage } = require('../utils/browser');
const {
  parsePrice,
  productNameFromFlipkartUrl,
  detectAvailability,
  isBlockedPage,
  cleanListingTitle,
  parseRating,
  parseCount,
  validMrp,
} = require('../utils/scraperUtils');
const { extractSpecsFromString } = require('../utils/productUtils');
const { logScraperDebug, safeDiagnosticMessage, safePath } = require('../utils/scraperDebug');
const { extractProductPageMetadata } = require('../utils/productPageMetadata');

const SEARCH_URL = 'https://www.flipkart.com/search?q=';
const PRODUCT_BASE = 'https://www.flipkart.com';
const PAGE_TIMEOUT_MS = 25000;
const RESULT_WAIT_MS = 8000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
const MAX_RESULTS = 24;

// Flipkart's bot wall / error page. isBlockedPage() covers captchas and
// "Access Denied"; these are the Flipkart-specific phrasings.
const BLOCKED_BODY = /unusual traffic|request blocked|verify (?:that )?you are (?:a )?human|complete the captcha|something went wrong/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeImageUrl(value) {
  const src = String(value || '').trim();
  if (!src) return '';
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

// Canonical product URL: drop tracking params but keep `pid`, so the same
// listing keeps one key (and one price-history series) across searches.
function normalizeProductUrl(href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, PRODUCT_BASE);
    if (url.hostname !== 'flipkart.com' && !url.hostname.endsWith('.flipkart.com')) return '';
    const pid = url.searchParams.get('pid');
    return `${PRODUCT_BASE}${url.pathname}${pid ? `?pid=${encodeURIComponent(pid)}` : ''}`;
  } catch {
    return '';
  }
}

// Turns one raw search card (collected inside the browser) into a product in the
// shape productService expects. Pure so it can be unit-tested without a network.
function normalizeSearchCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const productUrl = normalizeProductUrl(raw.href);
  const name = cleanListingTitle(String(raw.title || '').trim());
  if (!productUrl || !name) return null;

  const prices = (Array.isArray(raw.priceTexts) ? raw.priceTexts : [])
    .map(parsePrice)
    .filter((value) => value != null && value > 0);
  const price = prices.length ? prices[0] : null;
  // The first bigger ₹ amount on the card is the MRP; later amounts are exchange
  // offers and bank discounts, which validMrp/ordering keep out.
  const mrp = validMrp(prices.slice(1).find((value) => value > price) ?? null, price);

  const cardText = String(raw.cardText || '');
  let availability = detectAvailability(cardText);
  if (availability === 'unknown' && price != null && !/sold out|unavailable/i.test(cardText)) {
    availability = 'in_stock';
  }

  return {
    id: String(raw.id || '').trim() || productUrl,
    name,
    brand: '',
    model: '',
    category: '',
    image: normalizeImageUrl(raw.image),
    specifications: extractSpecsFromString(name),
    rating: parseRating(raw.ratingText),
    ratingCount: parseCount(raw.ratingCountText),
    sponsored: Boolean(raw.sponsored),
    offers: {
      flipkart: {
        price,
        mrp,
        availability,
        url: productUrl,
      },
    },
  };
}

// Merges the JSON-LD metadata with the rendered DOM into the adapter result.
// Pure so it can be unit-tested without a network.
function normalizeExtractedProduct({ url, dom = {}, metadata = null }) {
  const productUrl = String(url || '').trim();
  const name = cleanListingTitle(
    String(metadata?.name || dom.title || productNameFromFlipkartUrl(productUrl) || '').trim()
  );
  if (!name) return null;

  const metadataPrice = parsePrice(metadata?.price);
  const domPrice = parsePrice(dom.priceText);
  const price = metadataPrice ?? domPrice;
  const mrp = validMrp(dom.mrpText, price);

  let availability = 'unknown';
  if (metadata?.availability && metadata.availability !== 'unknown') {
    availability = metadata.availability;
  } else {
    availability = detectAvailability(`${String(dom.availabilityText || '')} ${String(dom.bodyText || '').slice(0, 2000)}`);
    if (availability === 'unknown' && (dom.addToCart || dom.buyNow)) availability = 'in_stock';
    if (availability === 'unknown' && price != null) availability = 'in_stock';
  }

  const specifications = { ...metadata?.specifications, ...extractSpecsFromString(name) };

  return {
    name,
    brand: metadata?.brand || '',
    model: '',
    category: metadata?.category || '',
    imageUrl: normalizeImageUrl(metadata?.imageUrl || dom.image),
    specifications,
    price: price != null && price > 0 ? price : null,
    mrp,
    rating: metadata?.rating ?? parseRating(dom.ratingText),
    ratingCount: metadata?.ratingCount ?? parseCount(dom.ratingCountText),
    availability,
    productUrl,
    ...(!metadata && price == null
      ? {
          sourceNote:
            'Flipkart did not provide product details. The name was read from the product URL; price and availability could not be verified.',
        }
      : {}),
  };
}

function urlFallback(url, sourceNote) {
  const name = productNameFromFlipkartUrl(url);
  if (!name) return null;
  return {
    name,
    brand: '',
    model: '',
    category: '',
    imageUrl: '',
    specifications: extractSpecsFromString(name),
    price: null,
    availability: 'unknown',
    productUrl: url,
    sourceNote,
  };
}

// Runs inside the browser: reads every result card on a Flipkart search page.
function readSearchCards() {
  const PRICE = /^(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d+)?$/i;
  const GENERIC = /^(?:add to compare|compare|sponsored|bestseller|currently unavailable|sold out|coming soon|notify me|hot deal|trending|new|ad|upto|up to)\b/i;
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll('div[data-id]')];
  const out = [];

  for (const card of cards) {
    const link = card.querySelector('a[href*="/p/"]');
    if (!link) continue;
    const img = card.querySelector('img');
    const leaves = [...card.querySelectorAll('div,span')].filter((el) => el.children.length === 0);
    const leafTexts = leaves.map(textOf);
    const priceTexts = leafTexts.filter((text) => PRICE.test(text));
    // Titles are also mirrored in the image alt; the text fallback skips badges,
    // spec bullets and rating fragments that share the card.
    const title =
      String(img?.getAttribute('alt') || '').trim() ||
      String(link.getAttribute('title') || '').trim() ||
      leafTexts.find(
        (text) =>
          text.length >= 8 &&
          text.length <= 220 &&
          !GENERIC.test(text) &&
          !PRICE.test(text) &&
          !/^\d[\d,.]*\s*(?:ratings?|reviews?)$/i.test(text)
      ) ||
      '';
    const cardText = (card.innerText || card.textContent || '').replace(/\s+/g, ' ');
    const ratingEl = card.querySelector('[id^="productRating_"]');
    const countMatch = cardText.match(/([\d,.]+\s*[kKmM]?)\s*(?:ratings?|reviews?)/i);

    out.push({
      id: card.getAttribute('data-id') || '',
      href: link.getAttribute('href') || '',
      title,
      image: img?.getAttribute('src') || img?.getAttribute('data-src') || '',
      priceTexts,
      ratingText: ratingEl ? ratingEl.textContent : '',
      ratingCountText: countMatch ? countMatch[0] : '',
      cardText,
      sponsored: /\bsponsored\b/i.test(cardText),
    });
  }
  return out;
}

// Runs inside the browser: reads the parts of a product page the JSON-LD block
// does not carry (notably the MRP, which is rendered without a ₹ sign).
function readProductDom() {
  const PRICE = /^(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d+)?$/i;
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const leaves = [...document.querySelectorAll('div,span')].filter((el) => el.children.length === 0);

  const priced = leaves
    .map((el) => ({ text: textOf(el), size: parseFloat(getComputedStyle(el).fontSize) || 0 }))
    .filter((entry) => PRICE.test(entry.text))
    // The selling price is rendered far larger than fees, EMI lines and the MRP.
    .sort((a, b) => b.size - a.size);

  const mrp = leaves
    .map((el) => ({ text: textOf(el), strike: getComputedStyle(el).textDecorationLine || '' }))
    .filter((entry) => /^[\d,]+(?:\.\d+)?$/.test(entry.text) && entry.strike.includes('line-through'))
    .sort(
      (a, b) =>
        Number(String(b.text).replace(/[^\d.]/g, '')) - Number(String(a.text).replace(/[^\d.]/g, ''))
    );

  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
  const buttonTexts = [...document.querySelectorAll('button, a, div')]
    .filter((el) => el.children.length === 0)
    .map(textOf)
    .filter((text) => /^(?:buy now|add to cart|add to bag|sold out|notify me|coming soon)$/i.test(text));
  const joinedButtons = buttonTexts.join(' ');
  const h1 = document.querySelector('h1');
  const img = document.querySelector('img[src*="flixcart"]');
  const ratingMatch =
    bodyText.match(/([1-5](?:\.\d)?)\s*\|\s*([\d,]+)/) ||
    bodyText.match(/([1-5](?:\.\d)?)\s*([\d,]+)\s*ratings?/i);

  return {
    title: h1 ? textOf(h1) : '',
    priceText: priced[0] ? priced[0].text : '',
    mrpText: mrp[0] ? mrp[0].text : '',
    image: img?.getAttribute('src') || '',
    bodyText: bodyText.slice(0, 4000),
    availabilityText: joinedButtons,
    addToCart: /add to (?:cart|bag)/i.test(joinedButtons),
    buyNow: /buy now/i.test(joinedButtons),
    ratingText: ratingMatch ? ratingMatch[1] : '',
    ratingCountText: ratingMatch ? ratingMatch[2] : '',
  };
}

class FlipkartAdapter extends BaseAdapter {
  isAvailable() {
    return true;
  }

  async search(query, _options = {}) {
    const q = String(query || '').trim();
    if (!q) return [];
    const url = `${SEARCH_URL}${encodeURIComponent(q)}&marketplace=FLIPKART`;
    const startedAt = Date.now();

    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      let context;
      try {
        const opened = await newPage();
        context = opened.context;
        const { page } = opened;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        const status = response?.status() ?? null;
        logScraperDebug('flipkart', 'search-response', {
          status,
          path: safePath(page.url()),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });

        if (response && (status === 403 || status === 429 || status >= 500)) {
          if (attempts < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          throw Object.assign(new Error(`Flipkart returned HTTP ${status} for the live search.`), { status: 503 });
        }

        await page.waitForSelector('div[data-id]', { timeout: RESULT_WAIT_MS }).catch(() => {});

        const { title, bodyText, currentUrl } = await page.evaluate(() => ({
          title: document.title,
          bodyText: document.body.innerText,
          currentUrl: window.location.href,
        }));

        if (isBlockedPage(title, bodyText, currentUrl) || BLOCKED_BODY.test(String(bodyText).slice(0, 1500))) {
          logScraperDebug('flipkart', 'search-blocked', {
            title: String(title).slice(0, 120),
            attempt: attempts,
            elapsedMs: Date.now() - startedAt,
          });
          if (attempts < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          throw Object.assign(new Error('Flipkart blocked the live search request. Try again later.'), {
            status: 503,
          });
        }

        const rawCards = await page.evaluate(readSearchCards);
        const results = rawCards
          .map(normalizeSearchCard)
          .filter(Boolean)
          .slice(0, MAX_RESULTS);

        logScraperDebug('flipkart', 'search-parsed', {
          cards: rawCards.length,
          returned: results.length,
          elapsedMs: Date.now() - startedAt,
        });
        return results;
      } catch (err) {
        logScraperDebug('flipkart', 'search-error', {
          status: err.status || null,
          message: safeDiagnosticMessage(err.message),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        if (attempts >= MAX_ATTEMPTS) {
          if (!err.status) {
            err.status = 502;
            err.message = `Could not load Flipkart search results: ${err.message}`;
          }
          throw err;
        }
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    return [];
  }

  async extractFromUrl(url) {
    const cleanUrl = String(url || '').trim();
    const startedAt = Date.now();
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const { page, context } = await newPage();
      try {
        const response = await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        const status = response?.status() ?? null;
        logScraperDebug('flipkart', 'extract-response', {
          status,
          path: safePath(page.url()),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });

        if (response && (status === 403 || status === 429 || status >= 500)) {
          if (attempts < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          const fallback = urlFallback(
            cleanUrl,
            'Flipkart could not be reached. The product name was inferred from the URL; price and stock are unverified.'
          );
          if (fallback) return fallback;
          throw Object.assign(new Error(`Flipkart returned HTTP ${status} for the product page.`), {
            status: 503,
          });
        }

        await page.waitForSelector('h1, script[type="application/ld+json"]', { timeout: RESULT_WAIT_MS }).catch(() => {});

        const { title, bodyText, currentUrl } = await page.evaluate(() => ({
          title: document.title,
          bodyText: document.body.innerText,
          currentUrl: window.location.href,
        }));

        if (isBlockedPage(title, bodyText, currentUrl) || BLOCKED_BODY.test(String(bodyText).slice(0, 1500))) {
          logScraperDebug('flipkart', 'extract-blocked', {
            title: String(title).slice(0, 120),
            attempt: attempts,
            elapsedMs: Date.now() - startedAt,
          });
          if (attempts < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          const fallback = urlFallback(
            cleanUrl,
            'Flipkart blocked the product page. The product name was inferred from the URL; price and stock are unverified.'
          );
          if (fallback) return fallback;
          throw Object.assign(new Error('Flipkart blocked the product page request. Try again later.'), {
            status: 503,
          });
        }

        const metadata = extractProductPageMetadata(await page.content());
        const dom = await page.evaluate(readProductDom);
        const product = normalizeExtractedProduct({ url: cleanUrl, dom, metadata });

        if (!product) {
          logScraperDebug('flipkart', 'extract-empty-product', {
            title: String(title).slice(0, 120),
            elapsedMs: Date.now() - startedAt,
          });
          return urlFallback(
            cleanUrl,
            'Flipkart did not provide product details. The name was read from the product URL; price and availability could not be verified.'
          );
        }

        logScraperDebug('flipkart', 'extract-parsed', {
          hasMetadata: Boolean(metadata),
          hasPrice: product.price != null,
          availability: product.availability,
          hasImage: Boolean(product.imageUrl),
          elapsedMs: Date.now() - startedAt,
        });
        return product;
      } catch (err) {
        logScraperDebug('flipkart', 'extract-error', {
          status: err.status || null,
          message: safeDiagnosticMessage(err.message),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        if (attempts >= MAX_ATTEMPTS) {
          const fallback = urlFallback(
            cleanUrl,
            'Flipkart could not be reached. The product name was inferred from the URL; price and stock are unverified.'
          );
          if (fallback) return fallback;
          if (!err.status) {
            err.status = 502;
            err.message = `Could not load the Flipkart product page: ${err.message}`;
          }
          throw err;
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
    return null;
  }
}

module.exports = FlipkartAdapter;
// Pure parsers, exported for unit tests.
module.exports.normalizeSearchCard = normalizeSearchCard;
module.exports.normalizeExtractedProduct = normalizeExtractedProduct;
module.exports.normalizeProductUrl = normalizeProductUrl;
