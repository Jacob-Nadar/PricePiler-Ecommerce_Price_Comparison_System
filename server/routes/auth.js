const express = require('express');
const auth = require('../controllers/authController');
const { requireAuth, requireDatabase } = require('../middleware/auth');
const { loginLimiter, otpLimiter, alertLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(requireDatabase);

router.post('/register', otpLimiter, auth.registerStart);
router.post('/register/verify', otpLimiter, auth.registerVerify);
router.post('/otp/resend', otpLimiter, auth.resendOtp);
router.post('/login', loginLimiter, auth.login);
router.post('/login/verify', otpLimiter, auth.loginVerify);
router.post('/password/forgot', otpLimiter, auth.forgotPassword);
router.post('/password/reset', otpLimiter, auth.resetPassword);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);
router.patch('/me', requireAuth, alertLimiter, auth.updateProfile);

module.exports = router;
