const test = require('node:test');
const assert = require('node:assert/strict');
const { getScraperProxy, getAxiosProxyOptions } = require('../utils/scraperProxy');

test('proxy is disabled when no proxy URL is configured', () => {
  const original = process.env.SCRAPER_PROXY_URL;
  try {
    delete process.env.SCRAPER_PROXY_URL;
    assert.equal(getScraperProxy(), null);
    assert.deepEqual(getAxiosProxyOptions(), {});
  } finally {
    if (original === undefined) delete process.env.SCRAPER_PROXY_URL;
    else process.env.SCRAPER_PROXY_URL = original;
  }
});

test('HTTP proxy is configured for Playwright and Axios without exposing credentials in the server', () => {
  const original = process.env.SCRAPER_PROXY_URL;
  try {
    process.env.SCRAPER_PROXY_URL = 'http://user:p%40ss@proxy.example.com:8080';
    assert.deepEqual(getScraperProxy(), {
      server: 'http://proxy.example.com:8080',
      username: 'user',
      password: 'p@ss',
    });
    assert.deepEqual(getAxiosProxyOptions(), {
      proxy: {
        protocol: 'http',
        host: 'proxy.example.com',
        port: 8080,
        auth: { username: 'user', password: 'p@ss' },
      },
    });
  } finally {
    if (original === undefined) delete process.env.SCRAPER_PROXY_URL;
    else process.env.SCRAPER_PROXY_URL = original;
  }
});

test('invalid or unsupported proxy URLs fail with a clear configuration error', () => {
  const original = process.env.SCRAPER_PROXY_URL;
  try {
    process.env.SCRAPER_PROXY_URL = 'socks5://proxy.example.com:1080';
    assert.throws(getScraperProxy, /HTTP or HTTPS proxy/);
    process.env.SCRAPER_PROXY_URL = 'not a proxy URL';
    assert.throws(getScraperProxy, /valid HTTP or HTTPS proxy URL/);
  } finally {
    if (original === undefined) delete process.env.SCRAPER_PROXY_URL;
    else process.env.SCRAPER_PROXY_URL = original;
  }
});
