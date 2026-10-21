const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;
let available = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(config.db);
    // NOW() and CURRENT_TIMESTAMP must agree with the UTC dates the driver writes.
    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function execute(sql, params = []) {
  const [result] = await getPool().query(sql, params);
  return result;
}

// Runs fn(conn) inside a transaction; conn has the same query/execute helpers.
async function transaction(fn) {
  const connection = await getPool().getConnection();
  const conn = {
    query: async (sql, params = []) => (await connection.query(sql, params))[0],
    execute: async (sql, params = []) => (await connection.query(sql, params))[0],
  };
  try {
    await connection.beginTransaction();
    const result = await fn(conn);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}

async function testConnection() {
  try {
    const rows = await query('SELECT 1 AS ok');
    available = rows.length > 0;
  } catch {
    available = false;
  }
  return available;
}

// Last known connectivity (updated by testConnection); cheap for request paths.
function isAvailable() {
  return available;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, execute, transaction, testConnection, isAvailable, closePool };
