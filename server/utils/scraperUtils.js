// Shared helpers for Playwright-based store scraping.

// Parse an Indian price string like "₹79,990", "Rs. 79990", "79900", "₹79,900.00", "₹1,299 - ₹1,499"
function parsePrice(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;

  // If a range is given (e.g. "₹1,299 - ₹1,499"), pick the lower starting price
  const rangePart = str.split(/[-–—]/)[0] || str;

  // Remove currency symbols, commas, spaces
  const cleaned = rangePart.replace(/[₹$€£,\s]/g, '').replace(/[^0-9.]/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = Number(match[1]);
  return isFinite(num) ? Math.round(num * 100) / 100 : null;
}

function productNameFromUrl(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    const dpIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === 'dp' || segment.toLowerCase() === 'product'
    );
    if (dpIndex !== -1) {
      if (dpIndex > 0) {
        const candidate = segments[dpIndex - 1];
        if (candidate && !['gp', 'dp', 'product'].includes(candidate.toLowerCase())) {
          return decodeURIComponent(candidate)
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
      if (segments[dpIndex + 1] && /^[A-Z0-9]{10}$/i.test(segments[dpIndex + 1])) {
        return segments[dpIndex + 1].toUpperCase();
      }
    }
    return '';
  } catch {
    return '';
  }
}

function productNameFromMyntraUrl(value) {
  try {
    const segments = new URL(value).pathname.split('/').filter(Boolean);
    // Find numeric product ID in the path (e.g. .../product-name/21767244/buy or .../21767244)
    const numericIdIndex = segments.findIndex((segment) => /^\d{5,}$/.test(segment));
    if (numericIdIndex >= 1) {
      return decodeURIComponent(segments[numericIdIndex - 1])
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return '';
  } catch {
    return '';
  }
}

function productNameFromFlipkartUrl(value) {
  try {
    const segments = new URL(value).pathname.split('/').filter(Boolean);
    const productSegment = segments.findIndex((segment) => segment.toLowerCase() === 'p');
    if (productSegment <= 0) return '';
    return decodeURIComponent(segments[productSegment - 1])
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

// Determine availability from a text snippet
function detectAvailability(text) {
  if (!text) return 'unknown';
  // Strip embedded JSON like {"isInternal":false,"unavailableReason":null} that Amazon/Myntra embed in tags
  const cleaned = String(text)
    .replace(/\{[\s\S]*?\}/g, ' ')
    .toLowerCase()
    .replace(/[-_]+/g, ' ');

  if (
    cleaned.includes('outofstock') ||
    cleaned.includes('not in stock') ||
    cleaned.includes('not available') ||
    cleaned.includes('currently unavailable') ||
    cleaned.includes('out of stock') ||
    cleaned.includes('temporarily out of stock') ||
    /\bunavailable\b/.test(cleaned) ||
    cleaned.includes('sold out') ||
    cleaned.includes('no stock') ||
    cleaned.includes('notify me') ||
    cleaned.includes('coming soon') ||
    cleaned.includes('currently not available') ||
    cleaned.includes('schema.org/outofstock')
  ) {
    return 'out_of_stock';
  }
  if (
    cleaned.includes('instock') ||
    cleaned.includes('in stock') ||
    cleaned.includes('add to cart') ||
    cleaned.includes('add to bag') ||
    cleaned.includes('buy now') ||
    /\bonly\s+\d+\s+left\b/.test(cleaned) ||
    cleaned.includes('free delivery') ||
    cleaned.includes('get it by') ||
    cleaned.includes('usually dispatched') ||
    cleaned.includes('schema.org/instock')
  ) {
    return 'in_stock';
  }
  return 'unknown';
}

// Returns true if the page appears to be a bot / captcha / sign-in wall.
function isBlockedPage(title, bodyText = '', url = '') {
  const t = String(title || '').toLowerCase();
  const b = String(bodyText || '').toLowerCase().slice(0, 3000);
  const u = String(url || '').toLowerCase();

  // Check URL patterns
  if (
    u.includes('validatecaptcha') ||
    u.includes('/errors/500') ||
    u.includes('/errors/validatecaptcha')
  ) {
    return true;
  }

  // Check title
  if (
    t.includes('robot check') ||
    t.includes('captcha') ||
    t.includes('verify your identity') ||
    t.includes('amazon captcha') ||
    t.includes('sorry! something went wrong') ||
    t.includes('automated access')
  ) {
    return true;
  }

  // Check the first part of visible body text for block indicators
  if (
    b.includes('enter the characters you see') ||
    b.includes('type the characters') ||
    b.includes('enter the characters below') ||
    b.includes('sorry, we just need to make sure') ||
    b.includes('automated access to our service') ||
    b.includes('to discuss automated access to amazon data') ||
    b.includes('bot detection') ||
    b.includes('access denied') ||
    b.includes('please verify you are a human')
  ) {
    return true;
  }
  return false;
}

// Store search cards prepend badges and deal text to the product title
// (e.g. "Sponsored Ad - ", "You pay ₹76,249", "Only 2 left in stock.").
const TITLE_NOISE_PATTERNS = [
  /^sponsored(?:\s+ad)?\s*[-–:]?\s*/i,
  /^you\s+pay\s+₹?\s*[\d,]+(?:\.\d+)?\s*/i,
  /^only\s+\d+\s+left\s+in\s+stock(?:\s*[-–]\s*order\s+soon)?[.!:]?\s*/i,
  /^no\s+featured\s+offers\s+available\s*/i,
  /^(?:best\s*seller|bestseller|amazon'?s\s+choice|limited\s+time\s+deal|new\s+launch|trending)\s*/i,
  /^currently\s+unavailable\.?\s*/i,
];

function cleanListingTitle(value) {
  let title = String(value || '').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed && title) {
    changed = false;
    for (const pattern of TITLE_NOISE_PATTERNS) {
      const next = title.replace(pattern, '');
      if (next !== title) {
        title = next.trim();
        changed = true;
      }
    }
  }
  return title.replace(/\s*(?:\.\.\.|…)$/, '').trim();
}

// Text that store cards render in title-like positions but that is never a product name.
function isNonTitleText(value) {
  const t = String(value || '').trim().toLowerCase();
  return (
    !t ||
    /^(add to compare|compare|sponsored|bestseller|currently unavailable|sold out|coming soon|notify me|hot deal|trending|new|ad)$/.test(t) ||
    /^[\d,.]+\s*(ratings?|reviews?)$/.test(t) ||
    /^\d+%\s*off$/.test(t) ||
    /^(upto|up to)\b/.test(t) ||
    t.startsWith('₹')
  );
}

// "4.3 out of 5 stars" / "4.3" -> 4.3
function parseRating(value) {
  const match = String(value ?? '').match(/(\d(?:\.\d)?)/);
  if (!match) return null;
  const rating = Number(match[1]);
  return rating > 0 && rating <= 5 ? rating : null;
}

// "2,49,256 Ratings" / "(1.2K)" / "972" -> integer
function parseCount(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kKmMlL])?/);
  if (!match) return null;
  const multiplier = { k: 1e3, m: 1e6, l: 1e5 }[String(match[2] || '').toLowerCase()] || 1;
  const count = Math.round(Number(match[1]) * multiplier);
  return Number.isFinite(count) ? count : null;
}

// Only keep a list price when it is a real markdown from the selling price.
function validMrp(mrp, price) {
  const value = parsePrice(mrp);
  return value != null && price != null && value > price ? value : null;
}

module.exports = {
  cleanListingTitle,
  isNonTitleText,
  parseRating,
  parseCount,
  validMrp,
  parsePrice,
  productNameFromUrl,
  productNameFromMyntraUrl,
  productNameFromFlipkartUrl,
  detectAvailability,
  isBlockedPage,
};
