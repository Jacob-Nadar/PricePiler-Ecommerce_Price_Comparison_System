// Read and manage every customer's data for the admin panel.
// Never selects password hashes, OTP hashes or session tokens.
const db = require('../config/db');
const alerts = require('./alertService');
const users = require('./userService');
const notifications = require('./notificationService');
const monitor = require('./monitorService');
const logger = require('../utils/logger');

class AdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function paging({ page, pageSize }) {
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  return { limit: size, offset: (current - 1) * size, page: current, pageSize: size };
}

const like = (search) => `%${String(search || '').trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value ?? null);

async function audit(adminId, action, targetType, targetId, details, ip) {
  await db.execute(
    'INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [adminId, action, targetType, targetId != null ? String(targetId) : null, details ? JSON.stringify(details) : null, ip ? String(ip).slice(0, 64) : null]
  );
  logger.info('admin.action', { adminId, action, targetType, targetId });
}

async function overview() {
  const [[counts], [alertCounts], [stockCounts], [emailCounts], [listingCounts], recentUsers] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS users,
              SUM(created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS newUsers7d,
              SUM(role = 'admin') AS admins,
              SUM(disabled_at IS NOT NULL) AS disabled,
              SUM(last_login_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS active7d
         FROM users`
    ),
    db.query(
      `SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'triggered') AS triggered,
              SUM(status = 'paused') AS paused FROM price_alerts`
    ),
    db.query(`SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'notified') AS notified FROM stock_alerts`),
    db.query(
      `SELECT SUM(status = 'sent') AS sent, SUM(status = 'logged') AS logged, SUM(status = 'failed') AS failed,
              SUM(type IN ('price_drop','back_in_stock')) AS alertEmails
         FROM notification_logs WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY`
    ),
    db.query(
      `SELECT COUNT(*) AS listings, SUM(consecutive_failures > 0) AS failing,
              MAX(last_success_at) AS lastSuccess,
              (SELECT COUNT(*) FROM products) AS products,
              (SELECT COUNT(*) FROM price_history) AS snapshots,
              (SELECT COUNT(*) FROM saved_products) AS saved
         FROM product_listings`
    ),
    db.query(
      `SELECT id, full_name AS fullName, email, role, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 5`
    ),
  ]);
  const num = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v instanceof Date || v == null ? v : Number(v)]));
  return {
    users: num(counts),
    priceAlerts: num(alertCounts),
    stockAlerts: num(stockCounts),
    emails7d: num(emailCounts),
    catalog: num(listingCounts),
    recentUsers,
  };
}

async function listUsers({ search, page, pageSize, role }) {
  const p = paging({ page, pageSize });
  const where = ['(u.email LIKE ? OR u.full_name LIKE ?)'];
  const params = [like(search), like(search)];
  if (role === 'admin' || role === 'user') {
    where.push('u.role = ?');
    params.push(role);
  }
  if (role === 'disabled') where.push('u.disabled_at IS NOT NULL');
  const rows = await db.query(
    `SELECT u.id, u.full_name AS fullName, u.email, u.role, u.email_verified_at AS emailVerifiedAt,
            u.login_otp_enabled AS loginOtpEnabled, u.disabled_at AS disabledAt, u.locked_until AS lockedUntil,
            u.last_login_at AS lastLoginAt, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM saved_products s WHERE s.user_id = u.id) AS savedCount,
            (SELECT COUNT(*) FROM price_alerts a WHERE a.user_id = u.id AND a.status IN ('active','triggered')) AS priceAlertCount,
            (SELECT COUNT(*) FROM stock_alerts sa WHERE sa.user_id = u.id AND sa.status IN ('active','notified')) AS stockAlertCount
       FROM users u WHERE ${where.join(' AND ')}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset]
  );
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`, params);
  return { items: rows.map((r) => ({ ...r, loginOtpEnabled: Boolean(r.loginOtpEnabled) })), total, page: p.page, pageSize: p.pageSize };
}

