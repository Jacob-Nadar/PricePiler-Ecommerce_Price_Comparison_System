const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/s?k=iphone+15+128gb', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Get the full structure of the first result card
    const firstCard = await page.$eval('div[data-component-type="s-search-result"]', (el) => {
      const h2 = el.querySelector('h2');
      const h2Outer = h2 ? h2.outerHTML.slice(0, 1000) : 'NO H2';
      // Look for title-like elements
      const titleCandidates = [...el.querySelectorAll('span, div')]
        .filter((s) => {
          const t = s.textContent.trim();
          return t.length > 20 && t.length < 200 && s.children.length === 0;
        })
        .slice(0, 8)
        .map((s) => ({ cls: s.className.slice(0, 50), tag: s.tagName, txt: s.textContent.trim().slice(0, 100) }));
      // Find all links
      const links = [...el.querySelectorAll('a')].map((a) => ({
        href: a.getAttribute('href')?.slice(0, 80),
        cls: a.className.slice(0, 40),
      })).slice(0, 6);
      return { h2Outer, titleCandidates, links };
    });
    console.log('=== AMAZON FIRST CARD STRUCTURE ===');
    console.log(JSON.stringify(firstCard, null, 2));
  } catch (e) {
    console.error('error:', e.message);
  } finally {
    await context.close();
    await closeBrowser();
    process.exit(0);
  }
})();
