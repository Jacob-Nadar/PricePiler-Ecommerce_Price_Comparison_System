const BaseAdapter = require('./baseAdapter');
const { newPage } = require('../utils/browser');
const {
  parsePrice,
  detectAvailability,
  isBlockedPage,
  productNameFromFlipkartUrl,
  cleanListingTitle,
  parseRating,
  parseCount,
  validMrp,
} = require('../utils/scraperUtils');
const { extractSpecsFromString } = require('../utils/productUtils');
const { extractProductPageMetadata } = require('../utils/productPageMetadata');

const SEARCH_URL = 'https://www.flipkart.com/search?q=';
const PRODUCT_BASE = 'https://www.flipkart.com';

// Keep only the product path and pid; drop search-session tracking params.
function cleanFlipkartUrl(value) {
  try {
    const url = new URL(value);
    const pid = url.searchParams.get('pid');
    url.search = pid ? `?pid=${encodeURIComponent(pid)}` : '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

class FlipkartAdapter extends BaseAdapter {
  isAvailable() {
    return true;
  }

  async search(query, _options = {}) {
    if (!query || !String(query).trim()) return [];
    const q = encodeURIComponent(String(query).trim());
    const url = `${SEARCH_URL}${q}`;

    const { page, context } = await newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response && (response.status() === 403 || response.status() === 429 || response.status() >= 500)) {
        throw Object.assign(new Error(`Flipkart returned HTTP ${response.status()} for the live search.`), { status: 503 });
      }
      await page.waitForSelector('a[href*="/p/"]', { timeout: 7000 }).catch(() => {});

      const { title, bodyText } = await page.evaluate(() => ({
        title: document.title,
        bodyText: document.body.innerText,
      }));
      if (isBlockedPage(title, bodyText, url)) {
        throw Object.assign(new Error('Flipkart blocked the live search request. Try again later.'), { status: 503 });
      }

      const items = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="/p/"]')];
        const cards = [];
        const seenProducts = new Set();
        const ownText = (el) =>
          [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        const productKey = (href) => (href || '').split('?')[0];

        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const key = productKey(href);
          if (!key || seenProducts.has(key)) continue;

          // Walk up until the container would include a different product.
          let card = link;
          for (let i = 0; i < 8; i++) {
            const parent = card.parentElement;
            if (!parent) break;
            const keys = new Set(
              [...parent.querySelectorAll('a[href*="/p/"]')].map((a) => productKey(a.getAttribute('href')))
            );
            if (keys.size > 1) break;
            card = parent;
          }

          const leaves = [...card.querySelectorAll('div, span, a')]
            .filter((el) => el.children.length === 0)
            .map((el) => ({
              text: el.textContent.trim(),
              struck: window.getComputedStyle(el).textDecorationLine.includes('line-through'),
            }))
            .filter((leaf) => leaf.text);

          const titleAttr = [...card.querySelectorAll('a[title]')]
            .map((a) => a.getAttribute('title').trim())
            .find(Boolean);
          const imgAlt = card.querySelector('img[alt]')?.getAttribute('alt')?.trim() || '';
          const leafTitle = leaves.find((leaf) => {
            const t = leaf.text;
            return (
              t.length > 8 && t.length < 200 && !t.startsWith('₹') &&
              !/^(add to compare|currently unavailable|sponsored|bestseller)$/i.test(t) &&
              !/^[\d,]+\s*(ratings?|reviews?)$/i.test(t) && !/% off$/i.test(t)
            );
          })?.text;
          const titleText = titleAttr || (imgAlt.length > 8 ? imgAlt : '') || leafTitle || '';
          if (!titleText) continue;

          // Grid (fashion/home) cards show the brand as a short label above the title.
          let brand = '';
          const titleIndex = leaves.findIndex((leaf) => leaf.text === titleText);
          if (titleIndex > 0) {
            const candidate = leaves[titleIndex - 1].text;
            const isStatusLabel =
              /compare|sponsored|^ad$|unavailable|sold out|coming soon|notify|bestseller|trending|% off|ratings?$/i.test(candidate);
            if (candidate.length <= 30 && !candidate.startsWith('₹') && !isStatusLabel) {
              brand = candidate;
            }
          }

          // Selling price comes first; a second ₹ value is the list price only
          // when it is struck through or the card shows a "% off" label.
          // Values after "Upto"/"Exchange" are exchange or bank offers.
          const priceLeaves = [];
          for (const leaf of leaves) {
            if (/^upto$|^up to$|exchange|bank offer/i.test(leaf.text)) break;
            if (/^₹\s*[\d,]+(\.\d+)?$/.test(leaf.text)) priceLeaves.push(leaf);
          }
          const priceLeaf = priceLeaves.find((leaf) => !leaf.struck) || priceLeaves[0] || null;
          const discountText = leaves.find((leaf) => /^\d+%\s*off$/i.test(leaf.text))?.text || '';
          const mrpLeaf = priceLeaves.find((leaf) => leaf !== priceLeaf && (leaf.struck || discountText));

          const ratingText =
            [...card.querySelectorAll('div, span')].map(ownText).find((t) => /^[1-5](\.\d)?$/.test(t)) || '';
          const ratingCountText =
            leaves.find((leaf) => /^[\d,]+\s*ratings?$/i.test(leaf.text))?.text ||
            leaves.find((leaf) => /^\([\d,]+\)$/.test(leaf.text))?.text ||
            '';

          const img = card.querySelector('img');
          const cardText = (card.innerText || '').toLowerCase();
          let availText = '';
          if (
            cardText.includes('currently unavailable') ||
            cardText.includes('sold out') ||
            cardText.includes('out of stock') ||
            cardText.includes('notify me') ||
            cardText.includes('currently not available')
          ) {
            availText = 'out of stock';
          } else if (priceLeaf) {
            // Flipkart only shows a selling price on purchasable listings.
            availText = 'in stock';
          }

          seenProducts.add(key);
          cards.push({
            title: titleText,
            brand,
            href,
            image: img ? img.getAttribute('src') : '',
            priceText: priceLeaf ? priceLeaf.text : '',
            mrpText: mrpLeaf ? mrpLeaf.text : '',
            ratingText,
            ratingCountText,
            sponsored: /\bsponsored\b/.test(cardText),
            availText,
          });
          if (cards.length >= 24) break;
        }
        return cards;
      });

      return items
        .map((it) => ({ ...it, title: cleanListingTitle(it.title) }))
        .filter((it) => it.title)
        .map((it) => {
          const rawUrl = it.href.startsWith('http') ? it.href : `${PRODUCT_BASE}${it.href}`;
          const productUrl = cleanFlipkartUrl(rawUrl);
          const price = parsePrice(it.priceText);
          const brand = it.brand && !/^[\d.]+$/.test(it.brand) ? it.brand : '';
          const name =
            brand && !it.title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${it.title}` : it.title;
          const specs = extractSpecsFromString(name);
          const availability = price == null ? 'unknown' : detectAvailability(it.availText);
          return {
            id: productUrl,
            name,
            brand,
            model: '',
            category: '',
            image: it.image,
            specifications: specs,
            rating: parseRating(it.ratingText),
            ratingCount: parseCount(it.ratingCountText),
            sponsored: Boolean(it.sponsored),
            offers: {
              flipkart: {
                price,
                mrp: validMrp(it.mrpText, price),
                availability,
                url: productUrl,
              },
            },
          };
        });
    } finally {
      await context.close().catch(() => {});
    }
  }

  // Flipkart product pages render their details lazily, so a headless load often
  // sees only the page shell (and a promo price in og:title). Search cards render
  // reliably, so look the product up by its slug and match the exact item id.
  async lookupListing(url) {
    const itemId = String(url).match(/\/p\/(itm[a-z0-9]+)/i)?.[1]?.toLowerCase();
    const name = productNameFromFlipkartUrl(url);
    if (!itemId || !name) return null;
    let listings;
    try {
      listings = await this.search(name);
    } catch {
      return null;
    }
    const listing = listings.find((item) =>
      String(item.offers?.flipkart?.url || '').toLowerCase().includes(`/p/${itemId}`)
    );
    if (!listing) return null;
    const offer = listing.offers.flipkart;
    return {
      name: listing.name,
      brand: listing.brand || '',
      model: '',
      category: '',
      imageUrl: listing.image || '',
      specifications: listing.specifications || {},
      price: offer.price,
      mrp: offer.mrp ?? null,
      rating: listing.rating ?? null,
      ratingCount: listing.ratingCount ?? null,
      availability: offer.availability,
      productUrl: url,
      sourceNote: 'Live price and stock read from the Flipkart listing for this product.',
    };
  }

  async extractFromUrl(url) {
    const listing = await this.lookupListing(url);
    if (listing) return listing;

    let context;
    try {
      const opened = await newPage();
      context = opened.context;
      const { page } = opened;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response && (response.status() === 403 || response.status() === 429 || response.status() >= 500)) {
        const fallbackName = productNameFromFlipkartUrl(url);
        if (fallbackName) {
          return {
            name: fallbackName,
            brand: '',
            model: '',
            category: '',
            imageUrl: '',
            specifications: extractSpecsFromString(fallbackName),
            price: null,
            availability: 'unknown',
            productUrl: url,
            sourceNote: 'Flipkart is temporarily unavailable. The product name was inferred from the URL; price and stock are unverified.',
          };
        }
        throw Object.assign(new Error(`Flipkart returned HTTP ${response.status()} for the product page.`), { status: 503 });
      }
      await page.waitForSelector('h1, [class*="VU-ZEz"], [class*="B_NuCI"]', { timeout: 7000 }).catch(() => {});

      const { title, bodyText } = await page.evaluate(() => ({
        title: document.title,
        bodyText: document.body.innerText,
      }));
      const metadata = extractProductPageMetadata(await page.content());
      if (isBlockedPage(title, bodyText, url)) {
        if (metadata) {
          return {
            ...metadata,
            model: '',
            productUrl: url,
            sourceNote: 'Product details were read from structured page metadata; confirm price and stock on the store page.',
          };
        }
        const fallbackName = productNameFromFlipkartUrl(url);
        if (fallbackName) {
          return {
            name: fallbackName,
            brand: '',
            model: '',
            category: '',
            imageUrl: '',
            specifications: extractSpecsFromString(fallbackName),
            price: null,
            availability: 'unknown',
            productUrl: url,
            sourceNote: 'The store page could not be read. The product name was inferred from the URL; price and stock are unverified.',
          };
        }
        throw Object.assign(new Error('Flipkart blocked the product page request. Try again later.'), { status: 503 });
      }

      const data = await page.evaluate(() => {
        // og:meta is the most reliable source for Flipkart PDP (content is JS-rendered)
        const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

        const titleEl =
          document.querySelector('span.VU-ZEz') ||
          document.querySelector('h1.yhB1nd span') ||
          document.querySelector('.B_NuCI') ||
          document.querySelector('[class*="VU-ZEz"]');
        const titleText = titleEl
          ? titleEl.textContent.trim()
          : (document.querySelector('h1')?.textContent?.trim() || '');

        const structuredPrice =
          document.querySelector('meta[property="product:price:amount"]')?.content ||
          document.querySelector('meta[itemprop="price"]')?.content ||
          '';
        const currentPrice = document.querySelector('[class*="Nx9bqj"]');
        const priceEls = [...document.querySelectorAll('[class*="Nx9bqj"], [class*="CEmiEU"]')].filter((el) => {
          const t = el.textContent.trim();
          const struckThrough = window.getComputedStyle(el).textDecorationLine.includes('line-through');
          return t.startsWith('₹') && t.length < 20 && el.children.length === 0 &&
            !el.closest('[class*="yRaY8j"]') && !struckThrough;
        });
        let priceText = structuredPrice || currentPrice?.textContent || (priceEls.length > 0 ? priceEls[0].textContent : '');

        // Fallback title from og:title (e.g. "Apple iPhone 15 | BBD's ₹63,999 Premium Value Pick").
        // The ₹ amount there is a sale-campaign banner, not the listing price, so it is not used.
        let finalTitle = titleText;
        if (!finalTitle && ogTitle) {
          finalTitle = ogTitle.split('|')[0].trim();
        }

        // Product photos are served from Flipkart's rukminim CDN; anything else
        // (site logo, category icons, inline SVGs) is page chrome.
        const imgEl =
          document.querySelector('img._396cs4') ||
          document.querySelector('div._3li7GG img') ||
          document.querySelector('img._2r_T1I') ||
          document.querySelector('img.CXW8mj') ||
          document.querySelector('img[src*="rukminim"]');
        const image = (imgEl ? imgEl.getAttribute('src') : '') || ogImage || '';

        const pageText = (document.body.innerText || '').slice(0, 4000).toLowerCase();
        let availText = '';
        if (
          pageText.includes('currently unavailable') ||
          pageText.includes('sold out') ||
          pageText.includes('out of stock') ||
          pageText.includes('notify me')
        ) {
          availText = 'out of stock';
        } else if (pageText.includes('add to cart') || pageText.includes('buy now')) {
          availText = 'in stock';
        }

        return { title: finalTitle, image, priceText, availText };
      });

      const productName = data.title || metadata?.name;
      if (!productName) return null;
      const price = parsePrice(data.priceText) ?? metadata?.price ?? null;
      const detectedAvailability = detectAvailability(data.availText);
      const availability =
        detectedAvailability !== 'unknown'
          ? detectedAvailability
          : metadata?.availability || 'unknown';
      // The URL slug keeps the variant ("apple-iphone-15-blue-128-gb") that og:title drops.
      const specs = {
        ...extractSpecsFromString(productNameFromFlipkartUrl(url)),
        ...extractSpecsFromString(productName),
      };

      return {
        name: productName,
        brand: metadata?.brand || '',
        model: '',
        category: metadata?.category || '',
        imageUrl: data.image || metadata?.imageUrl || '',
        specifications: { ...metadata?.specifications, ...specs },
        price,
        availability,
        productUrl: url,
        ...(!data.title
          ? { sourceNote: 'Product details were read from structured page metadata; confirm price and stock on the store page.' }
          : {}),
      };
    } catch (err) {
      console.warn('[flipkart] extractFromUrl failed:', err.message);
      const fallbackName = productNameFromFlipkartUrl(url);
      if (fallbackName) {
        return {
          name: fallbackName,
          brand: '',
          model: '',
          category: '',
          imageUrl: '',
          specifications: extractSpecsFromString(fallbackName),
          price: null,
          availability: 'unknown',
          productUrl: url,
          sourceNote: 'Flipkart could not be reached. The product name was inferred from the URL; price and stock are unverified.',
        };
      }
      throw err;
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }
}

module.exports = FlipkartAdapter;
