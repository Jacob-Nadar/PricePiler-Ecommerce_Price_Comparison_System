// Starts the cron-driven monitor inside the API process. The monitoring logic
// itself lives in services/monitorService.js; this file only decides *when*.
// Run a single pass by hand with:  npm run monitor:once
const cron = require('node-cron');
const config = require('../config');
const monitor = require('../services/monitorService');
const authService = require('../services/authService');
const logger = require('../utils/logger');

let task = null;
let cleanupTask = null;

function start() {
  if (!config.monitor.enabled) {
    logger.info('monitor.disabled', { hint: 'Set MONITOR_ENABLED=true to enable scheduled checks.' });
    return;
  }
  if (!cron.validate(config.monitor.cron)) {
    logger.error('monitor.invalid_cron', { cron: config.monitor.cron });
    return;
  }
  task = cron.schedule(config.monitor.cron, () => {
    monitor.runDueChecks().catch((err) => logger.error('monitor.unhandled', { message: err.message }));
  });
  // Hourly housekeeping: expired sessions and stale OTP rows.
  cleanupTask = cron.schedule('7 * * * *', () => {
    authService.purgeExpired().catch((err) => logger.warn('cleanup.failed', { message: err.message }));
  });
  logger.info('monitor.scheduled', {
    cron: config.monitor.cron,
    intervalMinutes: config.monitor.intervalMinutes,
    batchSize: config.monitor.batchSize,
  });
}

function stop() {
  task?.stop();
  cleanupTask?.stop();
}

module.exports = { start, stop };
