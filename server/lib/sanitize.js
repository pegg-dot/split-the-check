// ============================================================================
// Receipt-scan output sanitization
// ----------------------------------------------------------------------------
// Claude returns JSON, but a vision model can occasionally emit a price as a
// string ("12.99"), a NaN, a negative, or a malformed item. One bad number
// poisons the entire client subtotal (sum becomes NaN → every screen breaks).
// We coerce everything to safe, finite, non-negative numbers HERE, server-side,
// so the client never has to defend against garbage.
// ============================================================================

/** Coerce anything to a finite, non-negative number rounded to 2dp (0 on failure). */
function num(v) {
  if (typeof v === 'number') return clean(v);
  if (typeof v === 'string') {
    // Handle "12,99" (EU decimal comma) and stray currency symbols/spaces.
    const normalized = v.replace(/[^\d.,-]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
    return clean(parseFloat(normalized));
  }
  return 0;
}

function clean(n) {
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

/**
 * Sanitize the parsed scan payload. Drops items with no name AND no price,
 * coerces all monetary fields, and clamps quantity to a sane integer.
 * Returns a clean object the client can trust.
 */
function sanitizeScan(data) {
  const out = {
    items: [],
    tax: num(data?.tax),
    taxNote: typeof data?.taxNote === 'string' ? data.taxNote.slice(0, 120) : '',
    tipIncluded: !!data?.tipIncluded,
    tipAmount: num(data?.tipAmount),
    adminFee: num(data?.adminFee),
    currency: normalizeCurrency(data?.currency),
  };

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  for (const it of rawItems) {
    const name = typeof it?.name === 'string' ? it.name.trim().slice(0, 100) : '';
    const price = num(it?.price);
    if (!name && price === 0) continue; // junk row
    const item = { name: name || 'Item', price };
    // Quantity items: preserve quantity + unitPrice when present and valid.
    const qty = Math.max(1, Math.min(99, Math.round(Number(it?.quantity) || 1)));
    if (qty > 1) {
      item.quantity = qty;
      item.unitPrice = num(it?.unitPrice) || clean(price / qty);
    }
    out.items.push(item);
  }

  // If tip was flagged included but amount is 0, treat as not included.
  if (out.tipIncluded && out.tipAmount === 0) out.tipIncluded = false;

  return out;
}

function normalizeCurrency(c) {
  if (typeof c !== 'string') return 'USD';
  const up = c.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(up) ? up : 'USD';
}

module.exports = { sanitizeScan, num, normalizeCurrency };
