// Accounts, passwords and sessions.
//  - Passwords: bcrypt (pure-JS bcryptjs, so no native build tools are needed).
//  - Accounts are created only after the registration OTP is verified.
//  - Sessions: a random 256-bit token in an httpOnly cookie; only its SHA-256 is stored.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const config = require('../config');
const otp = require('./otpService');
const notifications = require('./notificationService');
const { otpEmail } = require('./email/templates');
const logger = require('../utils/logger');

class AuthError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// A hash of a random password; comparing against it keeps "unknown email" as slow as "wrong password".
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(email) {
  if (!email) return 'Email address is required.';
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  const domains = config.auth.allowedEmailDomains;
  if (domains.length && !domains.includes(email.split('@')[1])) {
    return `Please use a ${domains.map((d) => `@${d}`).join(' or ')} address.`;
  }
  return null;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  // bcrypt only uses the first 72 bytes.
  if (Buffer.byteLength(value) > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must include at least one letter and one number.';
  return null;
}

function validateFullName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2) return 'Please enter your full name.';
  if (value.length > 100) return 'Name must be at most 100 characters.';
  if (!/^[\p{L}\p{M}' .-]+$/u.test(value)) return 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
  return null;
}

// Field-level validation shared by the controller and unit tests.
function validateRegistration({ fullName, email, password, confirmPassword }) {
  const errors = {};
  const nameError = validateFullName(fullName);
  if (nameError) errors.fullName = nameError;
  const emailError = validateEmail(normalizeEmail(email));
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your password.';
  else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  return errors;
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    emailVerifiedAt: row.email_verified_at,
    loginOtpEnabled: Boolean(row.login_otp_enabled),
    role: row.role || 'user',
    isAdmin: row.role === 'admin',
    createdAt: row.created_at,
  };
}

// Admins can see every customer's data, so they always need the email code.
const needsLoginOtp = (user) => Boolean(user.login_otp_enabled) || user.role === 'admin';

async function findUserByEmail(email) {
  const [row] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  return row || null;
}

async function sendOtpEmail(email, purpose, code, name, userId) {
  const outcome = await notifications.send({
    to: email,
    userId,
    type: `otp_${purpose}`,
    email: {
      ...otpEmail({ purpose, code, minutes: config.auth.otpTtlMinutes, name }),
      consolePreview: `Verification code (${purpose}): ${code}`,
    },
  });
  if (outcome.status === 'failed') {
    throw new AuthError('We could not send the verification email. Please try again in a moment.', 502);
  }
  return outcome.status;
}

async function startRegistration({ fullName, email, password }) {
  const normalized = normalizeEmail(email);
  if (await findUserByEmail(normalized)) {
    throw new AuthError('An account with this email already exists. Please log in instead.', 409, { field: 'email' });
  }
  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const name = String(fullName).trim().replace(/\s+/g, ' ');
  const issued = await otp.issue(normalized, 'register', { fullName: name, passwordHash });
  const delivery = await sendOtpEmail(normalized, 'register', issued.code, name);
  logger.info('auth.register_started', { email: logger.maskEmail(normalized) });
  return { email: normalized, expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds, delivery };
}

