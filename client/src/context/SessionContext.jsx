import { createContext, useContext, useReducer } from 'react';

const SessionContext = createContext(null);

const initialState = {
  // Host info
  hostName: '',
  venmoHandle: '',

  // Receipt items from AI
  items: [], // { id, name, price, claims: [{ guestName, splitCount }] }

  // Tip & tax (host sets tip for the whole table)
  subtotal: 0,
  tax: 0,
  tipPercent: 18,
  tipMode: 'percent',  // 'percent' or 'dollar'
  tipDollar: 0,        // flat dollar tip amount (when tipMode is 'dollar')
  tipIncluded: false,  // true if receipt already has gratuity
  tipAmount: 0,        // pre-included tip amount from receipt
  adminFee: 0,         // admin/service fee from receipt

  // Currency + exchange rate to USD
  currency: 'USD',
  exchangeRate: 1,
  taxNote: '', // e.g. "Tax included in item prices"

  // Session
  sessionId: null,
  guests: [], // { name, joinedAt }

  // Current user
  currentUser: null, // null = host hasn't started, or { name, isHost }

  // Payment tracking
  payments: [], // { guestName, amount, paid: bool }
};

function sessionReducer(state, action) {
  switch (action.type) {
    case 'SET_HOST': {
      return { ...state, hostName: action.name, venmoHandle: action.venmoHandle, currentUser: { name: action.name, isHost: true } };
    }
    case 'SET_ITEMS': {
      const subtotal = action.items.reduce((sum, item) => sum + item.price, 0);
      return {
        ...state,
        items: action.items.map((item, i) => ({
          ...item,
          id: i,
          claims: [],
          // Preserve quantity/unitPrice from AI scan; default quantity=1
          quantity:  item.quantity  || 1,
          unitPrice: item.unitPrice || item.price,
        })),
        subtotal,
      };
    }
    case 'UPDATE_ITEM': {
      const items = state.items.map(item => item.id === action.id ? { ...item, ...action.updates } : item);
      const subtotal = items.reduce((sum, item) => sum + item.price, 0);
      return { ...state, items, subtotal };
    }
    case 'DELETE_ITEM': {
      const items = state.items.filter(item => item.id !== action.id);
      const subtotal = items.reduce((sum, item) => sum + item.price, 0);
      return { ...state, items, subtotal };
    }
    case 'ADD_ITEM': {
      const newId = Math.max(0, ...state.items.map(i => i.id)) + 1;
      const qty = action.quantity || 1;
      const items = [...state.items, { id: newId, name: action.name, price: action.price, quantity: qty, unitPrice: action.unitPrice || action.price, claims: [] }];
      const subtotal = items.reduce((sum, item) => sum + item.price, 0);
      return { ...state, items, subtotal };
    }
    case 'SET_TAX': {
      return { ...state, tax: action.tax, taxNote: action.taxNote || '' };
    }
    case 'SET_TIP_PERCENT': {
      return { ...state, tipPercent: action.percent };
    }
    case 'SET_TIP_MODE': {
      return { ...state, tipMode: action.mode };
    }
    case 'SET_TIP_DOLLAR': {
      return { ...state, tipDollar: action.amount };
    }
    case 'SET_TIP_INCLUDED': {
      return { ...state, tipIncluded: action.tipIncluded, tipAmount: action.tipAmount || 0 };
    }
    case 'SET_ADMIN_FEE': {
      return { ...state, adminFee: action.adminFee };
    }
    case 'SET_CURRENCY': {
      return { ...state, currency: action.currency || 'USD', exchangeRate: action.exchangeRate || 1 };
    }
    case 'SET_SESSION_ID': {
      return { ...state, sessionId: action.sessionId };
    }
    case 'JOIN_SESSION': {
      return {
        ...state,
        currentUser: { name: action.name, isHost: false },
        guests: [...state.guests, { name: action.name, joinedAt: Date.now() }],
      };
    }
    case 'CLAIM_ITEM': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const existingClaim = item.claims.find(c => c.guestName === action.guestName);
        if (existingClaim) return item;
        const updated = { ...item, claims: [...item.claims, { guestName: action.guestName, splitCount: action.splitCount }] };
        delete updated.dispute;
        return updated;
      });
      return { ...state, items };
    }
    case 'SHARE_ITEM': {
      // Update all existing claims to new splitCount, then add this person's claim
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const alreadyClaimed = item.claims.some(c => c.guestName === action.guestName);
        if (alreadyClaimed) return item;
        const updated = {
          ...item,
          claims: [
            ...item.claims.map(c => ({ ...c, splitCount: action.splitCount })),
            { guestName: action.guestName, splitCount: action.splitCount },
          ],
        };
        delete updated.dispute;
        return updated;
      });
      return { ...state, items };
    }
    case 'UNCLAIM_ITEM': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const updated = { ...item, claims: item.claims.filter(c => c.guestName !== action.guestName) };
        delete updated.dispute;
        return updated;
      });
      return { ...state, items };
    }
    case 'CLAIM_UNITS': {
      // Claim N units from a quantity item (optimistic)
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const totalClaimed = item.claims.reduce((s, c) => s + (c.units || 0), 0);
        const available    = (item.quantity || 1) - totalClaimed;
        const actualUnits  = Math.min(Math.max(1, action.units), available);
        if (actualUnits <= 0) return item;
        const existing = item.claims.find(c => c.guestName === action.guestName);
        const newClaims = existing
          ? item.claims.map(c => c.guestName === action.guestName ? { ...c, units: (c.units || 0) + actualUnits } : c)
          : [...item.claims, { guestName: action.guestName, units: actualUnits }];
        return { ...item, claims: newClaims };
      });
      return { ...state, items };
    }
    case 'UNCLAIM_UNITS': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        return { ...item, claims: item.claims.filter(c => c.guestName !== action.guestName) };
      });
      return { ...state, items };
    }
    case 'DISPUTE_ITEM': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        return { ...item, dispute: { by: action.disputerName } };
      });
      return { ...state, items };
    }
    case 'CANCEL_DISPUTE': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const updated = { ...item };
        delete updated.dispute;
        return updated;
      });
      return { ...state, items };
    }
    case 'MARK_PAID': {
      const payments = state.payments.map(p =>
        p.guestName === action.guestName ? { ...p, paid: true } : p
      );
      return { ...state, payments };
    }
    case 'SET_PAYMENTS': {
      return { ...state, payments: action.payments };
    }
    case 'LOAD_SESSION': {
      const s = action.session;
      return {
        ...state,
        hostName: s.hostName,
        venmoHandle: s.venmoHandle,
        items: s.items,
        subtotal: s.subtotal,
        tax: s.tax,
        tipPercent: s.tipPercent ?? 18,
        tipMode: s.tipMode || 'percent',
        tipDollar: s.tipDollar || 0,
        tipIncluded: s.tipIncluded || false,
        tipAmount: s.tipAmount || 0,
        adminFee: s.adminFee || 0,
        currency: s.currency || 'USD',
        exchangeRate: s.exchangeRate || 1,
        sessionId: s.id,
        guests: s.guests,
        payments: s.payments || [],
      };
    }
    case 'SYNC_ITEMS': {
      const subtotal = action.items.reduce((sum, item) => sum + item.price, 0);
      return { ...state, items: action.items, subtotal };
    }
    case 'SYNC_GUESTS': {
      return { ...state, guests: action.guests };
    }
    case 'SYNC_PAYMENTS': {
      return { ...state, payments: action.payments };
    }
    default:
      return state;
  }
}

