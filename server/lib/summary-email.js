// ============================================================================
// Builds the HTML/text body for the optional "email me the summary" feature.
// ============================================================================
const { calculateAllPersonTotals, calculateUnaccounted, getAllParticipants } = require('./totals');

const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', CHF: 'CHF ', CNY: '¥', INR: '₹', MXN: 'MX$' };
function fmt(amount, currency = 'USD') {
  const sym = SYMBOLS[currency] || `${currency} `;
  const n = isFinite(amount) ? amount : 0;
  return `${sym}${n.toFixed(2)}`;
}

function buildSummaryEmail(session) {
  const currency = session.currency || 'USD';
  const totals = calculateAllPersonTotals(session);
  const { totalUnaccounted } = calculateUnaccounted(session);
  const names = getAllParticipants(session);
  const payments = session.payments || [];

  const statusOf = (name) => {
    if (name === session.hostName) return 'host';
    const p = payments.find(x => x.guestName === name);
    if (!p) return 'unpaid';
    return p.status || (p.paid ? 'paid' : 'unpaid');
  };

  const rows = names.map(name => {
    const t = totals[name] || { total: 0 };
    const st = statusOf(name);
    const label = st === 'host' ? 'host' : st === 'confirmed' ? '✓ confirmed' : st === 'paid' ? 'paid (unconfirmed)' : 'unpaid';
    return { name, total: t.total, label };
  });

  const lines = rows.map(r => `${r.name}: ${fmt(r.total, currency)} — ${r.label}`).join('\n');
  const text = [
    `Split the Check — summary`,
    `Host: ${session.hostName}  (Venmo: ${session.venmoHandle || 'n/a'})`,
    ``,
    lines,
    totalUnaccounted > 0 ? `\n⚠️ Unaccounted (no one claimed): ${fmt(totalUnaccounted, currency)}` : '',
  ].filter(Boolean).join('\n');

  const htmlRows = rows.map(r => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${escapeHtml(r.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-family:monospace;text-align:right;">${fmt(r.total, currency)}</td>
      <td style="padding:8px 0 8px 12px;border-bottom:1px solid #eee;color:#888;font-size:13px;">${r.label}</td>
    </tr>`).join('');

  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">
    <h2 style="margin-bottom:4px;">🧾 Split the Check</h2>
    <p style="color:#666;margin-top:0;">Host: <strong>${escapeHtml(session.hostName || '')}</strong>${session.venmoHandle ? ` · Venmo: ${escapeHtml(session.venmoHandle)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">${htmlRows}</table>
    ${totalUnaccounted > 0 ? `<p style="margin-top:16px;padding:10px 14px;background:#fff3e0;border:1px solid #ffb74d;border-radius:8px;color:#bf360c;font-size:14px;">⚠️ ${fmt(totalUnaccounted, currency)} is unaccounted for (no one claimed it).</p>` : ''}
  </div>`;

  return { subject: `Split the Check — ${session.hostName || 'your'} split`, html, text };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { buildSummaryEmail };
