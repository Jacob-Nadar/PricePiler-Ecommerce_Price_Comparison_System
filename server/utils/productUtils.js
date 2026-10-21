function normalizeText(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function extractSpecsFromString(text) {
  if (!text) return {};
  const lower = String(text).toLowerCase();
  const specs = {};

  const ramMatch = lower.match(/(\d+)\s*gb\s*(?:ram|ddr\d?)/);
  if (ramMatch) specs.ram = `${ramMatch[1]}GB`;

  const storageMatch = lower.match(/(\d+)\s*(gb|tb)\s*(?:storage|rom|ssd|internal|memory)/);
  if (storageMatch) {
    specs.storage = `${storageMatch[1]}${storageMatch[2].toUpperCase()}`;
  } else if (ramMatch) {
    const capacitiesAfterRam = [...lower.slice(ramMatch.index + ramMatch[0].length).matchAll(/(\d+)\s*(gb|tb)\b/g)];
    if (capacitiesAfterRam.length > 0) {
      specs.storage = `${capacitiesAfterRam[0][1]}${capacitiesAfterRam[0][2].toUpperCase()}`;
    }
  }

  // Handle common smartphone formats like:
  // "Apple iPhone 15 (128 GB)"
  // "OnePlus 12 (16GB, 512GB)"
  // "Samsung Galaxy S24 (8GB, 256GB)"
  if (!specs.storage || !specs.ram) {
    const allCapacities = [...lower.matchAll(/\b(\d+)\s*(gb|tb)\b/g)].map((m) => ({
      val: parseInt(m[1], 10),
      unit: m[2].toUpperCase(),
      formatted: `${m[1]}${m[2].toUpperCase()}`,
      index: m.index,
    }));

    if (allCapacities.length >= 2 && !specs.ram && !specs.storage) {
      // e.g. 16GB, 512GB -> first is RAM (<=32), second is storage (>=32 or TB)
      if (allCapacities[0].val <= 32 && (allCapacities[1].val >= 32 || allCapacities[1].unit === 'TB')) {
        specs.ram = allCapacities[0].formatted;
        specs.storage = allCapacities[1].formatted;
      }
    } else if (allCapacities.length === 1 && !specs.storage) {
      const cap = allCapacities[0];
      // On devices: 32GB, 64GB, 128GB, 256GB, 512GB, 1TB is storage
      if (cap.unit === 'TB' || cap.val >= 32) {
        specs.storage = cap.formatted;
      }
    }
  }

  const ssdMatch = lower.match(/(\d+)\s*(?:gb|tb)\s*ssd/);
  if (ssdMatch) specs.ssd = `${ssdMatch[1]}${ssdMatch[0].includes('tb') ? 'TB' : 'GB'} SSD`;

  const sizeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:inch|")/);
  if (sizeMatch) specs.size = `${sizeMatch[1]} inch`;

  const variantMatch = lower.match(/\(([^)]+)\)/);
  if (variantMatch) specs.variant = variantMatch[1];

  // Pack size distinguishes grocery/personal-care variants ("400g" vs "2.5 kg").
  // Normalised to grams / millilitres so "1kg" and "1000 g" compare equal.
  const quantityMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|g|gm|gms|grams?|ml|l|ltr|litres?|liters?)\b/
  );
  if (quantityMatch) {
    const amount = Number(quantityMatch[1]);
    const unit = quantityMatch[2];
    const isWeight = /^(kg|kgs|kilogram|g|gm|gms|gram)/.test(unit);
    const factor = /^(kg|kgs|kilogram|l|ltr|litre|liter)/.test(unit) ? 1000 : 1;
    const base = Math.round(amount * factor * 100) / 100;
    if (base > 0) specs.quantity = `${base} ${isWeight ? 'g' : 'ml'}`;
  }

  const packMatch = lower.match(/\b(?:pack|set)\s+of\s+(\d+)\b|\b(\d+)\s*(?:pcs|pieces|pack)\b/);
  if (packMatch) {
    const count = Number(packMatch[1] || packMatch[2]);
    if (count > 1) specs.packOf = String(count);
  }

  return specs;
}

function specsFingerprint(specs) {
  if (!specs) return '';
  const keys = ['ram', 'storage', 'ssd', 'size', 'variant', 'color', 'processor', 'generation'];
  return keys
    .map((k) => (specs[k] ? `${k}=${normalizeText(specs[k])}` : ''))
    .filter(Boolean)
    .join('|');
}

function productKey({ brand = '', model = '', specs = {} }) {
  const fp = specsFingerprint(specs);
  return `${normalizeText(brand)}::${normalizeText(model)}::${fp}`;
}

function availabilityLabel(status) {
  switch (status) {
    case 'in_stock':
      return 'In Stock';
    case 'out_of_stock':
      return 'Out of Stock';
    default:
      return 'Unknown';
  }
}

function formatPrice(price, currency = 'INR') {
  if (price == null || isNaN(Number(price))) return null;
  const value = Number(price);
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }
  return `${value.toFixed(2)} ${currency}`;
}

module.exports = {
  normalizeText,
  tokenize,
  extractSpecsFromString,
  specsFingerprint,
  productKey,
  availabilityLabel,
  formatPrice,
};
