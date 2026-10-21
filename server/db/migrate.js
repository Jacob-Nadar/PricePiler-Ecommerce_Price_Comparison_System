// Applies server/db/migrations/*.sql in order and records each in schema_migrations.
// Creates the database first if it does not exist, so a fresh PC only needs a
// running MySQL server and the DB_* settings in server/.env.
//
//   npm run migrate          apply pending migrations
//   npm run migrate -- --status   list applied/pending migrations
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

async function migrate({ log = console.log, statusOnly = false } = {}) {
  const { host, port, user, password, database } = config.db;
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('DB_NAME may only contain letters, numbers and underscores.');
  }
  const connection = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${database}\``);
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const [rows] = await connection.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const pending = migrationFiles().filter((file) => !applied.has(file));

    if (statusOnly) {
      for (const file of migrationFiles()) log(`${applied.has(file) ? 'applied ' : 'pending '} ${file}`);
      return { applied: [...applied], pending };
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`[migrate] applying ${file}`);
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    }
    log(pending.length ? `[migrate] ${pending.length} migration(s) applied to ${database}` : `[migrate] ${database} is up to date`);
    return { applied: [...applied, ...pending], pending: [] };
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  migrate({ statusOnly: process.argv.includes('--status') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[migrate] failed: ${err.message}`);
      if (err.code === 'ECONNREFUSED') {
        console.error(`[migrate] Is MySQL running on ${config.db.host}:${config.db.port}? Check DB_HOST/DB_PORT in server/.env.`);
      } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error('[migrate] Check DB_USER / DB_PASSWORD in server/.env.');
      }
      process.exit(1);
    });
}

module.exports = { migrate };
