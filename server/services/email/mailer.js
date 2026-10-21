// Email transport. With SMTP_USER/SMTP_PASS set, mail goes out through SMTP
// (Gmail by default). Without them, development runs in "console" mode: the email
// is printed to the server log and recorded with status "logged" — never "sent" —
// so it is never mistaken for a delivered message. Production refuses console mode.
const nodemailer = require('nodemailer');
const config = require('../../config');
const logger = require('../../utils/logger');

let transporter = null;

function isConfigured() {
  return Boolean(config.mail.user && config.mail.pass);
}

function mode() {
  return isConfigured() ? 'smtp' : 'console';
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

// Returns { status: 'sent' | 'logged' | 'failed', error? }. Never throws.
async function sendMail({ to, subject, html, text, consolePreview }) {
  if (!isConfigured()) {
    if (config.isProduction) {
      logger.error('email.not_configured', { to: logger.maskEmail(to), subject });
      return { status: 'failed', error: 'Email delivery is not configured on the server.' };
    }
    // Development only: show what would have been sent (OTP codes included) so
    // features can be tested before SMTP credentials are added.
    console.log(
      `\n──── EMAIL (console mode — not delivered) ────\nTo: ${to}\nSubject: ${subject}\n${consolePreview || text}\n──────────────────────────────────────────────\n`
    );
    return { status: 'logged' };
  }
  try {
    const info = await getTransporter().sendMail({ from: config.mail.from, to, subject, html, text });
    logger.info('email.sent', { to: logger.maskEmail(to), subject, messageId: info.messageId });
    return { status: 'sent' };
  } catch (err) {
    // SMTP errors can echo the username; keep only the code and a short reason.
    const reason = `${err.code || 'SMTP_ERROR'}: ${String(err.response || err.message).slice(0, 160)}`.replace(
      config.mail.pass || '\u0000',
      '***'
    );
    logger.error('email.failed', { to: logger.maskEmail(to), subject, reason });
    return { status: 'failed', error: reason };
  }
}

async function verifyConnection() {
  if (!isConfigured()) return { ok: false, mode: 'console' };
  try {
    await getTransporter().verify();
    return { ok: true, mode: 'smtp' };
  } catch (err) {
    return { ok: false, mode: 'smtp', error: err.code || err.message };
  }
}

module.exports = { sendMail, isConfigured, mode, verifyConnection };
