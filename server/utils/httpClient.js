const axios = require('axios');
const config = require('../config');
const { getAxiosProxyOptions } = require('./scraperProxy');

const ALLOWED_DOMAINS = [
  'amazon.in',
  'www.amazon.in',
  'amzn.in',
  'amzn.to',
  'flipkart.com',
  'www.flipkart.com',
  'dl.flipkart.com',
  'myntra.com',
  'www.myntra.com',
  'm.myntra.com',
];

const SUPPORTED_HOSTS = ['amazon.in', 'amzn.in', 'amzn.to', 'flipkart.com', 'myntra.com'];

function isValidUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseStoreFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (
      host === 'amazon.in' ||
      host.endsWith('.amazon.in') ||
      host === 'amzn.in' ||
      host === 'amzn.to' ||
      host.endsWith('.amzn.in') ||
      host.endsWith('.amzn.to')
    ) {
      return 'amazon_in';
    }
    if (host === 'flipkart.com' || host.endsWith('.flipkart.com')) return 'flipkart';
    if (host === 'myntra.com' || host.endsWith('.myntra.com')) return 'myntra';
    return null;
  } catch {
    return null;
  }
}

function isAllowedRedirect(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

async function resolveStoreUrl(url) {
  if (!isValidUrl(url)) return url;
  try {
    const resp = await axios.head(url, {
      maxRedirects: 5,
      timeout: 8000,
      ...getAxiosProxyOptions(),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    const finalUrl = resp.request?.res?.responseUrl || resp.config?.url || url;
    return isAllowedRedirect(finalUrl) ? finalUrl : url;
  } catch {
    return url;
  }
}

const axiosInstance = axios.create({
  timeout: config.requestTimeoutMs,
  maxRedirects: 3,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json',
  },
  validateStatus: (status) => status >= 200 && status < 400,
  ...getAxiosProxyOptions(),
});

module.exports = {
  axiosInstance,
  ALLOWED_DOMAINS,
  SUPPORTED_HOSTS,
  isValidUrl,
  parseStoreFromUrl,
  isAllowedRedirect,
  resolveStoreUrl,
};