async function completeRegistration(email, code) {
  const normalized = normalizeEmail(email);
  const pending = await otp.verify(normalized, 'register', code);
  if (!pending.passwordHash || !pending.fullName) {
    throw new AuthError('Registration details expired. Please register again.', 400);
  }
  try {
    const result = await db.execute(
      `INSERT INTO users (full_name, email, password_hash, email_verified_at, last_login_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [pending.fullName, normalized, pending.passwordHash]
    );
    logger.info('auth.registered', { userId: result.insertId });
    const [row] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    return publicUser(row);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new AuthError('An account with this email already exists. Please log in instead.', 409);
    }
    throw err;
  }
}

async function resendOtp(email, purpose) {
  const normalized = normalizeEmail(email);
  if (purpose === 'register') {
    if (await findUserByEmail(normalized)) throw new AuthError('This email is already registered. Please log in.', 409);
    const current = await otp.status(normalized, 'register');
    if (!current) throw new AuthError('Your registration session expired. Please register again.', 400);
    const issued = await otp.issue(normalized, 'register');
    const delivery = await sendOtpEmail(normalized, 'register', issued.code);
    return { expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds, delivery };
  }
  const user = await findUserByEmail(normalized);
  // For login/reset, never reveal whether the email exists.
  if (!user) return { expiresInSeconds: config.auth.otpTtlMinutes * 60, resendInSeconds: config.auth.otpResendCooldownSeconds };
  const issued = await otp.issue(normalized, purpose);
  const delivery = await sendOtpEmail(normalized, purpose, issued.code, user.full_name, user.id);
  return { expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds, delivery };
}

async function login(email, password) {
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(normalized);
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    throw new AuthError(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`, 423);
  }
  const ok = await bcrypt.compare(String(password || ''), user?.password_hash || DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const failures = user.failed_login_attempts + 1;
      const lock = failures >= config.auth.maxFailedLogins;
      await db.execute(
        `UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`,
        [lock ? 0 : failures, lock ? new Date(Date.now() + config.auth.lockoutMinutes * 60_000) : null, user.id]
      );
      logger.warn('auth.login_failed', { userId: user.id, locked: lock });
    }
    throw new AuthError('Invalid email or password.', 401);
  }
  await db.execute('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  // Checked only after the password, so it does not reveal which emails exist.
  if (user.disabled_at) {
    throw new AuthError('This account has been disabled. Please contact support.', 403);
  }

  if (needsLoginOtp(user)) {
    const issued = await otp.issue(normalized, 'login');
    const delivery = await sendOtpEmail(normalized, 'login', issued.code, user.full_name, user.id);
    return { otpRequired: true, email: normalized, expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds, delivery };
  }
  await db.execute('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
  logger.info('auth.login', { userId: user.id });
  return { otpRequired: false, user: publicUser(user) };
}

async function completeLoginOtp(email, code) {
  const normalized = normalizeEmail(email);
  await otp.verify(normalized, 'login', code);
  const user = await findUserByEmail(normalized);
  if (!user) throw new AuthError('Account not found.', 404);
  if (user.disabled_at) throw new AuthError('This account has been disabled. Please contact support.', 403);
  await db.execute('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
  logger.info('auth.login', { userId: user.id, secondFactor: true });
  return publicUser(user);
}

async function requestPasswordReset(email) {
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(normalized);
  if (!user) {
    logger.info('auth.reset_requested_unknown', { email: logger.maskEmail(normalized) });
    return { expiresInSeconds: config.auth.otpTtlMinutes * 60, resendInSeconds: config.auth.otpResendCooldownSeconds };
  }
  const issued = await otp.issue(normalized, 'reset');
  const delivery = await sendOtpEmail(normalized, 'reset', issued.code, user.full_name, user.id);
  return { expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds, delivery };
}

async function resetPassword(email, code, password) {
  const normalized = normalizeEmail(email);
  await otp.verify(normalized, 'reset', code);
  const user = await findUserByEmail(normalized);
  if (!user) throw new AuthError('Account not found.', 404);
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  await db.transaction(async (conn) => {
    await conn.execute(
      'UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [hash, user.id]
    );
    // Signing out everywhere is the expected effect of a password reset.
    await conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
  });
  logger.info('auth.password_reset', { userId: user.id });
}

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlDays * 86_400_000);
  await db.execute(
    'INSERT INTO user_sessions (user_id, token_hash, user_agent, expires_at, last_seen_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
    [userId, tokenHash(token), String(userAgent || '').slice(0, 255), expiresAt]
  );
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const [row] = await db.query(
    `SELECT u.*, s.id AS session_id, s.last_seen_at AS session_last_seen
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.disabled_at IS NULL`,
    [tokenHash(token)]
  );
  if (!row) return null;
  // Throttle "last seen" writes to once per 5 minutes per session.
  if (!row.session_last_seen || Date.now() - new Date(row.session_last_seen) > 5 * 60_000) {
    db.execute('UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [row.session_id]).catch(() => {});
  }
  return publicUser(row);
}

async function destroySession(token) {
  if (!token) return;
  await db.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash(token)]);
}

async function purgeExpired() {
  await db.execute('DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP()');
  await db.execute('DELETE FROM email_otps WHERE expires_at <= UTC_TIMESTAMP() - INTERVAL 1 DAY');
}

async function updateProfile(userId, { fullName, loginOtpEnabled }) {
  const sets = [];
  const params = [];
  if (fullName !== undefined) {
    const error = validateFullName(fullName);
    if (error) throw new AuthError(error, 400, { field: 'fullName' });
    sets.push('full_name = ?');
    params.push(String(fullName).trim().replace(/\s+/g, ' '));
  }
  if (loginOtpEnabled !== undefined) {
    const [current] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
    if (current?.role === 'admin' && !loginOtpEnabled) {
      throw new AuthError('Admin accounts always use an email code at login.', 400, { field: 'loginOtpEnabled' });
    }
    sets.push('login_otp_enabled = ?');
    params.push(loginOtpEnabled ? 1 : 0);
  }
  if (sets.length) await db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, userId]);
  const [row] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return publicUser(row);
}

module.exports = {
  AuthError,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateFullName,
  validateRegistration,
  startRegistration,
  completeRegistration,
  resendOtp,
  login,
  completeLoginOtp,
  requestPasswordReset,
  resetPassword,
  createSession,
  getSessionUser,
  destroySession,
  purgeExpired,
  updateProfile,
};
