const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const title = document.getElementById('productTitle')?.textContent?.trim() || '';
      // Find ALL price elements on the page
      const allPriceEls = [...document.querySelectorAll('.a-price, [class*="price"], [id*="price"]')]
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          cls: el.className.slice(0, 60),
          txt: el.textContent.trim().slice(0, 50),
        }))
        .filter((p) => p.txt.includes('₹') || p.txt.includes('Rs'))
        .slice(0, 15);
      const availEl = document.getElementById('availability') || document.getElementById('outOfStock');
      const availText = availEl ? availEl.textContent.trim().slice(0, 100) : 'NO AVAIL EL';
      const addToCart = Boolean(document.getElementById('add-to-cart-button'));
      const buyNow = Boolean(document.getElementById('buy-now-button'));
      return { title, allPriceEls, availText, addToCart, buyNow };
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
