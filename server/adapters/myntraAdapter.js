const axios = require('axios');
const BaseAdapter = require('./baseAdapter');
const {
  productNameFromMyntraUrl,
  parsePrice,
  detectAvailability,
  parseRating,
  parseCount,
  validMrp,
} = require('../utils/scraperUtils');
const { extractSpecsFromString } = require('../utils/productUtils');
const { matchScore } = require('../utils/matchUtils');
const { logScraperDebug, safePath } = require('../utils/scraperDebug');
const { extractProductPageMetadata } = require('../utils/productPageMetadata');
const { getAxiosProxyOptions } = require('../utils/scraperProxy');

// Myntra search uses a path-based URL: https://www.myntra.com/<query-with-hyphens>
// The /search?q= form returns unrelated default results.
const SEARCH_BASE = 'https://www.myntra.com/';
const PRODUCT_BASE = 'https://www.myntra.com';
const REQUEST_TIMEOUT_MS = 15000;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};

function parsePageData(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/window\.__myx\s*=\s*/);
  if (!match) return null;

  const jsonStart = match.index + match[0].length;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (jsonEnd < 0) return null;

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd).trim().replace(/;$/, ''));
  } catch (err) {
    logScraperDebug('myntra', 'embedded-data-invalid', {
      message: err.message,
      htmlBytes: Buffer.byteLength(html),
    });
    return null;
  }
}

function parseLdJson(html) {
  if (typeof html !== 'string') return null;
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && parsed['@type'] === 'Product') {
        return parsed;
      }
    } catch {}
  }
  return null;
}

function productAvailability(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) return 'unknown';
  if (inventory.some((size) => size.available === true && Number(size.inventory) > 0)) {
    return 'in_stock';
  }
  if (inventory.every((size) => size.available === false || Number(size.inventory) === 0)) {
    return 'out_of_stock';
  }
  return 'unknown';
}

function currentPdpPrice(sizes) {
  if (!Array.isArray(sizes) || sizes.length === 0) return null;
  // Only look at sizes that are currently available
  const availableSizes = sizes.filter((size) => size.available !== false);
  const targetSizes = availableSizes.length > 0 ? availableSizes : sizes;

  const prices = targetSizes.flatMap((size) =>
    (size.sizeSellerData || [])
      .filter((seller) => seller.discountedPrice != null && seller.discountedPrice !== '')
      .filter((seller) => Number.isFinite(Number(seller.discountedPrice)))
      .map((seller) => Number(seller.discountedPrice))
  );
  return prices.length ? Math.min(...prices) : null;
}

class MyntraAdapter extends BaseAdapter {
  isAvailable() {
    return true;
  }

  async fetchPage(url) {
    const startedAt = Date.now();
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const response = await axios.get(url, {
          timeout: REQUEST_TIMEOUT_MS,
          maxRedirects: 3,
          headers: HEADERS,
          ...getAxiosProxyOptions(),
        });
        logScraperDebug('myntra', 'request-response', {
          status: response.status,
          path: safePath(response.request?.res?.responseUrl || url),
          bytes: typeof response.data === 'string' ? Buffer.byteLength(response.data) : null,
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        return response.data;
      } catch (cause) {
        const status = cause.response?.status;
        logScraperDebug('myntra', 'request-error', {
          status: status || null,
          code: cause.code || null,
          attempt: attempts,
          elapsedMs: Date.now() - startedAt,
        });
        if (attempts < 2 && (!status || status === 429 || status >= 500)) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        const error = new Error(
          status
            ? `Myntra returned HTTP ${status}.`
            : `Could not connect to Myntra${cause.code ? ` (${cause.code})` : ''}.`
        );
        error.status = status === 403 || status === 429 || status >= 500 ? 503 : status || 502;
        error.cause = cause;
        throw error;
      }
    }
  }

