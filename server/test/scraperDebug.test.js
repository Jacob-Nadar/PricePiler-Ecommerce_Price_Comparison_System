const test = require('node:test');
const assert = require('node:assert/strict');
const { logScraperDebug, safeDiagnosticMessage, safePath } = require('../utils/scraperDebug');

test('debug URL paths omit query strings and redact product identifiers', () => {
  assert.equal(
    safePath('https://www.amazon.in/dp/B0F46BTPPY/ref=abc?psc=1&token=secret'),
    'https://www.amazon.in/dp/:id/ref=abc'
  );
  assert.equal(
    safePath('https://www.myntra.com/tops/brand/style-name/12345678/buy?utm_source=secret'),
    'https://www.myntra.com/tops/brand/style-name/:id/buy'
  );
});

test('diagnostic error messages strip URL query strings', () => {
  assert.equal(
    safeDiagnosticMessage('Navigation failed at https://www.amazon.in/s?k=private+query&token=secret'),
    'Navigation failed at https://www.amazon.in/s'
  );
});

test('scraper diagnostics are disabled unless explicitly enabled', () => {
  const originalDebug = process.env.SCRAPER_DEBUG;
  const originalInfo = console.info;
  const messages = [];
  console.info = (message) => messages.push(message);

  try {
    delete process.env.SCRAPER_DEBUG;
    logScraperDebug('amazon_in', 'test', { status: 503 });
    assert.equal(messages.length, 0);

    process.env.SCRAPER_DEBUG = 'true';
    logScraperDebug('myntra', 'test', { status: 200 });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /scraper-debug:myntra/);
  } finally {
    console.info = originalInfo;
    if (originalDebug === undefined) delete process.env.SCRAPER_DEBUG;
    else process.env.SCRAPER_DEBUG = originalDebug;
  }
});
