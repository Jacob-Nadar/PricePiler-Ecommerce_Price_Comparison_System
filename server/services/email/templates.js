// Responsive, inline-styled HTML emails (email clients ignore <style> blocks and
// external CSS), each with a plain-text alternative.
const config = require('../../config');

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const inr = (value) =>
  value == null || Number.isNaN(Number(value))
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));

// Only http(s) links to the store or this app are ever put in an href.
const safeUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : config.appUrl);

function layout({ preheader, title, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td style="background:#4f46e5;padding:20px 28px;">
  <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;background:#ffffff;color:#4f46e5;font-weight:800;font-size:18px;">₹</span>
  <span style="color:#ffffff;font-size:20px;font-weight:800;vertical-align:middle;margin-left:8px;">PricePiler</span>
</td></tr>
<tr><td style="padding:28px;">${body}</td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
  You received this email because of activity on your PricePiler account.
  Prices are listed product prices at the time we checked; always confirm on the store page before buying.
  <br><a href="${escapeHtml(config.appUrl)}/dashboard" style="color:#4f46e5;">Manage your alerts</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<a href="${escapeHtml(safeUrl(href))}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">${escapeHtml(label)}</a>`;

const row = (label, value, strong = false) =>
  `<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-size:14px;${strong ? 'font-weight:800;color:#059669;' : 'font-weight:600;'}">${escapeHtml(value)}</td></tr>`;

const OTP_COPY = {
  register: { subject: 'Verify your email for PricePiler', intro: 'Use this code to finish creating your PricePiler account.' },
  login: { subject: 'Your PricePiler sign-in code', intro: 'Use this code to finish signing in to PricePiler.' },
  reset: { subject: 'Reset your PricePiler password', intro: 'Use this code to reset your PricePiler password.' },
};

function otpEmail({ purpose, code, minutes, name }) {
  const copy = OTP_COPY[purpose];
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  const html = layout({
    preheader: `${code} is your verification code`,
    title: copy.subject,
    body: `<p style="margin:0 0 12px;font-size:16px;">${greeting}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${copy.intro}</p>
<div style="text-align:center;margin:0 0 20px;">
  <span style="display:inline-block;font-family:Consolas,Menlo,monospace;font-size:34px;letter-spacing:10px;font-weight:800;background:#eef2ff;color:#3730a3;padding:14px 22px;border-radius:12px;">${escapeHtml(code)}</span>
</div>
<p style="margin:0 0 8px;font-size:14px;color:#334155;">This code expires in <strong>${minutes} minutes</strong>.</p>
<p style="margin:0;font-size:13px;color:#64748b;">If you didn’t request this, you can ignore this email — your account is safe. Never share this code with anyone.</p>`,
  });
  const text = `${greeting}\n\n${copy.intro}\n\nYour code: ${code}\nIt expires in ${minutes} minutes.\n\nIf you didn't request this, ignore this email.`;
  return { subject: copy.subject, html, text };
}

function priceDropEmail({ name, productName, retailer, previousPrice, currentPrice, targetPrice, productUrl, imageUrl }) {
  const subject = `Price drop: ${productName.slice(0, 60)} is now ${inr(currentPrice)}`;
  const html = layout({
    preheader: `Now ${inr(currentPrice)} at ${retailer} — at or below your ${inr(targetPrice)} target`,
    title: subject,
    body: `<p style="margin:0 0 12px;font-size:16px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">Good news — a product you’re tracking has dropped to your target price.</p>
${imageUrl && /^https:\/\//.test(imageUrl) ? `<div style="text-align:center;margin-bottom:16px;"><img src="${escapeHtml(imageUrl)}" alt="" width="140" style="max-width:140px;height:auto;border-radius:8px;"></div>` : ''}
<p style="margin:0 0 16px;font-size:16px;font-weight:700;line-height:1.4;">${escapeHtml(productName)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
${row('Retailer', retailer)}
${row('Previous price', inr(previousPrice))}
${row('Your target price', inr(targetPrice))}
${row('Current price', inr(currentPrice), true)}
</table>
<div style="text-align:center;">${button(productUrl, `View on ${retailer}`)}</div>`,
  });
  const text = `Hi ${name},\n\n${productName}\nRetailer: ${retailer}\nPrevious price: ${inr(previousPrice)}\nYour target: ${inr(targetPrice)}\nCurrent price: ${inr(currentPrice)}\n\nView: ${safeUrl(productUrl)}`;
  return { subject, html, text };
}

function backInStockEmail({ name, productName, retailer, price, productUrl, imageUrl }) {
  const subject = `Back in stock: ${productName.slice(0, 60)}`;
  const html = layout({
    preheader: `Available again at ${retailer}${price != null ? ` for ${inr(price)}` : ''}`,
    title: subject,
    body: `<p style="margin:0 0 12px;font-size:16px;">Hi ${escapeHtml(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">A product you asked us to watch is available again.</p>
${imageUrl && /^https:\/\//.test(imageUrl) ? `<div style="text-align:center;margin-bottom:16px;"><img src="${escapeHtml(imageUrl)}" alt="" width="140" style="max-width:140px;height:auto;border-radius:8px;"></div>` : ''}
<p style="margin:0 0 16px;font-size:16px;font-weight:700;line-height:1.4;">${escapeHtml(productName)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
${row('Retailer', retailer)}
${row('Availability', 'In stock', true)}
${row('Price when checked', inr(price))}
</table>
<div style="text-align:center;">${button(productUrl, `Buy on ${retailer}`)}</div>
<p style="margin:18px 0 0;font-size:13px;color:#64748b;">Stock can sell out quickly — availability is as of our latest check.</p>`,
  });
  const text = `Hi ${name},\n\n${productName} is back in stock at ${retailer}.\nPrice when checked: ${inr(price)}\n\nView: ${safeUrl(productUrl)}`;
  return { subject, html, text };
}

module.exports = { otpEmail, priceDropEmail, backInStockEmail, escapeHtml, inr };
