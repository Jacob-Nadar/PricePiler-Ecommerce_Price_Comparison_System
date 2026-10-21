const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      // Check availability section
      const avail = document.querySelector('#availability')?.innerText?.trim() || '';
      const availSpan = document.querySelector('#availability span')?.className || '';
      // Price containers
      const priceContainers = ['corePrice_feature_div', 'apex_offerDisplay_desktop', 'corePriceDisplay_desktop_feature_div', 'price'];
      const prices = {};
      for (const id of priceContainers) {
        const el = document.getElementById(id);
        if (el) {
          const offscreen = el.querySelector('.apex-pricetopay-value .a-offscreen, .a-price:not(.a-text-price) .a-offscreen');
          prices[id] = offscreen?.textContent || 'NO_PRICE_ELEMENT';
        }
      }
      // Also check for any price text on the page
      const allPriceEls = [...document.querySelectorAll('.a-price .a-offscreen')].map(e => e.textContent).slice(0, 5);
      return { avail, availSpan, prices, allPriceEls };
    });
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await context.close();
    await closeBrowser();
    process.exit(0);
  }
})();
