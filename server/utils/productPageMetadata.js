const cheerio = require('cheerio');
const { parsePrice, detectAvailability } = require('./scraperUtils');

function isProductNode(value) {
  if (!value || typeof value !== 'object') return false;
  const type = value['@type'];
  return (Array.isArray(type) ? type : [type]).some(
    (entry) => String(entry || '').toLowerCase() === 'product'
  );
}

function findProductNode(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProductNode(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (isProductNode(value)) return value;
  for (const entry of Object.values(value)) {
    const found = findProductNode(entry);
    if (found) return found;
  }
  return null;
}

function firstText(value) {
  if (Array.isArray(value)) return firstText(value[0]);
  if (value && typeof value === 'object') return firstText(value.name || value.value);
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function imageUrl(value) {
  if (Array.isArray(value)) return imageUrl(value[0]);
  if (value && typeof value === 'object') return imageUrl(value.url || value.contentUrl);
  return typeof value === 'string' ? value : '';
}

function offerDetails(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue;
    const price = parsePrice(offer.price ?? offer.lowPrice);
    if (price != null) {
      return { price, availability: detectAvailability(offer.availability || '') };
    }
  }
  return { price: null, availability: 'unknown' };
}

function extractProductPageMetadata(html) {
  if (typeof html !== 'string' || !html) return null;
  const $ = cheerio.load(html);
  let product = null;

  $('script[type="application/ld+json"]').each((_, script) => {
    if (product) return;
    try {
      product = findProductNode(JSON.parse($(script).contents().text()));
    } catch {
      // Stores may include unrelated malformed JSON-LD; continue to other metadata.
    }
  });

  const title =
    firstText(product?.name) ||
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    '';
  if (!title) return null;

  const structuredOffers = offerDetails(product?.offers);
  const metaPrice = parsePrice(
    $('meta[property="product:price:amount"]').attr('content') ||
      $('[itemprop="price"]').attr('content') ||
      $('[itemprop="price"]').first().text()
  );
  const metaAvailability =
    $('[itemprop="availability"]').attr('href') ||
    $('[itemprop="availability"]').attr('content') ||
    '';
  const image =
    imageUrl(product?.image) ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';
  const brand = firstText(product?.brand);
  const category = firstText(product?.category);
  const availability =
    structuredOffers.availability !== 'unknown'
      ? structuredOffers.availability
      : detectAvailability(metaAvailability);
  const specifications = {};
  for (const key of ['color', 'size', 'material', 'pattern', 'weight']) {
    const value = firstText(product?.[key]);
    if (value) specifications[key] = value;
  }
  for (const property of Array.isArray(product?.additionalProperty) ? product.additionalProperty : []) {
    const key = String(property?.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const value = firstText(property?.value);
    if (key && value) specifications[key] = value;
  }

  return {
    name: title,
    brand,
    category,
    imageUrl: image,
    price: structuredOffers.price ?? metaPrice,
    availability,
    specifications,
    description: firstText(product?.description),
  };
}

module.exports = { extractProductPageMetadata };
