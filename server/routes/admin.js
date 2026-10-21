// Admin panel API. Every route requires a signed-in user with role "admin".
const express = require('express');
const admin = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { alertLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(requireAdmin);

router.get('/overview', admin.overview);

router.get('/users', admin.listUsers);
router.get('/users/:id', admin.getUser);
router.patch('/users/:id', alertLimiter, admin.updateUser);
router.delete('/users/:id', alertLimiter, admin.deleteUser);

router.get('/alerts/price', admin.listPriceAlerts);
router.patch('/alerts/price/:id', alertLimiter, admin.updateAlert('price'));
router.delete('/alerts/price/:id', alertLimiter, admin.deleteAlert('price'));
router.get('/alerts/stock', admin.listStockAlerts);
router.patch('/alerts/stock/:id', alertLimiter, admin.updateAlert('stock'));
router.delete('/alerts/stock/:id', alertLimiter, admin.deleteAlert('stock'));

router.get('/listings', admin.listListings);
router.post('/listings/:id/check', alertLimiter, admin.checkListing);

router.get('/notifications', admin.listNotifications);
router.get('/audit', admin.listAudit);

module.exports = router;