// Round to exactly 2 decimal places, eliminating floating point drift
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Calculate what a person owes — all values rounded to 2dp
export function calculatePersonTotal(state, personName) {
  const { items, tax, subtotal, tipPercent, tipIncluded, tipAmount, adminFee } = state;
  if (!subtotal || subtotal === 0) return { itemsTotal: 0, taxShare: 0, tipShare: 0, adminFeeShare: 0, total: 0, claimedItems: [], unclaimedItems: [] };

  let itemsTotal = 0;
  const claimedItems = [];

  for (const item of items) {
    const myClaim = item.claims.find(c => c.guestName === personName);
    if (myClaim) {
      let myShare;
      if ((item.quantity || 1) > 1) {
        // Quantity item: share proportional to units claimed
        myShare = round2(item.price * ((myClaim.units || 1) / item.quantity));
      } else {
        myShare = round2(item.price / (myClaim.splitCount || 1));
      }
      itemsTotal = round2(itemsTotal + myShare);
      claimedItems.push({ ...item, myShare });
    }
  }

  const unclaimedItems = items.filter(item => item.claims.length === 0);

  const proportion = subtotal > 0 ? itemsTotal / subtotal : 0;
  const taxShare   = round2(Math.max(0, (tax || 0) * proportion));
  const adminFeeShare = round2(Math.max(0, (adminFee || 0) * proportion));

  const tipMode   = state.tipMode || 'percent';
  const tipDollar = Math.max(0, state.tipDollar || 0);

  // Included gratuity (from receipt) split proportionally
  let tipShare = tipIncluded ? round2(Math.max(0, (tipAmount || 0) * proportion)) : 0;

  // Additional tip host adds on tip screen (stacks on top of any included gratuity)
  if (tipMode === 'dollar') {
    tipShare = round2(tipShare + Math.max(0, tipDollar * proportion));
  } else if ((tipPercent || 0) > 0) {
    tipShare = round2(tipShare + Math.max(0, itemsTotal * ((tipPercent || 0) / 100)));
  }

  const total = round2(itemsTotal + taxShare + tipShare + adminFeeShare);

  return { itemsTotal, taxShare, tipShare, adminFeeShare, total, claimedItems, unclaimedItems };
}

