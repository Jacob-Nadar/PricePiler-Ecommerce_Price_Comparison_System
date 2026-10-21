// Everything here belongs to the signed-in user.
const express = require('express');
const account = require('../controllers/accountController');
const { requireAuth } = require('../middleware/auth');
const { alertLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(requireAuth);

router.get('/dashboard', account.dashboard);

router.get('/saved', account.listSaved);
router.post('/saved', alertLimiter, account.saveProduct);
router.delete('/saved/:productId', alertLimiter, account.unsaveProduct);

router.get('/alerts/price', account.listPriceAlerts);
router.post('/alerts/price', alertLimiter, account.createPriceAlert);
router.patch('/alerts/price/:id', alertLimiter, account.updatePriceAlert);
router.delete('/alerts/price/:id', alertLimiter, account.deletePriceAlert);

router.get('/alerts/stock', account.listStockAlerts);
router.post('/alerts/stock', alertLimiter, account.createStockAlert);
router.patch('/alerts/stock/:id', alertLimiter, account.updateStockAlert);
router.delete('/alerts/stock/:id', alertLimiter, account.deleteStockAlert);

router.get('/notifications', account.listNotifications);

module.exports = router;
