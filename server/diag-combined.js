const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.amazon.in/s?k=iphone+15+128gb', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const sample = await page.$$eval('div[data-component-type="s-search-result"]', (els) =>
      els.slice(0, 3).map((el) => {
        const h2 = el.querySelector('h2');
        const h2Text = h2 ? h2.textContent.trim().slice(0, 120) : '';
        const linkEl = el.querySelector('h2 a') || el.querySelector('a[href*="/dp/"]') || el.querySelector('a[href*="/gp/"]');
        const href = linkEl ? linkEl.getAttribute('href') : '';
        const wholePrice = el.querySelector('.a-price-whole')?.textContent;
        const offscreen = el.querySelector('.a-price:not(.a-text-price) .a-offscreen')?.textContent;
        return { h2Text, href: href?.slice(0, 80), wholePrice, offscreen };
      })
    );
    console.log('=== AMAZON ===');
    console.log(JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error('amazon error:', e.message);
  } finally {
    await context.close();
  }

  // Flipkart availability check
  try {
    const { page: page2, context: ctx2 } = await newPage();
    try {
      await page2.goto('https://www.flipkart.com/search?q=iphone+15+128gb', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page2.waitForTimeout(2500);
      const data = await page2.evaluate(() => {
        const links = [...document.querySelectorAll('a[href*="/p/"]')];
        const seen = new Set();
        const out = [];
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (seen.has(href)) continue;
          seen.add(href);
          // walk up to card
          let card = link;
          for (let i = 0; i < 8; i++) {
            const parent = card.parentElement;
            if (!parent) break;
            const productHrefs = new Set([...parent.querySelectorAll('a[href*="/p/"]')].map((a) => a.getAttribute('href')));
            if (productHrefs.size > 1) { card = parent; continue; }
            const priceLeaf = [...parent.querySelectorAll('div, span')].find((el) => {
              const t = el.textContent.trim();
              return t.startsWith('₹') && t.length < 20 && el.children.length === 0 && !t.includes('%') && !t.toLowerCase().includes('off');
            });
            if (priceLeaf) { card = parent; break; }
            card = parent;
          }
          const cardText = (card.innerText || '').slice(0, 400);
          const lower = cardText.toLowerCase();
          out.push({
            title: link.textContent.trim().slice(0, 60),
            hasAddToCart: lower.includes('add to cart'),
            hasInStock: lower.includes('in stock'),
            hasBuyNow: lower.includes('buy now'),
            hasNotify: lower.includes('notify me'),
            text: cardText.slice(0, 200),
          });
          if (out.length >= 3) break;
        }
        return out;
      });
      console.log('\n=== FLIPKART AVAILABILITY ===');
      console.log(JSON.stringify(data, null, 2));
    } finally {
      await ctx2.close();
    }
  } catch (e) {
    console.error('flipkart error:', e.message);
  }

  await closeBrowser();
  process.exit(0);
})();
