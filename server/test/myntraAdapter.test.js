const test = require('node:test');
const assert = require('node:assert/strict');
const MyntraAdapter = require('../adapters/myntraAdapter');

function htmlWithPageData(pageData) {
  return `<html><script>window.__myx = ${JSON.stringify(pageData)};</script></html>`;
}

function createAdapter(pageData) {
  const adapter = new MyntraAdapter({ id: 3, name: 'Myntra', slug: 'myntra' });
  adapter.fetchPage = async () => htmlWithPageData(pageData);
  return adapter;
}

test('Myntra search extracts current listing price and stock from page data', async () => {
  const adapter = createAdapter({
    searchData: {
      results: {
        products: [{
          productId: 12345,
          productName: 'Roadster Men Blue Jeans',
          brand: 'Roadster',
          landingPageUrl: 'men-jeans/roadster/product/12345/buy',
          price: 1299,
          searchImage: 'https://example.com/jeans.jpg',
          inventoryInfo: [{ available: true, inventory: 4 }],
        }],
      },
    },
  });

  const [item] = await adapter.search('Roadster Men Blue Jeans');
  assert.equal(item.name, 'Roadster Men Blue Jeans');
  assert.equal(item.offers.myntra.price, 1299);
  assert.equal(item.offers.myntra.availability, 'in_stock');
  assert.equal(item.offers.myntra.url, 'https://www.myntra.com/men-jeans/roadster/product/12345/buy');
});

test('Myntra product extraction uses the live discounted price, not MRP', async () => {
  const adapter = createAdapter({
    pdpData: {
      name: 'Roadster Men Blue Jeans',
      brand: { name: 'Roadster' },
      mrp: 1999,
      sizes: [
        { available: true, sizeSellerData: [{ discountedPrice: 1299, sellableInventoryCount: 3 }] },
        { available: true, sizeSellerData: [{ discountedPrice: 1399, sellableInventoryCount: 2 }] },
      ],
      media: { albums: [{ images: [{ imageUrl: 'https://example.com/jeans.jpg' }] }] },
    },
  });

  const product = await adapter.extractFromUrl(
    'https://www.myntra.com/men-jeans/roadster/product/12345/buy'
  );
  assert.equal(product.price, 1299);
  assert.equal(product.availability, 'in_stock');
  assert.equal(product.imageUrl, 'https://example.com/jeans.jpg');
});

test('Myntra extraction does not substitute MRP for missing live price', async () => {
  const adapter = createAdapter({
    pdpData: {
      name: 'Roadster Men Blue Jeans',
      mrp: 1999,
      sizes: [{ available: false, sizeSellerData: [] }],
    },
  });

  const product = await adapter.extractFromUrl(
    'https://www.myntra.com/men-jeans/roadster/product/12345/buy'
  );
  assert.equal(product.price, null);
  assert.equal(product.availability, 'out_of_stock');
});

test('Myntra extraction extracts imageURL with capital URL and rich attributes', async () => {
  const adapter = createAdapter({
    pdpData: {
      name: 'Puma Smashic Comfort Casual Sneakers',
      brand: { name: 'Puma' },
      analytics: { articleType: 'Casual Shoes' },
      articleAttributes: {
        Type: 'Sneakers',
        'Sole Material': 'Rubber',
        Materials: 'Synthetic',
      },
      sizes: [
        { available: true, sizeSellerData: [{ discountedPrice: 1664, sellableInventoryCount: 5 }] },
      ],
      media: {
        albums: [
          {
            images: [
              {
                imageURL: 'http://assets.myntassets.com/assets/images/sample.jpg',
                secureSrc: 'https://assets.myntassets.com/h_($height),q_($qualityPercentage),w_($width)/v1/sample.jpg',
              },
            ],
          },
        ],
      },
    },
  });

  const product = await adapter.extractFromUrl(
    'https://www.myntra.com/casual-shoes/puma/puma-smashic-comfort-casual-sneakers/21767244/buy'
  );
  assert.equal(product.name, 'Puma Smashic Comfort Casual Sneakers');
  assert.equal(product.category, 'Casual Shoes');
  assert.equal(product.imageUrl, 'https://assets.myntassets.com/assets/images/sample.jpg');
  assert.equal(product.specifications.type, 'Sneakers');
  assert.equal(product.specifications.soleMaterial, 'Rubber');
  assert.equal(product.specifications.material, 'Synthetic');
  assert.equal(product.price, 1664);
  assert.equal(product.availability, 'in_stock');
});

test('Myntra extraction falls back to application/ld+json when page data is absent', async () => {
  const adapter = new MyntraAdapter({ id: 3, name: 'Myntra', slug: 'myntra' });
  adapter.fetchPage = async () => `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Fallback Roadster T-Shirt",
            "image": "https://assets.myntassets.com/fallback.jpg",
            "brand": { "@type": "Brand", "name": "Roadster" },
            "offers": {
              "@type": "Offer",
              "price": "599",
              "availability": "https://schema.org/InStock"
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const product = await adapter.extractFromUrl(
    'https://www.myntra.com/tshirts/roadster/fallback-tshirt/99999/buy'
  );
  assert.equal(product.name, 'Fallback Roadster T-Shirt');
  assert.equal(product.brand, 'Roadster');
  assert.equal(product.price, 599);
  assert.equal(product.availability, 'in_stock');
  assert.equal(product.imageUrl, 'https://assets.myntassets.com/fallback.jpg');
});

test('Myntra extraction returns a clearly unverified product when the store request fails', async () => {
  const adapter = new MyntraAdapter({ id: 3, name: 'Myntra', slug: 'myntra' });
  adapter.fetchPage = async () => {
    throw Object.assign(new Error('Myntra returned HTTP 503.'), { status: 503 });
  };

  const product = await adapter.extractFromUrl(
    'https://www.myntra.com/casual-shoes/puma/puma-smashic/21767244/buy'
  );
  assert.match(product.name, /puma smashic/i);
  assert.equal(product.price, null);
  assert.equal(product.availability, 'unknown');
  assert.match(product.sourceNote, /unverified/i);
});
