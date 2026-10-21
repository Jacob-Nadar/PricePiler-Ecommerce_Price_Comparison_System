const rateLimit = require('express-rate-limit');

const limiter = (windowMinutes, max, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: message },
  });

const envMax = (name, fallback) => Number(process.env[name]) || fallback;

// General API traffic.
const apiLimiter = limiter(1, envMax('RATE_LIMIT_API_PER_MINUTE', 120), 'Too many requests, please try again later.');

// Password guessing: per IP, on top of the per-account lockout.
const loginLimiter = limiter(15, envMax('RATE_LIMIT_LOGIN_PER_15_MIN', 20), 'Too many login attempts. Please wait a few minutes and try again.');

// Anything that sends an email or checks a code.
const otpLimiter = limiter(15, envMax('RATE_LIMIT_OTP_PER_15_MIN', 15), 'Too many verification requests. Please wait a few minutes and try again.');

// Creating/updating alerts and saved products.
const alertLimiter = limiter(15, envMax('RATE_LIMIT_ALERTS_PER_15_MIN', 120), 'Too many changes in a short time. Please slow down.');

module.exports = { apiLimiter, loginLimiter, otpLimiter, alertLimiter };
