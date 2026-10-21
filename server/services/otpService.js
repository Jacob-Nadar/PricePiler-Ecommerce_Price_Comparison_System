// Email one-time passcodes for registration, login (2nd factor) and password reset.
// Codes are stored only as an HMAC, expire after OTP_TTL_MINUTES, can be resent
// once per cooldown, and are invalidated after OTP_MAX_ATTEMPTS wrong guesses.
const crypto = require('crypto');
const db = require('../config/db');
const config = require('../config');
const logger = require('../utils/logger');

const PURPOSES = new Set(['register', 'login', 'reset']);

let secret = process.env.OTP_SECRET;
if (!secret) {
  // Fine for development; codes simply stop working after a server restart.
  secret = crypto.randomBytes(32).toString('hex');
  if (config.isProduction) {
    throw new Error('OTP_SECRET must be set in production (see server/.env.example).');
  }
  logger.warn('otp.secret_generated', { note: 'Set OTP_SECRET in server/.env so codes survive restarts.' });
}

class OtpError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(email, purpose, code) {
  return crypto.createHmac('sha256', secret).update(`${purpose}:${email}:${code}`).digest('hex');
}

function codesMatch(expectedHash, email, purpose, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const actual = Buffer.from(hashCode(email, purpose, String(code)), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Pure rate-limit decision so it can be unit-tested without a database.
function sendDecision(row, now = new Date()) {
  const { otpResendCooldownSeconds, otpMaxSendsPerHour } = config.auth;
  if (!row || row.consumed_at) return { allowed: true, resetWindow: true };
  const sinceLast = (now - new Date(row.last_sent_at)) / 1000;
  if (sinceLast < otpResendCooldownSeconds) {
    return { allowed: false, retryAfter: Math.ceil(otpResendCooldownSeconds - sinceLast), reason: 'cooldown' };
  }
  const windowAge = (now - new Date(row.send_window_started_at)) / 1000;
  if (windowAge >= 3600) return { allowed: true, resetWindow: true };
  if (row.send_count >= otpMaxSendsPerHour) {
    return { allowed: false, retryAfter: Math.ceil(3600 - windowAge), reason: 'hourly_limit' };
  }
  return { allowed: true, resetWindow: false };
}

// Creates or replaces the live code for (email, purpose). `payload` (e.g. pending
// registration details) is kept from the previous code when not provided.
async function issue(email, purpose, payload) {
  if (!PURPOSES.has(purpose)) throw new OtpError('Invalid verification purpose.');
  const now = new Date();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + config.auth.otpTtlMinutes * 60_000);

  await db.transaction(async (conn) => {
    const [row] = await conn.query(
      'SELECT * FROM email_otps WHERE email = ? AND purpose = ? FOR UPDATE',
      [email, purpose]
    );
    const decision = sendDecision(row, now);
    if (!decision.allowed) {
      throw new OtpError(
        decision.reason === 'cooldown'
          ? `Please wait ${decision.retryAfter} seconds before requesting another code.`
          : 'Too many codes requested. Please try again later.',
        429,
        { retryAfter: decision.retryAfter }
      );
    }
    // MySQL returns JSON columns parsed; MariaDB returns them as strings.
    const existing = row?.payload ?? null;
    const keepPayload =
      payload !== undefined
        ? JSON.stringify(payload)
        : existing == null
          ? null
          : typeof existing === 'string'
            ? existing
            : JSON.stringify(existing);
    if (!row) {
      await conn.execute(
        `INSERT INTO email_otps (email, purpose, code_hash, payload, attempts, send_count, send_window_started_at, last_sent_at, expires_at)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?)`,
        [email, purpose, hashCode(email, purpose, code), keepPayload, now, now, expiresAt]
      );
    } else {
      await conn.execute(
        `UPDATE email_otps SET code_hash = ?, payload = ?, attempts = 0, consumed_at = NULL,
            send_count = ?, send_window_started_at = ?, last_sent_at = ?, expires_at = ?
          WHERE id = ?`,
        [
          hashCode(email, purpose, code),
          keepPayload,
          decision.resetWindow ? 1 : row.send_count + 1,
          decision.resetWindow ? now : row.send_window_started_at,
          now,
          expiresAt,
          row.id,
        ]
      );
    }
  });

  return {
    code,
    expiresAt,
    expiresInSeconds: config.auth.otpTtlMinutes * 60,
    resendInSeconds: config.auth.otpResendCooldownSeconds,
  };
}

// Checks a code. On success the code is consumed and its payload returned.
// A wrong code's attempt counter must be committed, so that error is returned
// out of the transaction and thrown only after commit (throwing inside would
// roll the counter back and make the attempt limit ineffective).
async function verify(email, purpose, code) {
  const outcome = await db.transaction(async (conn) => {
    const [row] = await conn.query(
      'SELECT * FROM email_otps WHERE email = ? AND purpose = ? FOR UPDATE',
      [email, purpose]
    );
    if (!row || row.consumed_at) {
      throw new OtpError('No active verification code. Please request a new one.', 400, { code: 'OTP_MISSING' });
    }
    if (new Date(row.expires_at) <= new Date()) {
      throw new OtpError('This code has expired. Please request a new one.', 400, { code: 'OTP_EXPIRED' });
    }
    if (row.attempts >= config.auth.otpMaxAttempts) {
      throw new OtpError('Too many incorrect attempts. Please request a new code.', 429, { code: 'OTP_LOCKED' });
    }
    if (!codesMatch(row.code_hash, email, purpose, code)) {
      const attempts = row.attempts + 1;
      await conn.execute('UPDATE email_otps SET attempts = ? WHERE id = ?', [attempts, row.id]);
      const left = config.auth.otpMaxAttempts - attempts;
      return {
        error: new OtpError(
          left > 0
            ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
            : 'Too many incorrect attempts. Please request a new code.',
          left > 0 ? 400 : 429,
          { code: left > 0 ? 'OTP_INCORRECT' : 'OTP_LOCKED', attemptsLeft: left }
        ),
      };
    }
    await conn.execute('UPDATE email_otps SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return { payload: payload || {} };
  });
  if (outcome.error) throw outcome.error;
  return outcome.payload;
}

// Seconds until a resend is allowed (0 = now), for the UI countdown.
async function status(email, purpose) {
  const [row] = await db.query('SELECT * FROM email_otps WHERE email = ? AND purpose = ?', [email, purpose]);
  if (!row || row.consumed_at) return null;
  const decision = sendDecision(row);
  return {
    expiresAt: row.expires_at,
    resendInSeconds: decision.allowed ? 0 : decision.retryAfter,
  };
}

module.exports = { issue, verify, status, generateCode, hashCode, codesMatch, sendDecision, OtpError };
