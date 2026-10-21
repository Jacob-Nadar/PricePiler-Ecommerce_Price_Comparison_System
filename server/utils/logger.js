// Structured one-line JSON logs: easy to read in a terminal and to grep or ship
// to a log tool. Never pass secrets (passwords, OTP codes, SMTP credentials) here.
function write(level, event, fields = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// "someone@gmail.com" -> "so***@gmail.com", for logs that must not reveal addresses.
function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

module.exports = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  maskEmail,
};
