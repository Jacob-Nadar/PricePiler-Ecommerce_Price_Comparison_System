const config = require('../config');
const db = require('../config/db');
const authService = require('../services/authService');

const COOKIE = config.auth.sessionCookieName;

function cookieOptions(expiresAt) {
  return {
    httpOnly: true, // not readable from JavaScript
    secure: config.auth.cookieSecure,
    sameSite: 'lax', // not sent on cross-site POSTs
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

function setSessionCookie(res, session) {
  res.cookie(COOKIE, session.token, cookieOptions(session.expiresAt));
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

// Resolves the signed-in user (if any) onto req.user. Never fails the request.
async function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token || !db.isAvailable()) return next();
  try {
    req.user = await authService.getSessionUser(token);
  } catch {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!db.isAvailable()) {
    return res.status(503).json({ success: false, error: 'Accounts are unavailable because the database is not connected.' });
  }
  if (!req.user) return res.status(401).json({ success: false, error: 'Please log in to continue.', code: 'AUTH_REQUIRED' });
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
    }
    next();
  });
}

// Accounts, alerts and history need MySQL; fail clearly instead of with a stack trace.
function requireDatabase(_req, res, next) {
  if (!db.isAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'This feature needs the MySQL database, which is not connected. Check DB_* in server/.env.',
    });
  }
  next();
}

// CSRF defence in depth: state-changing requests must come from this app's own
// origin (or a configured CLIENT_ORIGIN). Browsers always send Origin on POST/PATCH/DELETE.
function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients (curl, tests)
  const allowed = config.clientOrigin.split(',').map((o) => o.trim());
  let sameHost = false;
  try {
    sameHost = new URL(origin).host === req.get('host');
  } catch {
    sameHost = false;
  }
  if (sameHost || allowed.includes(origin)) return next();
  return res.status(403).json({ success: false, error: 'Request origin not allowed.' });
}

module.exports = { attachUser, requireAuth, requireAdmin, requireDatabase, checkOrigin, setSessionCookie, clearSessionCookie };
