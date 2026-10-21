const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/dp/B0DGJHBX5Y', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const title = document.getElementById('productTitle')?.textContent?.trim() || '';
      // Find ALL elements with ₹ symbol
      const rupeeEls = [...document.querySelectorAll('*')]
        .filter((el) => {
          const t = el.textContent.trim();
          return el.children.length === 0 && t.includes('₹') && t.length < 30;
        })
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          cls: el.className?.toString().slice(0, 60),
          txt: el.textContent.trim(),
        }))
        .slice(0, 15);
      // Find price-related containers
      const priceContainers = [...document.querySelectorAll('[id*="price"], [class*="price"], [id*="corePrice"], [id*="apex"]')]
        .map((el) => ({
          tag: el.tagName,
          id: el.id,
          cls: el.className?.toString().slice(0, 60),
          txt: el.textContent.trim().slice(0, 60),
        }))
        .filter((p) => p.txt.includes('₹'))
        .slice(0, 10);
      const availEl = document.getElementById('availability') || document.getElementById('outOfStock');
      const availText = availEl ? availEl.textContent.trim().slice(0, 100) : 'NO AVAIL EL';
      return { title, rupeeEls, priceContainers, availText };
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
