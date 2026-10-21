const db = require('../config/db');
const BaseAdapter = require('./baseAdapter');
const AmazonInAdapter = require('./amazonAdapter');
const FlipkartAdapter = require('./flipkartAdapter');
const MyntraAdapter = require('./myntraAdapter');

const adapterMap = {
  amazon_in: AmazonInAdapter,
  flipkart: FlipkartAdapter,
  myntra: MyntraAdapter,
};

const FALLBACK_STORES = [
  { id: 1, name: 'Amazon India', slug: 'amazon_in', base_url: 'https://www.amazon.in' },
  { id: 2, name: 'Flipkart', slug: 'flipkart', base_url: 'https://www.flipkart.com' },
  { id: 3, name: 'Myntra', slug: 'myntra', base_url: 'https://www.myntra.com' },
];

let adapters = [];
let storesLoaded = false;

function buildAdapters(stores) {
  return stores
    .filter((store) => store.slug !== 'demo' && adapterMap[store.slug])
    .map((store) => {
      const AdapterClass = adapterMap[store.slug] || BaseAdapter;
      return new AdapterClass(store);
    });
}

async function loadStores() {
  const rows = await db.query(
    `SELECT id, name, slug, base_url, is_active FROM retailers WHERE is_active = 1`
  );
  adapters = buildAdapters(rows.length ? rows : FALLBACK_STORES);
  storesLoaded = true;
  return adapters;
}

function getAdapters() {
  return adapters;
}

function getAdapterBySlug(slug) {
  return adapters.find((a) => a.slug === slug) || null;
}

function getLiveAdapters() {
  return adapters.filter((a) => a.isAvailable());
}

async function ensureLoaded() {
  if (storesLoaded) return;
  try {
    await loadStores();
  } catch {
    adapters = buildAdapters(FALLBACK_STORES);
    storesLoaded = true;
  }
}

module.exports = {
  loadStores,
  getAdapters,
  getAdapterBySlug,
  getLiveAdapters,
  ensureLoaded,
};
