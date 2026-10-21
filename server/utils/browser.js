// Playwright browser pool: a single shared browser instance with isolated
// pages/contexts per scrape request. Designed for Amazon/Flipkart live scraping.
const path = require('path');
const { getScraperProxy } = require('./scraperProxy');

// Use a project-local browser cache so installs don't depend on the global
// AppData location (which may be restricted in sandboxed environments).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '..', '.playwright-browsers');
}

const { chromium } = require('playwright');

let browser = null;
let launching = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;

  launching = (async () => {
    try {
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
      const proxy = getScraperProxy();
      browser = await chromium.launch({
        headless: true,
        ...(proxy ? { proxy } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1366,768',
        ],
      });
      return browser;
    } finally {
      launching = null;
    }
  })();

  return await launching;
}

// Cap concurrently open scraping pages so bursts (category browsing fans out to
// several queries x stores) queue up instead of overloading the shared browser.
const MAX_OPEN_PAGES = Math.max(1, Number(process.env.SCRAPER_MAX_PAGES) || 4);
let openPages = 0;
const pageWaiters = [];

async function acquirePageSlot() {
  if (openPages < MAX_OPEN_PAGES) {
    openPages++;
    return;
  }
  await new Promise((resolve) => pageWaiters.push(resolve));
}

function releasePageSlot() {
  const next = pageWaiters.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else openPages--;
}

async function newPage() {
  await acquirePageSlot();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releasePageSlot();
  };
  try {
    const opened = await openPage();
    opened.context.once('close', release);
    return opened;
  } catch (err) {
    release();
    throw err;
  }
}

async function openPage() {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: false,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Anti-bot evasions
  await context.addInitScript(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;

    // Emulate Chrome object
    window.chrome = {
      runtime: {},
      app: {},
      csi: () => {},
      loadTimes: () => {},
    };

    // Emulate realistic plugins list
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ],
    });

    // Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en-US', 'en'] });

    // Permissions mock
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
  });

  let page;
  try {
    page = await context.newPage();
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
  await page.route('**/*', (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();

    // Block heavy media and tracking ad networks
    if (
      ['image', 'media', 'font'].includes(resourceType) ||
      url.includes('google-analytics.com') ||
      url.includes('doubleclick.net') ||
      url.includes('amazon-adsystem.com') ||
      url.includes('criteo.com')
    ) {
      return route.abort();
    }
    return route.continue();
  });

  return { page, context };
}

async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (_) {
      /* ignore */
    }
    browser = null;
  }
}

module.exports = { getBrowser, newPage, closeBrowser };
