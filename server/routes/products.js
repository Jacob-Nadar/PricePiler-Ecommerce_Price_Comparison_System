const express = require('express');
const products = require('../controllers/productsController');
const {
  validateSearchQuery,
  validateProductSearchBody,
  validateExtractUrl,
  validateCompareBody,
} = require('../middleware/validate');

const router = express.Router();

router.get('/search', validateSearchQuery, products.searchProducts);
router.post('/search', validateProductSearchBody, products.searchProductsPost);
router.post('/extract-url', validateExtractUrl, products.extractUrl);
router.post('/compare', validateCompareBody, products.compareProduct);
router.post('/history', products.getOfferHistory);
router.get('/:id', products.getProduct);
router.get('/:id/offers', products.getProductOffers);
router.get('/:id/price-history', products.getPriceHistory);

module.exports = router;
