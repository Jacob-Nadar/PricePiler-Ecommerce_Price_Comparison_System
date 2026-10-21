const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config');
const db = require('./config/db');
const adapters = require('./adapters');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { attachUser, checkOrigin } = require('./middleware/auth');
const { closeBrowser } = require('./utils/browser');
const priceTracker = require('./services/priceTracker');
const mailer = require('./services/email/mailer');
const scheduler = require('./jobs/scheduler');
const { migrate } = require('./db/migrate');
const logger = require('./utils/logger');

const productsRouter = require('./routes/products');
const authRouter = require('./routes/auth');
const accountRouter = require('./routes/account');
const adminRouter = require('./routes/admin');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: config.clientOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.use('/api', apiLimiter, checkOrigin, attachUser);

app.get('/api/health', require('./controllers/productsController').health);
app.use('/api/products', productsRouter);
app.use('/api/auth', authRouter);
app.use('/api/me', accountRouter);
app.use('/api/admin', adminRouter);

if (config.isProduction) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return notFound(req, res);
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

async function connectDatabase() {
  if (config.autoMigrate) {
    try {
      await migrate({ log: (msg) => logger.info('db.migrate', { msg }) });
    } catch (err) {
      logger.warn('db.migrate_skipped', { reason: err.code || err.message });
    }
  }
  const ok = await db.testConnection();
  if (ok) {
    logger.info('db.connected', { host: config.db.host, port: config.db.port, database: config.db.database });
    await adapters.loadStores().catch((err) => logger.warn('db.load_retailers_failed', { message: err.message }));
  }
  return ok;
}

async function bootstrap() {
  const dbOk = await connectDatabase();
  if (!dbOk) {
    logger.warn('db.unavailable', {
      hint: 'Live search works, but accounts, alerts and price history need MySQL. Check DB_* in server/.env.',
    });
    await adapters.ensureLoaded();
    // Pick the database up automatically if MySQL is started after the server.
    const retry = setInterval(async () => {
      if (await connectDatabase()) clearInterval(retry);
    }, 30_000);
    retry.unref();
  }

  logger.info('email.mode', {
    mode: mailer.mode(),
    ...(mailer.isConfigured() ? {} : { hint: 'Set SMTP_USER and SMTP_PASS in server/.env to send real emails.' }),
  });
  scheduler.start();

  const listener = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  // Catch listen errors (e.g. EADDRINUSE) so --watch can retry cleanly
  // instead of crashing with an unhandled 'error' event.
  listener.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] Port ${config.port} is already in use. ` +
          `Stop the process using that port, or set a different PORT in your .env.`
      );
    } else {
      console.error('[server] failed to start listener:', err);
    }
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down`);
    scheduler.stop();
    try {
      await Promise.race([
        new Promise((resolve) => listener.close(() => resolve())),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (_) {
      /* ignore close errors */
    }
    priceTracker.flush();
    await closeBrowser();
    await db.closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}

module.exports = app;