  async search(query) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];

    // Myntra expects a hyphenated slug in the path, e.g. /nike-running-shoes
    const slug = normalizedQuery
      .toLowerCase()
      .replace(/['"’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) return [];

    const startedAt = Date.now();
    const html = await this.fetchPage(`${SEARCH_BASE}${encodeURIComponent(slug)}`);
    const pageData = parsePageData(html);
    const products = pageData?.searchData?.results?.products;
    if (!Array.isArray(products)) {
      logScraperDebug('myntra', 'search-data-missing', {
        hasPageData: Boolean(pageData),
        hasSearchData: Boolean(pageData?.searchData),
        htmlBytes: Buffer.byteLength(html),
        elapsedMs: Date.now() - startedAt,
      });
      throw Object.assign(new Error('Myntra did not provide product search data.'), { status: 503 });
    }

    const candidates = products
      .filter((product) => product.productName && product.landingPageUrl)
      .slice(0, 40)
      .map((product) => {
        const productUrl = product.landingPageUrl.startsWith('http')
          ? product.landingPageUrl
          : `${PRODUCT_BASE}/${product.landingPageUrl.replace(/^\/+/, '')}`;

        let availability = 'unknown';
        if (product.outOfStock === true) {
          availability = 'out_of_stock';
        } else if (Array.isArray(product.inventoryInfo) && product.inventoryInfo.length > 0) {
          availability = productAvailability(product.inventoryInfo);
        } else if (product.inventory > 0) {
          availability = 'in_stock';
        } else if (product.price != null && !product.outOfStock) {
          availability = 'in_stock';
        }

        const price = parsePrice(product.price);
        const image = product.searchImage || product.images?.[0]?.src || '';

        return {
          id: product.productId || productUrl,
          name: product.productName,
          brand: product.brand || '',
          model: '',
          category: product.category || product.articleType || '',
          image: image.replace(/^http:\/\//, 'https://'),
          specifications: extractSpecsFromString(product.productName),
          rating: parseRating(product.rating),
          ratingCount: parseCount(product.ratingCount),
          sponsored: false,
          offers: {
            myntra: {
              price,
              mrp: validMrp(product.mrp, price),
              availability,
              url: productUrl,
            },
          },
        };
      });

    // Filter by query relevance so unrelated fashion items don't pollute cross-store results
    const results = candidates.filter((item) => matchScore(normalizedQuery, item.name) >= 0.5);
    logScraperDebug('myntra', 'search-parsed', {
      candidateCount: candidates.length,
      returned: results.length,
      elapsedMs: Date.now() - startedAt,
    });
    return results;
  }

  async extractFromUrl(url) {
    const startedAt = Date.now();
    let html;
    try {
      html = await this.fetchPage(url);
    } catch (err) {
      const fallbackName = productNameFromMyntraUrl(url);
      if (!fallbackName) throw err;
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
        sourceNote: 'Myntra could not be reached. The product name was inferred from the URL; price and stock are unverified.',
      };
    }
    const pageData = parsePageData(html);
    const product = pageData?.pdpData;
    const ldProduct = !product ? parseLdJson(html) : null;
    const metadata = extractProductPageMetadata(html);

    const name = product?.name || ldProduct?.name || metadata?.name || productNameFromMyntraUrl(url);
    if (!name) {
      logScraperDebug('myntra', 'extract-data-missing', {
        hasPageData: Boolean(pageData),
        hasPdpData: Boolean(product),
        hasLdProduct: Boolean(ldProduct),
        htmlBytes: Buffer.byteLength(html),
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }

    const sizes = product?.sizes;
    const hasInventory = Array.isArray(sizes);
    const inventory = hasInventory
      ? sizes.map((size) => ({
          available: size.available,
          inventory: size.sizeSellerData?.reduce(
            (total, seller) => total + Number(seller.sellableInventoryCount || seller.availableCount || 0),
            0
          ),
        }))
      : null;

    // Price extraction: prefer discounted live selling price from sizes/seller/ld+json
    let price = currentPdpPrice(sizes);
    if (price == null && product?.price?.discounted != null) {
      // Only use product.price.discounted if sizes were not explicitly confirmed out of stock
      const allSizesOutOfStock = hasInventory && sizes.every((s) => s.available === false);
      if (!allSizesOutOfStock) {
        price = Number(product.price.discounted);
      }
    }
    if (price == null && product?.selectedSeller?.discountedPrice != null) {
      const allSizesOutOfStock = hasInventory && sizes.every((s) => s.available === false);
      if (!allSizesOutOfStock) {
        price = Number(product.selectedSeller.discountedPrice);
      }
    }
    if (price == null && ldProduct?.offers?.price != null) {
      price = parsePrice(ldProduct.offers.price);
    }
    if (price == null) price = metadata?.price ?? null;
    if (price != null && !Number.isFinite(price)) {
      price = null;
    }

    // Availability extraction
    let availability = 'unknown';
    if (product?.flags?.outOfStock === true || product?.flags?.disableBuyButton === true) {
      availability = 'out_of_stock';
    } else if (hasInventory) {
      availability = productAvailability(inventory);
    } else if (ldProduct?.offers?.availability) {
      availability = detectAvailability(ldProduct.offers.availability);
    } else if (metadata?.availability) {
      availability = metadata.availability;
    }

    // Image extraction: support imageURL (capital URL), secureSrc, and src
    const albumImg = product?.media?.albums?.[0]?.images?.[0];
    let imageUrl =
      albumImg?.imageURL ||
      (albumImg?.secureSrc
        ? albumImg.secureSrc.replace(/h_\(\$height\),q_\(\$qualityPercentage\),w_\(\$width\)\/?/, 'h_1440,q_90,w_1080/')
        : '') ||
      albumImg?.src ||
      albumImg?.imageUrl ||
      product?.media?.albums?.[0]?.images?.[0]?.imageUrl ||
      ldProduct?.image ||
      '';
    if (imageUrl.startsWith('http://')) {
      imageUrl = imageUrl.replace(/^http:\/\//, 'https://');
    }

    // Rich specifications
    const articleAttrs = product?.articleAttributes || {};
    const specs = {
      ...metadata?.specifications,
      ...extractSpecsFromString(name),
      ...(articleAttrs.Type ? { type: articleAttrs.Type } : {}),
      ...(articleAttrs['Sole Material'] ? { soleMaterial: articleAttrs['Sole Material'] } : {}),
      ...(articleAttrs.Materials ? { material: articleAttrs.Materials } : {}),
      ...(articleAttrs.Fabric ? { fabric: articleAttrs.Fabric } : {}),
      ...(articleAttrs.Fit ? { fit: articleAttrs.Fit } : {}),
    };

    const brand =
      product?.brand?.name ||
      ldProduct?.brand?.name ||
      (typeof ldProduct?.brand === 'string' ? ldProduct.brand : '') ||
      name.split(' ')[0] ||
      '';

    const category =
      product?.analytics?.articleType ||
      product?.analytics?.subCategory ||
      product?.category ||
      metadata?.category ||
      '';

    logScraperDebug('myntra', 'extract-parsed', {
      hasPdpData: Boolean(product),
      hasLdProduct: Boolean(ldProduct),
      hasPrice: price != null,
      availability,
      hasImage: Boolean(imageUrl),
      sizeCount: Array.isArray(sizes) ? sizes.length : 0,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      name,
      brand,
      model: '',
      category,
      imageUrl,
      specifications: specs,
      price,
      mrp: validMrp(product?.mrp ?? product?.price?.mrp, price),
      rating: parseRating(product?.ratings?.averageRating),
      ratingCount: parseCount(product?.ratings?.totalCount),
      availability,
      productUrl: url,
      ...(!product && !ldProduct
        ? {
            sourceNote:
              'Myntra did not provide product details. The name was read from the product URL; price and availability could not be verified.',
          }
        : {}),
    };
  }
}

module.exports = MyntraAdapter;