async function getUser(userId) {
  const [user] = await db.query(
    `SELECT id, full_name AS fullName, email, role, email_verified_at AS emailVerifiedAt,
            login_otp_enabled AS loginOtpEnabled, failed_login_attempts AS failedLoginAttempts,
            locked_until AS lockedUntil, disabled_at AS disabledAt, last_login_at AS lastLoginAt,
            created_at AS createdAt
       FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) throw new AdminError('User not found.', 404);
  const [saved, priceAlerts, stockAlerts, recent, sessions] = await Promise.all([
    users.listSaved(userId),
    alerts.listPriceAlerts(userId),
    alerts.listStockAlerts(userId),
    notifications.listForUser(userId, { limit: 20 }),
    db.query(
      `SELECT id, user_agent AS userAgent, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt
         FROM user_sessions WHERE user_id = ? AND expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC`,
      [userId]
    ),
  ]);
  return {
    user: { ...user, loginOtpEnabled: Boolean(user.loginOtpEnabled) },
    saved,
    priceAlerts,
    stockAlerts,
    notifications: recent,
    sessions,
  };
}

async function targetUser(adminId, userId) {
  const [user] = await db.query('SELECT id, role, email FROM users WHERE id = ?', [userId]);
  if (!user) throw new AdminError('User not found.', 404);
  if (user.id === adminId) throw new AdminError('You cannot do this to your own account.');
  if (user.role === 'admin') throw new AdminError('Other admin accounts can only be changed from the command line.');
  return user;
}

async function setUserDisabled(adminId, userId, disabled, ip) {
  const user = await targetUser(adminId, userId);
  await db.transaction(async (conn) => {
    await conn.execute('UPDATE users SET disabled_at = ? WHERE id = ?', [disabled ? new Date() : null, user.id]);
    if (disabled) await conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
  });
  await audit(adminId, disabled ? 'user.disable' : 'user.enable', 'user', user.id, { email: user.email }, ip);
}

async function signOutUser(adminId, userId, ip) {
  const user = await targetUser(adminId, userId);
  const result = await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
  await audit(adminId, 'user.sign_out', 'user', user.id, { sessions: result.affectedRows }, ip);
  return result.affectedRows;
}

async function unlockUser(adminId, userId, ip) {
  const user = await targetUser(adminId, userId);
  await db.execute('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  await audit(adminId, 'user.unlock', 'user', user.id, null, ip);
}

async function deleteUser(adminId, userId, ip) {
  const user = await targetUser(adminId, userId);
  // Sessions, saved products, alerts and notification rows cascade with the user.
  await db.execute('DELETE FROM users WHERE id = ?', [user.id]);
  await audit(adminId, 'user.delete', 'user', user.id, { email: user.email }, ip);
}

async function listPriceAlerts({ search, status, page, pageSize }) {
  const p = paging({ page, pageSize });
  const where = ['(u.email LIKE ? OR p.name LIKE ?)'];
  const params = [like(search), like(search)];
  if (['active', 'triggered', 'paused', 'cancelled'].includes(status)) {
    where.push('a.status = ?');
    params.push(status);
  }
  const from = `FROM price_alerts a JOIN users u ON u.id = a.user_id JOIN products p ON p.id = a.product_id
                LEFT JOIN product_listings l ON l.id = a.listing_id LEFT JOIN retailers r ON r.id = l.retailer_id
               WHERE ${where.join(' AND ')}`;
  const items = await db.query(
    `SELECT a.id, a.status, a.target_price AS targetPrice, a.last_seen_price AS lastSeenPrice,
            a.last_notified_at AS lastNotifiedAt, a.created_at AS createdAt, a.product_id AS productId,
            p.name AS productName, u.id AS userId, u.email AS userEmail, r.name AS retailerName
       ${from} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset]
  );
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

