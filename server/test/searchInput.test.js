const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateProductSearchBody,
  validateSearchQuery,
} = require('../middleware/validate');
const productService = require('../services/productService');
const productsController = require('../controllers/productsController');

test('category-only GET search validates without a request body', () => {
  let validationError;
  validateSearchQuery(
    { query: { category: 'Mobiles' }, body: undefined },
    {},
    (error) => {
      validationError = error;
    }
  );
  assert.equal(validationError, undefined);
});

test('product search accepts brand, category, and string specifications', () => {
  const req = {
    body: {
      name: 'Phone',
      brand: 'Acme',
      category: 'Mobiles',
      specifications: { ram: '8GB', storage: '256GB' },
    },
  };
  let validationError;
  validateProductSearchBody(req, {}, (error) => {
    validationError = error;
  });

  assert.equal(validationError, undefined);
  assert.deepEqual(req.body.specifications, { ram: '8GB', storage: '256GB' });
});

test('invalid specifications return a client error instead of reaching search logic', () => {
  const req = { body: { name: 'Phone', specifications: ['8GB'] } };
  let validationError;
  validateProductSearchBody(req, {}, (error) => {
    validationError = error;
  });
  assert.equal(validationError.status, 400);
});

test('category-only search reaches the service without throwing on an absent body', async () => {
  const originalSearch = productService.searchProducts;
  const originalCategorySearch = productService.searchCategoryProducts;
  const originalRecord = productService.recordSearch;
  let searchedQuery;
  productService.searchProducts = async (query) => {
    searchedQuery = query;
    return { results: [], storeStatus: [] };
  };
  productService.searchCategoryProducts = async (category) => {
    searchedQuery = category;
    return { results: [], storeStatus: [] };
  };
  productService.recordSearch = async () => {};

  try {
    await new Promise((resolve, reject) => {
      productsController.searchProducts(
        { query: { category: 'Mobiles' }, body: undefined },
        { json: resolve },
        reject
      );
    });
    assert.equal(searchedQuery, 'Mobiles');
  } finally {
    productService.searchProducts = originalSearch;
    productService.searchCategoryProducts = originalCategorySearch;
    productService.recordSearch = originalRecord;
  }
});
