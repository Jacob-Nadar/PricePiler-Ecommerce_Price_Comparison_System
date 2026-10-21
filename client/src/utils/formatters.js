export function formatPriceINR(price) {
  if (price == null || isNaN(Number(price))) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(price));
}

export function formatCompact(value) {
  if (value == null || isNaN(Number(value))) return '';
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
}

export function availabilityMeta(status) {
  switch (status) {
    case 'in_stock':
      return {
        label: 'In stock',
        className: 'bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500',
        dot: 'bg-deal-500',
      };
    case 'out_of_stock':
      return {
        label: 'Out of stock',
        className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
        dot: 'bg-rose-500',
      };
    default:
      return {
        label: 'Stock unknown',
        className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
        dot: 'bg-slate-400',
      };
  }
}

// Brand colours used only as small identifying accents next to store names.
export const STORES = {
  amazon_in: { name: 'Amazon India', short: 'Amazon', color: '#FF9900', initial: 'a' },
  flipkart: { name: 'Flipkart', short: 'Flipkart', color: '#2874F0', initial: 'f' },
  myntra: { name: 'Myntra', short: 'Myntra', color: '#FF3F6C', initial: 'm' },
};

export function storeMeta(slug, fallbackName = '') {
  return STORES[slug] || { name: fallbackName || slug, short: fallbackName || slug, color: '#64748b', initial: (fallbackName || slug || '?')[0] };
}

export function shortStoreName(name) {
  return Object.values(STORES).find((store) => store.name === name)?.short || name;
}

export function formatTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return rtf.format(-seconds, 'second');
}

const SPEC_LABELS = {
  ram: 'RAM',
  storage: 'Storage',
  ssd: 'SSD',
  size: 'Screen size',
  quantity: 'Quantity',
  packOf: 'Pack of',
  soleMaterial: 'Sole material',
};

// Specs worth showing to people; the free-text "(…)" variant duplicates the title.
export function specsList(specs) {
  if (!specs) return [];
  return Object.entries(specs)
    .filter(([key, value]) => key !== 'variant' && value != null && String(value).trim() !== '')
    .map(([key, value]) => ({
      key,
      label: SPEC_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      value: key === 'quantity' ? formatQuantity(value) : String(value),
    }));
}

function formatQuantity(value) {
  const match = String(value).match(/^([\d.]+)\s*(g|ml)$/);
  if (!match) return String(value);
  const amount = Number(match[1]);
  if (amount >= 1000) return `${Math.round((amount / 1000) * 100) / 100} ${match[2] === 'g' ? 'kg' : 'L'}`;
  return `${amount} ${match[2]}`;
}

// The cheapest offer per store, in the order stores should be displayed.
export function bestOfferPerStore(offers = []) {
  const byStore = new Map();
  for (const offer of offers) {
    const current = byStore.get(offer.storeSlug);
    const rank = (o) => (o.availability === 'in_stock' ? 0 : o.availability === 'unknown' ? 1 : 2);
    if (
      !current ||
      rank(offer) < rank(current) ||
      (rank(offer) === rank(current) && (offer.price ?? Infinity) < (current.price ?? Infinity))
    ) {
      byStore.set(offer.storeSlug, offer);
    }
  }
  return byStore;
}

// Stable id for a product across sessions (watchlist key).
export function productId(product) {
  const urls = (product.offers || []).map((o) => o.productUrl).filter(Boolean).sort();
  const basis = `${(product.name || '').toLowerCase()}|${urls[0] || ''}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i++) hash = (Math.imul(31, hash) + basis.charCodeAt(i)) | 0;
  return `p${(hash >>> 0).toString(36)}`;
}

export function detailsPath(product) {
  const params = new URLSearchParams({ name: product.name || '' });
  if (product.brand) params.set('brand', product.brand);
  return `/product/live?${params.toString()}`;
}
