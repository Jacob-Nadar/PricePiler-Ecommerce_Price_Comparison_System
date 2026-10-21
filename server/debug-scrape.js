// Temporary diagnostic script to inspect Amazon & Flipkart search page structure.
const { newPage, closeBrowser } = require('./utils/browser');

async function inspectAmazon() {
  console.log('=== AMAZON ===');
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/s?k=iphone+15', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    console.log('blocked?', html.toLowerCase().includes('captcha') || html.toLowerCase().includes('robot'));
    const count = await page.$$eval('div[data-component-type="s-search-result"]', (els) => els.length);
    console.log('search-result divs:', count);

    if (count > 0) {
      const sample = await page.$$eval('div[data-component-type="s-search-result"]', (els) =>
        els.slice(0, 2).map((el) => {
          const titleEl = el.querySelector('h2 a span') || el.querySelector('h2 a');
          const priceOffscreen = el.querySelector('.a-price .a-offscreen')?.textContent;
          const priceWhole = el.querySelector('.a-price-whole')?.textContent;
          const priceSym = el.querySelector('.a-price-symbol')?.textContent;
          const allPrices = [...el.querySelectorAll('[class*="price"]')].map((p) => ({
            cls: p.className,
            txt: p.textContent.trim().slice(0, 40),
          }));
          return {
            title: titleEl?.textContent?.trim()?.slice(0, 60),
            priceOffscreen,
            priceWhole,
            priceSym,
            allPrices,
          };
        })
      );
      console.log(JSON.stringify(sample, null, 2));
    } else {
      // Dump first 2000 chars of body to understand structure
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
      console.log('BODY TEXT:', bodyText);
    }
  } catch (e) {
    console.error('amazon error:', e.message);
  } finally {
    await context.close().catch(() => {});
  }
}

async function inspectFlipkart() {
  console.log('\n=== FLIPKART ===');
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/search?q=iphone+15', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    console.log('blocked?', html.toLowerCase().includes('captcha'));

    const anchors = await page.$$eval('a[rel="noopener noreferrer"]', (els) => els.length);
    console.log('product anchors:', anchors);

    // Look for any element containing a rupee symbol to find price selectors
    const priceCandidates = await page.evaluate(() => {
      const out = [];
      const els = document.querySelectorAll('div, span');
      for (const el of els) {
        const txt = el.textContent.trim();
        if (txt.startsWith('₹') && txt.length < 20 && el.children.length === 0) {
          out.push({ tag: el.tagName, cls: el.className, txt });
          if (out.length >= 10) break;
        }
      }
      return out;
    });
    console.log('price candidates:', JSON.stringify(priceCandidates, null, 2));

    if (anchors > 0) {
      const sample = await page.$$eval('a[rel="noopener noreferrer"]', (els) =>
        els.slice(0, 2).map((a) => {
          const titleEl = a.querySelector('div._4rR01T, div._3wje9J, .s1Q9rs, .IRpwTa, ._2WkVRV');
          const priceEl = a.querySelector('div._30jeq3, div._30jeq3._1_WHN1, ._30jeq3');
          return {
            title: titleEl?.textContent?.trim()?.slice(0, 60),
            price: priceEl?.textContent,
            href: a.getAttribute('href')?.slice(0, 60),
          };
        })
      );
      console.log('anchor sample:', JSON.stringify(sample, null, 2));
    }
  } catch (e) {
    console.error('flipkart error:', e.message);
  } finally {
    await context.close().catch(() => {});
  }
}

(async () => {
  await inspectAmazon();
  await inspectFlipkart();
  await closeBrowser();
  process.exit(0);
})();
