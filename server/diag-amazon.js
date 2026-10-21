const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/s?k=iphone+15+128gb', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const sample = await page.$$eval('div[data-component-type="s-search-result"]', (els) =>
      els.slice(0, 3).map((el) => {
        const allSpans = [...el.querySelectorAll('h2 span')].map((s) => ({
          cls: s.className,
          txt: s.textContent.trim().slice(0, 80),
        }));
        const h2a = el.querySelector('h2 a');
        const h2aHtml = h2a ? h2a.innerHTML.slice(0, 400) : '';
        const wholePrice = el.querySelector('.a-price-whole')?.textContent;
        const offscreen = el.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent;
        const asin = el.getAttribute('data-asin');
        return { asin, allSpans, h2aHtml, wholePrice, offscreen };
      })
    );
    console.log(JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error(e.message);
  } finally {
    await context.close();
    await closeBrowser();
    process.exit(0);
  }
})();
