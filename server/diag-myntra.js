const axios = require('axios');

(async () => {
  try {
    const response = await axios.get('https://www.myntra.com/search?q=iphone+15+128gb', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
    });
    const html = response.data;
    const marker = 'window.__myx = ';
    const start = html.indexOf(marker);
    if (start < 0) {
      console.log('No page data found');
      process.exit(0);
    }
    const jsonStart = start + marker.length;
    const jsonEnd = html.indexOf('</script>', jsonStart);
    const data = JSON.parse(html.slice(jsonStart, jsonEnd).trim().replace(/;$/, ''));
    const products = data?.searchData?.results?.products || [];
    console.log('Total products:', products.length);
    console.log('\nFirst 5 products:');
    products.slice(0, 5).forEach((p, i) => {
      console.log(JSON.stringify({
        i,
        productName: p.productName?.slice(0, 80),
        brand: p.brand,
        category: p.category || p.analyticsData?.category || p.subCategory,
        price: p.price,
        mrp: p.mrp,
        rating: p.rating,
      }, null, 2));
    });
    // Check what fields are available
    if (products.length) {
      console.log('\nAvailable product fields:', Object.keys(products[0]));
      const analytics = products[0].analyticsData;
      if (analytics) console.log('analyticsData fields:', Object.keys(analytics));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
