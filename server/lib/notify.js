// ============================================================================
// Optional email notification seam (P3)
// ----------------------------------------------------------------------------
// Graceful by design: if RESEND_API_KEY is not set, this is a no-op that just
// logs — so the app works fully with ZERO signup. Set the key (and FROM_EMAIL)
// to turn on real "email me my share / email the host the summary" features.
// Uses Resend's HTTP API directly (no SDK dependency) so nothing to install.
// ============================================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Split the Check <onboarding@resend.dev>';

const enabled = !!RESEND_API_KEY;

async function sendEmail({ to, subject, html, text }) {
  if (!enabled) {
    console.log(`[notify] (disabled — set RESEND_API_KEY) would email "${subject}" to ${to}`);
    return { ok: false, disabled: true };
  }
  if (!to || !subject) return { ok: false, error: 'missing to/subject' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[notify] Resend error:', res.status, body);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[notify] send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendEmail, notifyEnabled: enabled };
