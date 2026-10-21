const BaseAdapter = require('./baseAdapter');
const { newPage } = require('../utils/browser');
const {
  parsePrice,
  productNameFromUrl,
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

const SEARCH_URL = 'https://www.amazon.in/s?k=';
const PRODUCT_BASE = 'https://www.amazon.in';

class AmazonInAdapter extends BaseAdapter {
  isAvailable() {
    return true;
  }

  async search(query, _options = {}) {
    if (!query || !String(query).trim()) return [];
    const q = encodeURIComponent(String(query).trim());
    const url = `${SEARCH_URL}${q}`;
    const startedAt = Date.now();

    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      let context;
      try {
        const opened = await newPage();
        context = opened.context;
        const { page } = opened;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const status = response?.status() ?? null;
        logScraperDebug('amazon_in', 'search-response', {
          status,
          path: safePath(page.url()),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });

        if (response && (status === 403 || status === 429 || status >= 500)) {
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw Object.assign(new Error(`Amazon returned HTTP ${status} for the live search.`), { status: 503 });
        }

        await page
          .waitForSelector('div[data-component-type="s-search-result"], div[data-asin]:not([data-asin=""])', {
            timeout: 7000,
          })
          .catch(() => {});

        const { title, bodyText, currentUrl } = await page.evaluate(() => ({
          title: document.title,
          bodyText: document.body.innerText,
          currentUrl: window.location.href,
        }));
        const metadata = extractProductPageMetadata(await page.content());

        if (isBlockedPage(title, bodyText, currentUrl)) {
          logScraperDebug('amazon_in', 'search-blocked', {
            title: title.slice(0, 120),
            attempt: attempts,
            elapsedMs: Date.now() - startedAt,
          });
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw Object.assign(new Error('Amazon blocked the live search request. Try again later.'), { status: 503 });
        }

        const items = await page.$$eval(
          'div[data-component-type="s-search-result"], div[data-asin]:not([data-asin=""])',
          (els) => {
            const seenAsins = new Set();
            const out = [];

            for (const el of els) {
              const asin = el.getAttribute('data-asin') || '';
              if (!asin || asin.length !== 10 || seenAsins.has(asin)) continue;

              // Amazon renders brand and title as separate h2s inside the
              // "title-recipe" block; the title h2 carries the full name in aria-label.
              const recipeHeadings = [...el.querySelectorAll('[data-cy="title-recipe"] h2')];
              const titleHeading =
                recipeHeadings.find((h) => h.getAttribute('aria-label')) ||
                recipeHeadings[recipeHeadings.length - 1] ||
                el.querySelector('h2[aria-label]') ||
                el.querySelector('h2');
              const titleLink =
                titleHeading?.closest('a') ||
                el.querySelector('a.s-line-clamp-3, a.s-line-clamp-2, a.s-line-clamp-1') ||
                el.querySelector('a[href*="/dp/"]') ||
                el.querySelector('a[href*="/sspa/"]');
              let titleText =
                titleHeading?.getAttribute('aria-label')?.trim() ||
                titleHeading?.querySelector('span')?.textContent?.trim() ||
                titleHeading?.textContent?.trim() ||
                titleLink?.textContent?.trim() ||
                '';
              if (!titleText) continue;

              let brandText = '';
              if (recipeHeadings.length > 1 && recipeHeadings[0] !== titleHeading) {
                brandText = recipeHeadings[0].textContent.trim();
              }
              if (!brandText) {
                brandText = el.querySelector('.s-brand-text, h5.s-line-clamp-1')?.textContent?.trim() || '';
              }
              if (brandText.length > 40) brandText = '';

              const href = (titleLink || el.querySelector('a[href*="/dp/"]'))?.getAttribute('href') || '';

              const imgEl = el.querySelector('img.s-image') || el.querySelector('img');
              const image =
                imgEl?.getAttribute('src') ||
                imgEl?.getAttribute('data-src') ||
                imgEl?.getAttribute('srcset')?.split(' ')[0] ||
                '';

              const priceOffscreen =
                el.querySelector('.priceToPay .a-offscreen') ||
                el.querySelector('.a-price:not(.a-text-price) .a-offscreen');
              let priceText = priceOffscreen ? priceOffscreen.textContent.trim() : '';
              if (!priceText) {
                const whole = el.querySelector('.a-price:not(.a-text-price) .a-price-whole');
                if (whole) {
                  const frac = el.querySelector('.a-price:not(.a-text-price) .a-price-fraction');
                  priceText = whole.textContent.trim() + (frac ? '.' + frac.textContent.trim() : '');
                }
              }
              const mrpText = el.querySelector('.a-price.a-text-price .a-offscreen')?.textContent?.trim() || '';

              const ariaLabels = [...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label') || '');
              const ratingText = ariaLabels.find((label) => /out of 5 stars/i.test(label)) || '';
              const ratingCountText =
                ariaLabels.find((label) => /^[d,.]+[kKmM]?s+ratings?$/i.test(label.trim())) ||
                el.querySelector('a[href*="customerReviews"] span')?.textContent ||
                '';

              const cardText = (el.innerText || '').toLowerCase();
              const sponsored = /sponsored/.test(cardText) || Boolean(el.querySelector('.puis-sponsored-label-text'));
              let availText = '';
              if (
                cardText.includes('currently unavailable') ||
                cardText.includes('out of stock') ||
                cardText.includes('temporarily out of stock') ||
                cardText.includes('sold out') ||
                cardText.includes('notify me')
              ) {
                availText = 'out of stock';
              } else if (
                cardText.includes('in stock') ||
                cardText.includes('add to cart') ||
                cardText.includes('buy now') ||
                cardText.includes('free delivery') ||
                cardText.includes('get it by') ||
                cardText.includes('arrives') ||
                priceText
              ) {
                availText = 'in stock';
              }

              seenAsins.add(asin);
              out.push({
                asin,
                title: titleText,
                brand: brandText,
                href,
                image,
                priceText,
                mrpText,
                ratingText,
                ratingCountText,
                sponsored,
                availText,
              });
              if (out.length >= 25) break;
            }
            return out;
          }
        );

        const results = items
          .map((it) => ({ ...it, title: cleanListingTitle(it.title) }))
          .filter((it) => it.title)
          .slice(0, 20)
          .map((it) => {
            // A clean /dp/ASIN link is stable across searches and drops tracking params.
            const productUrl = `${PRODUCT_BASE}/dp/${it.asin}`;
            const price = parsePrice(it.priceText);
            const title = it.title;
            const inferredRedmiBrand =
              /\bredmi\b/i.test(query) && /\b13c\b/i.test(title) && !/\bredmi\b/i.test(title)
                ? 'Redmi'
                : '';
            const brand = inferredRedmiBrand || cleanListingTitle(it.brand);
            const fullName =
              brand && !title.toLowerCase().includes(brand.toLowerCase())
                ? `${brand} ${title}`
                : title;
            const specs = extractSpecsFromString(fullName);
            const availability = price == null ? 'unknown' : detectAvailability(it.availText);

            return {
              id: it.asin,
              name: fullName,
              brand,
              model: '',
              category: '',
              image: it.image,
              specifications: specs,
              rating: parseRating(it.ratingText),
              ratingCount: parseCount(it.ratingCountText),
              sponsored: Boolean(it.sponsored),
              offers: {
                amazon_in: {
                  price,
                  mrp: validMrp(it.mrpText, price),
                  availability,
                  url: productUrl,
                },
              },
            };
          });

        logScraperDebug('amazon_in', 'search-parsed', {
          candidates: items.length,
          returned: results.length,
          elapsedMs: Date.now() - startedAt,
        });
        return results;
      } catch (err) {
        logScraperDebug('amazon_in', 'search-error', {
          status: err.status || null,
          message: safeDiagnosticMessage(err.message),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        if (attempts >= 2) throw err;
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    return [];
  }

  async extractFromUrl(url) {
    const startedAt = Date.now();
    let attempts = 0;

    while (attempts < 2) {
      attempts++;
      const { page, context } = await newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const status = response?.status() ?? null;
        logScraperDebug('amazon_in', 'extract-response', {
          status,
          path: safePath(page.url()),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });

        if (response && (status === 403 || status === 429 || status >= 500)) {
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          const fallbackName = productNameFromUrl(url);
          if (fallbackName && !/^[A-Z0-9]{10}$/i.test(fallbackName)) {
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
              sourceNote: 'Amazon is temporarily unavailable. The product name was inferred from the URL; price and stock are unverified.',
            };
          }
          throw Object.assign(new Error(`Amazon returned HTTP ${status} for the product page.`), { status: 503 });
        }

        await page
          .waitForSelector(
            '#productTitle, #title, #corePrice_feature_div, #corePriceDisplay_desktop_feature_div, .priceToPay, #availability',
            { timeout: 7000 }
          )
          .catch(() => {});

        const { title, bodyText, currentUrl } = await page.evaluate(() => ({
          title: document.title,
          bodyText: document.body.innerText,
          currentUrl: window.location.href,
        }));
        const metadata = extractProductPageMetadata(await page.content());

        if (isBlockedPage(title, bodyText, currentUrl)) {
          logScraperDebug('amazon_in', 'extract-blocked', {
            title: title.slice(0, 120),
            attempt: attempts,
            elapsedMs: Date.now() - startedAt,
          });
          if (attempts < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (metadata) {
            return {
              ...metadata,
              model: '',
              productUrl: url,
              sourceNote: 'Product details were read from structured page metadata; confirm price and stock on the store page.',
            };
          }
          const fallbackName = productNameFromUrl(url);
          if (fallbackName && !/^[A-Z0-9]{10}$/i.test(fallbackName)) {
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
          throw Object.assign(new Error('Amazon blocked the product page request. Try again later.'), { status: 503 });
        }

        const data = await page.evaluate(() => {
          const titleText =
            document.getElementById('productTitle')?.textContent?.trim() ||
            document.getElementById('title')?.textContent?.trim() ||
            document.querySelector('h1')?.textContent?.trim() ||
            document.querySelector('meta[property="og:title"]')?.content ||
            '';

          const image =
            document.getElementById('landingImage')?.getAttribute('src') ||
            document.getElementById('landingImage')?.getAttribute('data-old-hires') ||
            document.getElementById('imgBlkFront')?.getAttribute('src') ||
            document.querySelector('meta[property="og:image"]')?.content ||
            '';

          // Prioritize current selling price over MRP
          const currentPrice =
            document.querySelector('.priceToPay .a-offscreen') ||
            document.querySelector('.apex-pricetopay-value .a-offscreen') ||
            document.querySelector('#corePrice_feature_div .a-offscreen') ||
            document.querySelector('#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen') ||
            document.querySelector('.reinventPricePriceToPayMargin .a-offscreen') ||
            document.querySelector('.a-price:not(.a-text-price) .a-offscreen') ||
            document.querySelector('#price_inside_buybox') ||
            document.querySelector('#priceblock_dealprice') ||
            document.querySelector('#priceblock_ourprice');

          let priceText = currentPrice?.textContent?.trim() || '';
          if (!priceText) {
            const wholeEl =
              document.querySelector('.priceToPay .a-price-whole') ||
              document.querySelector('#corePrice_feature_div .a-price-whole');
            if (wholeEl) {
              const fracEl = wholeEl.parentElement?.querySelector('.a-price-fraction');
              priceText = wholeEl.textContent.trim() + (fracEl ? '.' + fracEl.textContent.trim() : '');
            }
          }

          const availSpan =
            document.querySelector('#availability span') ||
            document.getElementById('availability') ||
            document.getElementById('outOfStock');
          let availText = availSpan ? availSpan.textContent : '';
          // Strip embedded JSON from availability text
          availText = availText.replace(/\{[\s\S]*?\}/g, ' ').trim();

          const addToCart = Boolean(
            document.getElementById('add-to-cart-button') || document.getElementById('add-to-cart-button-ubb')
          );
          const buyNow = Boolean(document.getElementById('buy-now-button'));

          const brand =
            document.querySelector('tr.po-brand .po-break-word')?.textContent?.trim() ||
            document.getElementById('bylineInfo')?.textContent?.trim() ||
            '';

          const mrpText =
            document.querySelector('#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen')?.textContent ||
            document.querySelector('#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen')?.textContent ||
            document.querySelector('#corePrice_feature_div .a-text-price .a-offscreen')?.textContent ||
            '';
          const ratingText =
            document.querySelector('#acrPopover')?.getAttribute('title') ||
            document.querySelector('#acrPopover .a-icon-alt')?.textContent ||
            '';
          const ratingCountText = document.getElementById('acrCustomerReviewText')?.textContent || '';

          return {
            title: titleText,
            image,
            priceText,
            mrpText,
            ratingText,
            ratingCountText,
            availText,
            addToCart,
            buyNow,
            brand,
          };
        });
        data.title = data.title || metadata?.name || '';
        data.image = data.image || metadata?.imageUrl || '';
        data.priceText = data.priceText || metadata?.price || '';
        data.availText = data.availText || metadata?.availability || '';
        data.brand = data.brand || metadata?.brand || '';

        if (!data.title) {
          const urlName = productNameFromUrl(url);
          logScraperDebug('amazon_in', 'extract-empty-product', {
            title: title.slice(0, 120),
            hasUrlFallbackName: Boolean(urlName),
            elapsedMs: Date.now() - startedAt,
          });
          if (!urlName) return null;
          return {
            name: urlName,
            brand: urlName.split(' ')[0] || '',
            model: '',
            category: '',
            imageUrl: '',
            specifications: extractSpecsFromString(urlName),
            price: null,
            availability: 'unknown',
            productUrl: url,
            sourceNote:
              'Amazon did not provide product details. The name was read from the product URL; price and availability could not be verified.',
          };
        }

        const price = parsePrice(data.priceText);
        let availability = detectAvailability(data.availText);
        if (availability === 'unknown') {
          if (data.addToCart || data.buyNow || price != null) availability = 'in_stock';
        }

        let brand = data.brand
          .replace(/^Brand:\s*/i, '')
          .replace(/^Visit the\s*/i, '')
          .replace(/\s+Store$/i, '')
          .trim();
        if (!brand || brand.length > 35) {
          brand = data.title.split(/\s+/)[0] || '';
        }

        const specs = extractSpecsFromString(data.title);
        logScraperDebug('amazon_in', 'extract-parsed', {
          hasPrice: price != null,
          availability,
          hasImage: Boolean(data.image),
          elapsedMs: Date.now() - startedAt,
        });

        return {
          name: data.title,
          brand,
          model: '',
          category: metadata?.category || '',
          imageUrl: data.image,
          specifications: { ...metadata?.specifications, ...specs },
          price,
          mrp: validMrp(data.mrpText, price),
          rating: parseRating(data.ratingText),
          ratingCount: parseCount(data.ratingCountText),
          availability,
          productUrl: url,
        };
      } catch (err) {
        logScraperDebug('amazon_in', 'extract-error', {
          status: err.status || null,
          message: safeDiagnosticMessage(err.message),
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        if (attempts >= 2) {
          const fallbackName = productNameFromUrl(url);
          if (fallbackName && !/^[A-Z0-9]{10}$/i.test(fallbackName)) {
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
              sourceNote: 'Amazon could not be reached. The product name was inferred from the URL; price and stock are unverified.',
            };
          }
          if (!err.status) {
            err.status = 502;
            err.message = `Could not load the Amazon product page: ${err.message}`;
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

module.exports = AmazonInAdapter;
