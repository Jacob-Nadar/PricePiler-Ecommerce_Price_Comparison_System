const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const title = document.title;
      // Try various title selectors
      const titleCandidates = [
        { sel: 'span.VU-ZEz', txt: document.querySelector('span.VU-ZEz')?.textContent?.trim() },
        { sel: 'h1.yhB1nd span', txt: document.querySelector('h1.yhB1nd span')?.textContent?.trim() },
        { sel: '.B_NuCI', txt: document.querySelector('.B_NuCI')?.textContent?.trim() },
        { sel: 'h1', txt: document.querySelector('h1')?.textContent?.trim() },
        { sel: '[class*="VU-ZEz"]', txt: document.querySelector('[class*="VU-ZEz"]')?.textContent?.trim() },
        { sel: 'meta[property="og:title"]', txt: document.querySelector('meta[property="og:title"]')?.content },
      ];
      // Find all elements that look like a title (large text, > 10 chars)
      const largeTexts = [...document.querySelectorAll('span, div, h1')]
        .filter((el) => {
          const t = el.textContent.trim();
          const style = window.getComputedStyle(el);
          const fontSize = parseFloat(style.fontSize);
          return el.children.length === 0 && t.length > 10 && t.length < 150 && fontSize >= 16;
        })
        .map((el) => ({ cls: el.className?.toString().slice(0, 40), size: parseFloat(window.getComputedStyle(el).fontSize), txt: el.textContent.trim().slice(0, 80) }))
        .slice(0, 8);
      // Price candidates
      const priceCandidates = [...document.querySelectorAll('[class*="Nx9bqj"], [class*="CEmiEU"], [class*="_30jeq3"]')]
        .map((el) => ({ cls: el.className?.toString().slice(0, 40), txt: el.textContent.trim().slice(0, 20) }))
        .slice(0, 6);
      const structuredPrice = document.querySelector('meta[property="product:price:amount"]')?.content;
      return { title, titleCandidates, largeTexts, priceCandidates, structuredPrice };
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
