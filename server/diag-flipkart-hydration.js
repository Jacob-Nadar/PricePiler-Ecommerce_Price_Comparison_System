const { newPage, closeBrowser } = require('./utils/browser');

(async () => {
  const { page, context } = await newPage();
  try {
    await page.goto('https://www.flipkart.com/apple-iphone-15-blue-128-gb/p/itm387c20f1f5347?pid=MOBHQV9Y', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const data = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')];
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.includes('__staticRouterHydrationData')) {
          // Extract the JSON.parse("...") content
          const match = txt.match(/JSON\.parse\("(.+?)"\)\s*;/s);
          if (match) {
            try {
              const json = JSON.parse('"' + match[1] + '"');
              const parsed = JSON.parse(json);
              // Navigate the structure to find product info
              const loaderData = parsed?.loaderData || {};
              return Object.keys(loaderData).slice(0, 10);
            } catch (e) {
              return { parseError: e.message, sample: match[1].slice(0, 200) };
            }
          }
        }
      }
      return { error: 'no hydration data found' };
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
