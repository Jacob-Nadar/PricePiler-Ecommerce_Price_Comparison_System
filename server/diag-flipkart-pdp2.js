const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      // Find the element containing the product title text
      const titleText = 'Apple iPhone 15';
      const titleEls = [...document.querySelectorAll('span, div, h1, h2')]
        .filter((el) => {
          const t = el.textContent.trim();
          return el.children.length === 0 && t.includes(titleText) && t.length < 100;
        })
        .map((el) => ({ tag: el.tagName, cls: el.className?.toString().slice(0, 50), txt: el.textContent.trim().slice(0, 80) }))
        .slice(0, 5);

      // Find all ₹ price elements
      const priceEls = [...document.querySelectorAll('span, div')]
        .filter((el) => {
          const t = el.textContent.trim();
          return el.children.length === 0 && t.startsWith('₹') && t.length < 20;
        })
        .map((el) => ({ tag: el.tagName, cls: el.className?.toString().slice(0, 50), txt: t = el.textContent.trim() }))
        .slice(0, 10);

      // Check meta tags
      const ogPrice = document.querySelector('meta[property="product:price:amount"]')?.content;
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
      const ogImage = document.querySelector('meta[property="og:image"]')?.content;

      // Availability
      const bodyText = document.body.innerText.slice(0, 3000).toLowerCase();
      const hasAddToCart = bodyText.includes('add to cart');
      const hasBuyNow = bodyText.includes('buy now');
      const hasNotify = bodyText.includes('notify me');
      const hasOutOfStock = bodyText.includes('out of stock') || bodyText.includes('sold out');

      return { titleEls, priceEls, ogPrice, ogTitle, ogImage, hasAddToCart, hasBuyNow, hasNotify, hasOutOfStock };
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