// Distribute `total` dollars among `weights` proportionally using the largest-remainder
// method so that the per-person amounts always sum to EXACTLY `total` (no $0.01 drift).
export function distributeProportionally(total, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0 || total === 0) return weights.map(() => 0);

  const totalCents = Math.round(total * 100);
  const exactCents = weights.map(w => (w / totalWeight) * totalCents);
  const floored    = exactCents.map(c => Math.floor(c));
  let remainder    = totalCents - floored.reduce((a, b) => a + b, 0);

  // Give leftover cents to whoever has the largest fractional part
  const order = exactCents
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floored[order[k].i] += 1;

  return floored.map(c => c / 100);
}

// Calculate final totals for ALL participants at once using exact cent distribution.
// Use this wherever totals must sum to the receipt grand total (dashboard, summary).
// `calculatePersonTotal` is still fine for live running totals during claiming.
export function calculateAllPersonTotals(state) {
  const { items, tax, subtotal, tipPercent, tipIncluded, tipAmount, adminFee } = state;
  const tipMode   = state.tipMode || 'percent';
  const tipDollar = Math.max(0, state.tipDollar || 0);

  const names = getAllParticipants(state);
  if (!subtotal || subtotal === 0 || names.length === 0) {
    return Object.fromEntries(names.map(n => [n, { itemsTotal: 0, taxShare: 0, tipShare: 0, adminFeeShare: 0, total: 0, claimedItems: [], unclaimedItems: [] }]));
  }

  // Per-person item totals (exact, not rounded yet)
  const itemTotals = {};
  const claimedItemsMap = {};
  for (const name of names) {
    itemTotals[name] = 0;
    claimedItemsMap[name] = [];
  }

  for (const item of items) {
    for (const claim of item.claims) {
      let share;
      if ((item.quantity || 1) > 1) {
        share = round2(item.price * ((claim.units || 1) / item.quantity));
      } else {
        share = round2(item.price / (claim.splitCount || 1));
      }
      if (itemTotals[claim.guestName] !== undefined) {
        itemTotals[claim.guestName] = round2(itemTotals[claim.guestName] + share);
        claimedItemsMap[claim.guestName].push({ ...item, myShare: share });
      }
    }
  }

  const unclaimedItems = items.filter(item => item.claims.length === 0);

  // Weights = each person's item total (proportion of subtotal)
  const weights = names.map(n => itemTotals[n]);

  // Distribute tax, adminFee, and tip using largest-remainder so sums are exact
  const taxShares      = distributeProportionally(tax || 0, weights);
  const adminFeeShares = distributeProportionally(adminFee || 0, weights);

  // Tip: included gratuity + additional tip chosen by host
  const includedGratuityShares = tipIncluded
    ? distributeProportionally(tipAmount || 0, weights)
    : names.map(() => 0);

  let additionalTipShares;
  if (tipMode === 'dollar') {
    additionalTipShares = distributeProportionally(tipDollar, weights);
  } else if ((tipPercent || 0) > 0) {
    // Percent tip is calculated on each person's item total, then distributed
    const rawPctTips = weights.map(w => w * ((tipPercent || 0) / 100));
    const pctTipTotal = round2(rawPctTips.reduce((a, b) => a + b, 0));
    additionalTipShares = distributeProportionally(pctTipTotal, weights);
  } else {
    additionalTipShares = names.map(() => 0);
  }

  const result = {};
  names.forEach((name, i) => {
    const iTotal      = itemTotals[name];
    const taxShare    = taxShares[i];
    const adminShare  = adminFeeShares[i];
    const tipShare    = round2(includedGratuityShares[i] + additionalTipShares[i]);
    const total       = round2(iTotal + taxShare + tipShare + adminShare);
    result[name] = {
      itemsTotal:   iTotal,
      taxShare,
      tipShare,
      adminFeeShare: adminShare,
      total,
      claimedItems: claimedItemsMap[name],
      unclaimedItems,
    };
  });
  return result;
}

// Currency symbol for a given ISO code
export function currencySymbol(code) {
  const map = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', CHF: 'CHF ', CNY: '¥', INR: '₹', MXN: 'MX$' };
  return map[code] || `${code} `;
}

// Format a price in the session's currency — always exactly 2dp, never NaN
export function formatPrice(amount, currency = 'USD') {
  const sym = currencySymbol(currency);
  const safe = isFinite(amount) ? round2(amount) : 0;
  return `${sym}${safe.toFixed(2)}`;
}

// Convert from session currency to USD (for Venmo)
export function toUSD(amount, exchangeRate = 1) {
  return round2(Math.max(0, amount) * Math.max(0, exchangeRate || 1));
}

export function getAllParticipants(state) {
  const names = new Set();
  if (state.hostName) names.add(state.hostName);
  for (const guest of state.guests) names.add(guest.name);
  return Array.from(names);
}

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
