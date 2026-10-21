const { normalizeText, extractSpecsFromString, specsFingerprint } = require('../utils/productUtils');

class BaseAdapter {
  constructor(store) {
    this.store = store; // { id, name, slug, base_url }
  }

  get slug() {
    return this.store.slug;
  }

  isAvailable() {
    return false;
  }

  async search(_query, _options = {}) {
    throw new Error('search() not implemented');
  }

  async extractFromUrl(_url) {
    throw new Error('extractFromUrl() not implemented');
  }

  normalizeOffer(raw) {
    const specs =
      raw.specifications && typeof raw.specifications === 'object'
        ? raw.specifications
        : extractSpecsFromString(raw.title || raw.name || '');
    return {
      storeId: this.store.id,
      storeSlug: this.store.slug,
      storeName: this.store.name,
      externalId: raw.externalId || raw.id || null,
      title: raw.title || raw.name || '',
      productUrl: raw.url || raw.productUrl || raw.link || '',
      imageUrl: raw.image || raw.imageUrl || raw.thumbnail || '',
      price: raw.price != null && !isNaN(Number(raw.price)) ? Number(raw.price) : null,
      currency: raw.currency || 'INR',
      availability: raw.availability || 'unknown',
      specifications: specs,
      specsFingerprint: specsFingerprint(specs),
      brand: raw.brand || '',
      model: raw.model || '',
    };
  }

  normalizeProduct(raw) {
    const specs =
      raw.specifications && typeof raw.specifications === 'object'
        ? raw.specifications
        : extractSpecsFromString(raw.title || raw.name || '');
    return {
      name: raw.name || raw.title || '',
      normalizedName: normalizeText(raw.name || raw.title || ''),
      brand: raw.brand || '',
      model: raw.model || '',
      category: raw.category || '',
      imageUrl: raw.image || raw.imageUrl || '',
      specifications: specs,
    };
  }
}

module.exports = BaseAdapter;
