const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for content to render - look for any text containing "iPhone"
    await page.waitForFunction(() => {
      return document.body.innerText.includes('iPhone') || document.body.innerText.includes('₹');
    }, { timeout: 10000 }).catch(() => {});

    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      // Find price
      const prices = bodyText.match(/₹[\d,]+/g) || [];
      // Find title line
      const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
      const titleLine = lines.find(l => l.includes('iPhone 15') && l.length < 80);
      // Check for availability
      const hasAddToCart = bodyText.toLowerCase().includes('add to cart');
      const hasBuyNow = bodyText.toLowerCase().includes('buy now');
      const hasNotify = bodyText.toLowerCase().includes('notify me');
      // Get og:title
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
      return { prices: prices.slice(0, 5), titleLine, hasAddToCart, hasBuyNow, hasNotify, ogTitle, ogImage };
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