async function listStockAlerts({ search, status, page, pageSize }) {
  const p = paging({ page, pageSize });
  const where = ['(u.email LIKE ? OR p.name LIKE ?)'];
  const params = [like(search), like(search)];
  if (['active', 'notified', 'paused', 'cancelled'].includes(status)) {
    where.push('s.status = ?');
    params.push(status);
  }
  const from = `FROM stock_alerts s JOIN users u ON u.id = s.user_id JOIN product_listings l ON l.id = s.listing_id
                JOIN products p ON p.id = l.product_id JOIN retailers r ON r.id = s.retailer_id
               WHERE ${where.join(' AND ')}`;
  const items = await db.query(
    `SELECT s.id, s.status, s.last_notified_at AS lastNotifiedAt, s.created_at AS createdAt,
            l.availability, l.current_price AS currentPrice, l.product_url AS productUrl, p.id AS productId,
            p.name AS productName, u.id AS userId, u.email AS userEmail, r.name AS retailerName
       ${from} ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset]
  );
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

async function ownerOf(table, id) {
  const [row] = await db.query(`SELECT user_id FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new AdminError('Alert not found.', 404);
  return row.user_id;
}

async function updateAlert(adminId, kind, alertId, action, ip) {
  if (!['pause', 'resume', 'cancel'].includes(action)) throw new AdminError('Unknown action.');
  const table = kind === 'price' ? 'price_alerts' : 'stock_alerts';
  const ownerId = await ownerOf(table, alertId);
  if (kind === 'price') await alerts.updatePriceAlert(ownerId, alertId, { action });
  else await alerts.updateStockAlert(ownerId, alertId, { action });
  await audit(adminId, `${kind}_alert.${action}`, `${kind}_alert`, alertId, { ownerId }, ip);
}

async function deleteAlert(adminId, kind, alertId, ip) {
  const table = kind === 'price' ? 'price_alerts' : 'stock_alerts';
  const ownerId = await ownerOf(table, alertId);
  if (kind === 'price') await alerts.deletePriceAlert(ownerId, alertId);
  else await alerts.deleteStockAlert(ownerId, alertId);
  await audit(adminId, `${kind}_alert.delete`, `${kind}_alert`, alertId, { ownerId }, ip);
}

async function listListings({ search, filter, page, pageSize }) {
  const p = paging({ page, pageSize });
  const where = ['(p.name LIKE ? OR l.title LIKE ?)'];
  const params = [like(search), like(search)];
  if (filter === 'failing') where.push('l.consecutive_failures > 0');
  if (filter === 'tracked') {
    where.push(`(EXISTS (SELECT 1 FROM saved_products sp WHERE sp.product_id = l.product_id)
       OR EXISTS (SELECT 1 FROM price_alerts a WHERE a.status IN ('active','triggered') AND (a.listing_id = l.id OR (a.listing_id IS NULL AND a.product_id = l.product_id)))
       OR EXISTS (SELECT 1 FROM stock_alerts s WHERE s.listing_id = l.id AND s.status IN ('active','notified')))`);
  }
  const from = `FROM product_listings l JOIN products p ON p.id = l.product_id JOIN retailers r ON r.id = l.retailer_id
               WHERE ${where.join(' AND ')}`;
  const items = await db.query(
    `SELECT l.id, l.product_id AS productId, l.title, l.product_url AS productUrl, l.current_price AS currentPrice,
            l.availability, l.last_checked_at AS lastCheckedAt, l.last_success_at AS lastSuccessAt,
            l.last_error AS lastError, l.consecutive_failures AS failures, l.next_check_at AS nextCheckAt,
            r.name AS retailerName, r.slug AS retailerSlug,
            (SELECT COUNT(*) FROM price_history ph WHERE ph.listing_id = l.id) AS snapshots
       ${from} ORDER BY l.consecutive_failures DESC, l.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset]
  );
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

async function checkListingNow(adminId, listingId, ip) {
  const [row] = await db.query('SELECT id FROM product_listings WHERE id = ?', [listingId]);
  if (!row) throw new AdminError('Listing not found.', 404);
  await db.execute('UPDATE product_listings SET next_check_at = UTC_TIMESTAMP() WHERE id = ?', [listingId]);
  await audit(adminId, 'listing.check_now', 'listing', listingId, null, ip);
  // Run now in the background; the result shows up in the listing row.
  monitor.runDueChecks({ limit: 5 }).catch(() => {});
}

async function listNotifications({ type, status, search, page, pageSize }) {
  const p = paging({ page, pageSize });
  const where = ['(u.email LIKE ? OR n.subject LIKE ? OR (n.user_id IS NULL AND ? = \'%%\'))'];
  const params = [like(search), like(search), like(search)];
  if (['price_drop', 'back_in_stock', 'otp_register', 'otp_login', 'otp_reset'].includes(type)) {
    where.push('n.type = ?');
    params.push(type);
  }
  if (['sent', 'logged', 'failed', 'pending'].includes(status)) {
    where.push('n.status = ?');
    params.push(status);
  }
  const from = `FROM notification_logs n LEFT JOIN users u ON u.id = n.user_id WHERE ${where.join(' AND ')}`;
  const items = await db.query(
    `SELECT n.id, n.type, n.subject, n.status, n.error, n.created_at AS createdAt, n.sent_at AS sentAt,
            n.details, u.id AS userId, u.email AS userEmail
       ${from} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`,
    [...params, p.limit, p.offset]
  );
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  return { items: items.map((n) => ({ ...n, details: parseJson(n.details) })), total, page: p.page, pageSize: p.pageSize };
}

async function listAudit({ page, pageSize }) {
  const p = paging({ page, pageSize });
  const items = await db.query(
    `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId, a.details, a.ip,
            a.created_at AS createdAt, u.email AS adminEmail
       FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [p.limit, p.offset]
  );
  const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM admin_audit_logs');
  return { items: items.map((a) => ({ ...a, details: parseJson(a.details) })), total, page: p.page, pageSize: p.pageSize };
}

module.exports = {
  AdminError,
  audit,
  overview,
  listUsers,
  getUser,
  setUserDisabled,
  signOutUser,
  unlockUser,
  deleteUser,
  listPriceAlerts,
  listStockAlerts,
  updateAlert,
  deleteAlert,
  listListings,
  checkListingNow,
  listNotifications,
  listAudit,
};
