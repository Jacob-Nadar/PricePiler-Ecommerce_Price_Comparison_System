// Debug: inspect Flipkart product card structure around a price element.
const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/search?q=iphone+15', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      // Find the first element with a ₹ price that is a leaf
      const priceEls = [...document.querySelectorAll('div, span')].filter((el) => {
        const t = el.textContent.trim();
        return t.startsWith('₹') && t.length < 20 && el.children.length === 0;
      });

      if (priceEls.length === 0) return { error: 'no price elements' };

      // Walk up from the first price element to find the card container
      let card = priceEls[0];
      let cardHtml = '';
      for (let i = 0; i < 15; i++) {
        const parent = card.parentElement;
        if (!parent) break;
        // Check if this container has a product link
        const link = parent.querySelector('a[href*="/p/"]');
        if (link) {
          card = parent;
          break;
        }
        card = parent;
      }

      // Now extract from the card
      const link = card.querySelector('a[href*="/p/"]');
      const img = card.querySelector('img');
      const titleCandidates = [...card.querySelectorAll('div, span, a')]
        .filter((el) => el.children.length === 0 && el.textContent.trim().length > 10 && !el.textContent.trim().startsWith('₹'))
        .map((el) => ({ cls: el.className.slice(0, 40), txt: el.textContent.trim().slice(0, 80) }))
        .slice(0, 8);

      return {
        price: priceEls[0].textContent,
        cardClass: card.className.slice(0, 60),
        href: link?.getAttribute('href')?.slice(0, 80),
        img: img?.getAttribute('src')?.slice(0, 80),
        titleCandidates,
      };
    });

    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e.message);
  } finally {
    await context.close().catch(() => {});
    await closeBrowser();
    process.exit(0);
  }
})();
