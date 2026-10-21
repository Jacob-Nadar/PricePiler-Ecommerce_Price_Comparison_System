const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProductPageMetadata } = require('../utils/productPageMetadata');

test('extracts generic product metadata and offer from JSON-LD graphs', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'BreadcrumbList', itemListElement: [] },
            {
              '@type': 'Product',
              name: 'Cotton bedsheet set',
              category: 'Home & Kitchen',
              brand: { '@type': 'Brand', name: 'HouseBrand' },
              color: 'Ivory',
              additionalProperty: [{ '@type': 'PropertyValue', name: 'Thread Count', value: '300' }],
              image: ['https://images.example/bedsheet.jpg'],
              offers: {
                '@type': 'Offer',
                price: '1299',
                availability: 'https://schema.org/InStock',
              },
            },
          ],
        })}
      </script>
    </head></html>
  `;

  assert.deepEqual(extractProductPageMetadata(html), {
    name: 'Cotton bedsheet set',
    brand: 'HouseBrand',
    category: 'Home & Kitchen',
    imageUrl: 'https://images.example/bedsheet.jpg',
    price: 1299,
    availability: 'in_stock',
    specifications: { color: 'Ivory', thread_count: '300' },
    description: '',
  });
});

test('extracts title and image from open graph when product JSON-LD is unavailable', () => {
  const metadata = extractProductPageMetadata(`
    <html><head>
      <meta property="og:title" content="Running Shoes">
      <meta property="og:image" content="https://images.example/shoes.jpg">
    </head></html>
  `);

  assert.equal(metadata.name, 'Running Shoes');
  assert.equal(metadata.imageUrl, 'https://images.example/shoes.jpg');
  assert.equal(metadata.price, null);
  assert.equal(metadata.availability, 'unknown');
});
