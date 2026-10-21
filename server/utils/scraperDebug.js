const enabled = () => /^(1|true|yes)$/i.test(process.env.SCRAPER_DEBUG || '');

function safePath(value) {
  try {
    const url = new URL(value);
    const path = url.pathname
      .replace(/\/dp\/[A-Z0-9]{10}/i, '/dp/:id')
      .replace(/\/\d+(?=\/buy(?:\/|$))/g, '/:id');
    return `${url.origin}${path}`;
  } catch {
    return 'invalid-url';
  }
}

function safeDiagnosticMessage(value) {
  return String(value).replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safePath(url));
}

function logScraperDebug(store, event, details = {}) {
  if (!enabled()) return;
  console.info(`[scraper-debug:${store}] ${JSON.stringify({ event, ...details })}`);
}

module.exports = { logScraperDebug, safeDiagnosticMessage, safePath };
