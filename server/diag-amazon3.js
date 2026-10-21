const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/s?k=iphone+15+128gb', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const sample = await page.$$eval('div[data-component-type="s-search-result"]', (els) =>
      els.slice(0, 6).map((el) => {
        const asin = el.getAttribute('data-asin');
        // Brand from h2
        const brand = el.querySelector('h2 span.a-color-base')?.textContent?.trim() || '';
        // Try to find the title link - look for anchor with line-clamp or the one containing the title span
        const titleLink = el.querySelector('a[class*="s-line-clamp-3"]') || el.querySelector('h2 a') || el.querySelector('a[href*="/dp/"]');
        const titleFromLink = titleLink ? titleLink.textContent.trim().slice(0, 120) : '';
        const href = titleLink ? titleLink.getAttribute('href') : '';
        // Also try the generic title span (leaf, > 20 chars, not ad text)
        const genericTitle = [...el.querySelectorAll('span, div')]
          .filter((s) => {
            const t = s.textContent.trim();
            return s.children.length === 0 && t.length > 20 && t.length < 200 &&
              !t.includes('ad based') && !t.includes('Sponsored') && !t.startsWith('₹') &&
              !t.includes('EMI') && !t.includes('Save extra') && !t.includes('Festival');
          })
          .map((s) => s.textContent.trim().slice(0, 100));
        const price = el.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent || '';
        return { asin, brand, titleFromLink, href: href?.slice(0, 70), genericTitle: genericTitle[0] || '', price };
      })
    );
    console.log(JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error('error:', e.message);
  } finally {
    await context.close();
    await closeBrowser();
    process.exit(0);
  }
})();
