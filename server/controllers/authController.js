const { asyncHandler } = require('../middleware/errorHandler');
const { setSessionCookie, clearSessionCookie } = require('../middleware/auth');
const auth = require('../services/authService');
const mailer = require('../services/email/mailer');

const OTP_PURPOSES = new Set(['register', 'login', 'reset']);
const str = (value, max = 300) => (typeof value === 'string' ? value.slice(0, max) : '');

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ success: false, error, ...extra });
}

// Turns service errors (AuthError / OtpError) into JSON responses.
function handle(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err.status && err.status < 500 && err.message) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return fail(res, err.status, err.message, {
          ...(err.field ? { field: err.field } : {}),
          ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
          ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
          ...(err.attemptsLeft != null ? { attemptsLeft: err.attemptsLeft } : {}),
        });
      }
      if (err.status === 502) return fail(res, 502, err.message);
      throw err;
    }
  });
}

async function startSession(req, res, user) {
  const session = await auth.createSession(user.id, req.get('user-agent'));
  setSessionCookie(res, session);
}

// Tells the UI whether the code really went out by email or was only printed to
// the server console (development without SMTP credentials).
const deliveryNote = (delivery) =>
  delivery === 'logged'
    ? { deliveryMode: 'console', notice: 'Email is not configured on the server, so the code was printed in the server console.' }
    : { deliveryMode: 'email' };

const registerStart = handle(async (req, res) => {
  const body = {
    fullName: str(req.body?.fullName, 200),
    email: str(req.body?.email, 300),
    password: str(req.body?.password, 200),
    confirmPassword: str(req.body?.confirmPassword, 200),
  };
  const errors = auth.validateRegistration(body);
  if (Object.keys(errors).length) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });
  const result = await auth.startRegistration(body);
  res.status(202).json({
    success: true,
    data: { email: result.email, expiresInSeconds: result.expiresInSeconds, resendInSeconds: result.resendInSeconds, ...deliveryNote(result.delivery) },
  });
});

const registerVerify = handle(async (req, res) => {
  const user = await auth.completeRegistration(str(req.body?.email), str(req.body?.code, 10));
  await startSession(req, res, user);
  res.status(201).json({ success: true, data: { user } });
});

const resendOtp = handle(async (req, res) => {
  const purpose = str(req.body?.purpose, 20);
  if (!OTP_PURPOSES.has(purpose)) return fail(res, 400, 'Invalid request.');
  const emailError = auth.validateEmail(auth.normalizeEmail(str(req.body?.email)));
  if (emailError) return fail(res, 400, emailError);
  const result = await auth.resendOtp(str(req.body?.email), purpose);
  res.json({ success: true, data: { expiresInSeconds: result.expiresInSeconds, resendInSeconds: result.resendInSeconds, ...deliveryNote(result.delivery) } });
});

const login = handle(async (req, res) => {
  const email = str(req.body?.email);
  const password = str(req.body?.password, 200);
  if (!email || !password) return fail(res, 400, 'Email and password are required.');
  const result = await auth.login(email, password);
  if (result.otpRequired) {
    return res.json({
      success: true,
      data: { otpRequired: true, email: result.email, expiresInSeconds: result.expiresInSeconds, resendInSeconds: result.resendInSeconds, ...deliveryNote(result.delivery) },
    });
  }
  await startSession(req, res, result.user);
  res.json({ success: true, data: { otpRequired: false, user: result.user } });
});

const loginVerify = handle(async (req, res) => {
  const user = await auth.completeLoginOtp(str(req.body?.email), str(req.body?.code, 10));
  await startSession(req, res, user);
  res.json({ success: true, data: { user } });
});

const logout = handle(async (req, res) => {
  await auth.destroySession(req.cookies?.pp_session);
  clearSessionCookie(res);
  res.json({ success: true, data: { loggedOut: true } });
});

const me = handle(async (req, res) => {
  res.json({ success: true, data: { user: req.user, emailMode: mailer.mode() } });
});

const forgotPassword = handle(async (req, res) => {
  const email = auth.normalizeEmail(str(req.body?.email));
  const emailError = auth.validateEmail(email);
  if (emailError) return fail(res, 400, emailError);
  const result = await auth.requestPasswordReset(email);
  // Same response whether or not the account exists.
  res.json({
    success: true,
    data: {
      message: 'If an account exists for this email, a reset code has been sent.',
      expiresInSeconds: result.expiresInSeconds,
      resendInSeconds: result.resendInSeconds,
      ...(result.delivery ? deliveryNote(result.delivery) : {}),
    },
  });
});

const resetPassword = handle(async (req, res) => {
  const password = str(req.body?.password, 200);
  const passwordError = auth.validatePassword(password);
  if (passwordError) return fail(res, 400, passwordError, { fields: { password: passwordError } });
  if (password !== str(req.body?.confirmPassword, 200)) {
    return fail(res, 400, 'Passwords do not match.', { fields: { confirmPassword: 'Passwords do not match.' } });
  }
  await auth.resetPassword(str(req.body?.email), str(req.body?.code, 10), password);
  clearSessionCookie(res);
  res.json({ success: true, data: { message: 'Your password has been reset. Please log in with your new password.' } });
});

const updateProfile = handle(async (req, res) => {
  const changes = {};
  if (req.body?.fullName !== undefined) changes.fullName = str(req.body.fullName, 200);
  if (req.body?.loginOtpEnabled !== undefined) changes.loginOtpEnabled = Boolean(req.body.loginOtpEnabled);
  const user = await auth.updateProfile(req.user.id, changes);
  res.json({ success: true, data: { user } });
});

module.exports = {
  registerStart,
  registerVerify,
  resendOtp,
  login,
  loginVerify,
  logout,
  me,
  forgotPassword,
  resetPassword,
  updateProfile,
};
