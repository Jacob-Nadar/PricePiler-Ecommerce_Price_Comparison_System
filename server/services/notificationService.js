// Sends emails and records every attempt in notification_logs. Alert emails carry
// an event_key (unique in the table): the row is inserted *before* sending, so if
// two monitor runs reach the same price-drop or restock event, only the one whose
// insert succeeds sends the email.
const db = require('../config/db');
const mailer = require('./email/mailer');
const logger = require('../utils/logger');

// Returns the new log id, or null when this event was already claimed.
async function claimEvent({ userId, type, eventKey, subject, priceAlertId, stockAlertId, listingId, details }) {
  try {
    const result = await db.execute(
      `INSERT INTO notification_logs
         (user_id, type, event_key, price_alert_id, stock_alert_id, listing_id, subject, status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        userId ?? null,
        type,
        eventKey ?? null,
        priceAlertId ?? null,
        stockAlertId ?? null,
        listingId ?? null,
        subject.slice(0, 255),
        details ? JSON.stringify(details) : null,
      ]
    );
    return result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      logger.info('notification.duplicate_skipped', { type, eventKey });
      return null;
    }
    throw err;
  }
}

async function finish(logId, outcome) {
  await db.execute(
    `UPDATE notification_logs SET status = ?, error = ?, sent_at = IF(? IN ('sent','logged'), UTC_TIMESTAMP(), NULL) WHERE id = ?`,
    [outcome.status, outcome.error ? String(outcome.error).slice(0, 500) : null, outcome.status, logId]
  );
}

// Send one email and log it. For alert emails pass eventKey for deduplication.
// Returns { status, duplicate? }.
async function send({ to, email, userId, type, eventKey, priceAlertId, stockAlertId, listingId, details }) {
  const logId = await claimEvent({
    userId,
    type,
    eventKey,
    subject: email.subject,
    priceAlertId,
    stockAlertId,
    listingId,
    details,
  });
  if (logId == null) return { status: 'duplicate', duplicate: true };

  const outcome = await mailer.sendMail({ to, ...email });
  await finish(logId, outcome);
  logger.info('notification.delivered', {
    type,
    logId,
    status: outcome.status,
    to: logger.maskEmail(to),
    ...(eventKey ? { eventKey } : {}),
  });
  return outcome;
}

async function listForUser(userId, { limit = 20, offset = 0 } = {}) {
  const rows = await db.query(
    `SELECT n.id, n.type, n.subject, n.status, n.error, n.details, n.created_at AS createdAt, n.sent_at AS sentAt,
            n.price_alert_id AS priceAlertId, n.stock_alert_id AS stockAlertId, n.listing_id AS listingId
       FROM notification_logs n
      WHERE n.user_id = ? AND n.type IN ('price_drop','back_in_stock')
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM notification_logs WHERE user_id = ? AND type IN ('price_drop','back_in_stock')`,
    [userId]
  );
  return {
    total,
    items: rows.map((r) => ({
      ...r,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      // Never send internal SMTP error text to the browser.
      error: r.status === 'failed' ? 'Delivery failed' : null,
    })),
  };
}

module.exports = { send, claimEvent, finish, listForUser };
