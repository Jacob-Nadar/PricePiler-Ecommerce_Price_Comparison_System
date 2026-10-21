const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for dynamic content - try waiting for a price element
    try {
      await page.waitForSelector('[class*="Nx9bqj"], [class*="CEmiEU"], [class*="_30jeq3"]', { timeout: 8000 });
    } catch (e) {
      console.log('Price selector not found after wait');
    }
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      // Check for embedded JSON in scripts
      const scripts = [...document.querySelectorAll('script')]
        .map((s) => s.textContent)
        .filter((t) => t && t.length > 100)
        .filter((t) => t.includes('price') || t.includes('iPhone') || t.includes('product'))
        .slice(0, 3)
        .map((t) => t.slice(0, 300));

      // Check body text for price
      const bodyText = document.body.innerText;
      const priceMatch = bodyText.match(/₹[\d,]+/g);
      const titleMatch = bodyText.match(/Apple iPhone 15[^\n]*/);

      return { scripts, priceMatches: priceMatch?.slice(0, 5), titleMatch: titleMatch?.[0]?.slice(0, 80) };
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
