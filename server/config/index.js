const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bool = (value, fallback) => (value == null || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value));
const int = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : fallback);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

module.exports = {
  port: int(process.env.PORT, 5000),
  nodeEnv,
  isProduction,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  appUrl: process.env.APP_URL || process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'price_comparison',
    waitForConnections: true,
    connectionLimit: int(process.env.DB_POOL_SIZE, 10),
    queueLimit: 0,
    // Store and read every DATETIME as UTC so the app behaves the same on any PC.
    timezone: 'Z',
    decimalNumbers: true,
    dateStrings: false,
  },
  autoMigrate: bool(process.env.DB_AUTO_MIGRATE, true),
  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 8000),

  auth: {
    sessionCookieName: 'pp_session',
    sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7),
    // Secure cookies need HTTPS; default on in production only.
    cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
    bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),
    otpTtlMinutes: int(process.env.OTP_TTL_MINUTES, 5),
    otpResendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    otpMaxSendsPerHour: int(process.env.OTP_MAX_SENDS_PER_HOUR, 5),
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(process.env.LOGIN_LOCKOUT_MINUTES, 15),
    // Comma-separated, e.g. "gmail.com". Empty = any valid email address.
    allowedEmailDomains: (process.env.ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  },

  mail: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || (process.env.SMTP_USER ? `PricePiler <${process.env.SMTP_USER}>` : 'PricePiler <no-reply@localhost>'),
  },

  monitor: {
    enabled: bool(process.env.MONITOR_ENABLED, true),
    // How often the scheduler wakes up to look for listings that are due.
    cron: process.env.MONITOR_CRON || '*/15 * * * *',
    // How often each tracked listing is re-checked.
    intervalMinutes: int(process.env.MONITOR_INTERVAL_MINUTES, 360),
    batchSize: int(process.env.MONITOR_BATCH_SIZE, 20),
    concurrency: int(process.env.MONITOR_CONCURRENCY, 2),
    // Pause between requests to the same retailer to stay well within polite limits.
    requestDelayMs: int(process.env.MONITOR_REQUEST_DELAY_MS, 4000),
    maxRetries: int(process.env.MONITOR_MAX_RETRIES, 2),
    retryBaseDelayMs: int(process.env.MONITOR_RETRY_BASE_DELAY_MS, 2000),
    maxBackoffMinutes: int(process.env.MONITOR_MAX_BACKOFF_MINUTES, 24 * 60),
    lockMinutes: int(process.env.MONITOR_LOCK_MINUTES, 10),
    // An unchanged price is still snapshotted at most this often, so charts stay continuous.
    snapshotHeartbeatHours: int(process.env.SNAPSHOT_HEARTBEAT_HOURS, 24),
  },
};
