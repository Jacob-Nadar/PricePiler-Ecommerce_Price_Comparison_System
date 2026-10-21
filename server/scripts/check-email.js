// Checks the SMTP settings in server/.env and optionally sends a test email.
//   npm run check:email                    verify login only
//   npm run check:email -- you@gmail.com   also send a test message
const mailer = require('../services/email/mailer');
const config = require('../config');

(async () => {
  if (!mailer.isConfigured()) {
    console.log('SMTP_USER / SMTP_PASS are empty: emails are printed to the server console (development mode).');
    process.exit(0);
  }
  console.log(`Connecting to ${config.mail.host}:${config.mail.port} as ${config.mail.user} ...`);
  const check = await mailer.verifyConnection();
  if (!check.ok) {
    console.error(`SMTP login failed (${check.error}).`);
    console.error('For Gmail, SMTP_PASS must be a 16-character App Password, not your normal password.');
    process.exit(1);
  }
  console.log('SMTP login OK.');
  const to = process.argv[2];
  if (to) {
    const result = await mailer.sendMail({
      to,
      subject: 'PricePiler test email',
      text: 'Your PricePiler email settings work.',
      html: '<p>Your <strong>PricePiler</strong> email settings work.</p>',
    });
    console.log(`Test email to ${to}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
    process.exit(result.status === 'sent' ? 0 : 1);
  }
})();
