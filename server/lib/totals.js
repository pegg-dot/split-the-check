// ============================================================================
// Server-side money math (CommonJS port of the client's SessionContext calc)
// ----------------------------------------------------------------------------
// Kept faithful to the client so server-computed summaries/emails match what
// guests saw. Also the unit-test surface for the riskiest logic in the app.
// Uses the largest-remainder method so per-person amounts sum EXACTLY to the
// distributed total (no $0.01 drift).
// ============================================================================

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function distributeProportionally(total, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0 || total === 0) return weights.map(() => 0);

  const totalCents = Math.round(total * 100);
  const exactCents = weights.map(w => (w / totalWeight) * totalCents);
  const floored    = exactCents.map(c => Math.floor(c));
  let remainder    = totalCents - floored.reduce((a, b) => a + b, 0);

  const order = exactCents
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floored[order[k].i] += 1;

  return floored.map(c => c / 100);
}

function getAllParticipants(session) {
  const names = new Set();
  if (session.hostName) names.add(session.hostName);
  for (const guest of (session.guests || [])) names.add(guest.name);
  return Array.from(names);
}

function calculateAllPersonTotals(session) {
  const items = session.items || [];
  const tax = session.tax || 0;
  const subtotal = session.subtotal || 0;
  const tipPercent = session.tipPercent;
  const tipIncluded = session.tipIncluded;
  const tipAmount = session.tipAmount;
  const adminFee = session.adminFee;
  const tipMode = session.tipMode || 'percent';
  const tipDollar = Math.max(0, session.tipDollar || 0);

  const names = getAllParticipants(session);
  if (!subtotal || subtotal === 0 || names.length === 0) {
    return Object.fromEntries(names.map(n => [n, { itemsTotal: 0, taxShare: 0, tipShare: 0, adminFeeShare: 0, total: 0, claimedItems: [] }]));
  }

  const itemTotals = {};
  const claimedItemsMap = {};
  for (const name of names) { itemTotals[name] = 0; claimedItemsMap[name] = []; }

  for (const item of items) {
    for (const claim of (item.claims || [])) {
      let share;
      if ((item.quantity || 1) > 1) {
        share = round2(item.price * ((claim.units || 1) / item.quantity));
      } else {
        share = round2(item.price / (claim.splitCount || 1));
      }
      if (itemTotals[claim.guestName] !== undefined) {
        itemTotals[claim.guestName] = round2(itemTotals[claim.guestName] + share);
        claimedItemsMap[claim.guestName].push({ name: item.name, myShare: share });
      }
    }
  }

  const weights = names.map(n => itemTotals[n]);
  const taxShares      = distributeProportionally(tax || 0, weights);
  const adminFeeShares = distributeProportionally(adminFee || 0, weights);
  const includedGratuityShares = tipIncluded ? distributeProportionally(tipAmount || 0, weights) : names.map(() => 0);

  let additionalTipShares;
  if (tipMode === 'dollar') {
    additionalTipShares = distributeProportionally(tipDollar, weights);
  } else if ((tipPercent || 0) > 0) {
    const rawPctTips = weights.map(w => w * ((tipPercent || 0) / 100));
    const pctTipTotal = round2(rawPctTips.reduce((a, b) => a + b, 0));
    additionalTipShares = distributeProportionally(pctTipTotal, weights);
  } else {
    additionalTipShares = names.map(() => 0);
  }

  const result = {};
  names.forEach((name, i) => {
    const iTotal     = itemTotals[name];
    const taxShare   = taxShares[i];
    const adminShare = adminFeeShares[i];
    const tipShare   = round2(includedGratuityShares[i] + additionalTipShares[i]);
    const total      = round2(iTotal + taxShare + tipShare + adminShare);
    result[name] = { itemsTotal: iTotal, taxShare, tipShare, adminFeeShare: adminShare, total, claimedItems: claimedItemsMap[name] };
  });
  return result;
}

// The dollar value of the bill that NOBODY has claimed (fully or partially) —
// the amount the host silently eats unless surfaced. This is the "money truth"
// number the audit flagged as missing.
function calculateUnaccounted(session) {
  const items = session.items || [];
  const subtotal = session.subtotal || 0;
  const tax = session.tax || 0;
  const adminFee = session.adminFee || 0;
  const tipIncluded = session.tipIncluded;
  const tipAmount = session.tipAmount || 0;
  const tipMode = session.tipMode || 'percent';
  const tipDollar = Math.max(0, session.tipDollar || 0);
  const tipPercent = session.tipPercent || 0;

  // Sum of item value actually claimed by someone.
  let claimedItemValue = 0;
  for (const item of items) {
    const claims = item.claims || [];
    if (claims.length === 0) continue;
    if ((item.quantity || 1) > 1) {
      const unitsClaimed = claims.reduce((s, c) => s + (c.units || 0), 0);
      claimedItemValue = round2(claimedItemValue + item.price * (unitsClaimed / item.quantity));
    } else {
      // splitCount declares N ways but only claims.length people actually claimed.
      const splitCount = claims[0]?.splitCount || 1;
      const perShare = item.price / splitCount;
      claimedItemValue = round2(claimedItemValue + perShare * Math.min(claims.length, splitCount));
    }
  }

  const unclaimedItemValue = round2(Math.max(0, subtotal - claimedItemValue));

  // Proportional fees/tip on the unclaimed portion are also unaccounted.
  const proportion = subtotal > 0 ? unclaimedItemValue / subtotal : 0;
  const unaccountedTax = round2(tax * proportion);
  const unaccountedAdmin = round2(adminFee * proportion);
  let unaccountedTip = tipIncluded ? round2(tipAmount * proportion) : 0;
  if (tipMode === 'dollar') unaccountedTip = round2(unaccountedTip + tipDollar * proportion);
  else if (tipPercent > 0) unaccountedTip = round2(unaccountedTip + unclaimedItemValue * (tipPercent / 100));

  const totalUnaccounted = round2(unclaimedItemValue + unaccountedTax + unaccountedAdmin + unaccountedTip);
  return { unclaimedItemValue, totalUnaccounted };
}

module.exports = { round2, distributeProportionally, getAllParticipants, calculateAllPersonTotals, calculateUnaccounted };
