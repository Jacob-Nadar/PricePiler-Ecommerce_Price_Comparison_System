const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      // All meta tags
      const metas = [...document.querySelectorAll('meta')].map((m) => ({
        prop: m.getAttribute('property') || m.getAttribute('name') || '',
        content: m.getAttribute('content')?.slice(0, 80) || '',
      })).filter((m) => m.prop && m.content).slice(0, 20);

      // Try to find title with a broader search
      const allText = [...document.querySelectorAll('*')]
        .filter((el) => el.children.length === 0)
        .map((el) => el.textContent.trim())
        .filter((t) => t.length > 10 && t.length < 100 && (t.includes('iPhone') || t.startsWith('₹')))
        .slice(0, 10);

      return { metas, allText };
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
