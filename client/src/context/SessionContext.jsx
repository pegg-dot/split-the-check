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
      return { ...state, items: action.items.map((item, i) => ({ ...item, id: i, claims: [] })), subtotal };
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
      const items = [...state.items, { id: newId, name: action.name, price: action.price, claims: [] }];
      const subtotal = items.reduce((sum, item) => sum + item.price, 0);
      return { ...state, items, subtotal };
    }
    case 'SET_TAX': {
      return { ...state, tax: action.tax };
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
    case 'UNCLAIM_ITEM': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        const updated = { ...item, claims: item.claims.filter(c => c.guestName !== action.guestName) };
        delete updated.dispute;
        return updated;
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

// Calculate what a person owes
export function calculatePersonTotal(state, personName) {
  const { items, tax, subtotal, tipPercent, tipIncluded, tipAmount, adminFee } = state;
  if (!subtotal || subtotal === 0) return { itemsTotal: 0, taxShare: 0, tipShare: 0, adminFeeShare: 0, total: 0, claimedItems: [], unclaimedItems: [] };

  let itemsTotal = 0;
  const claimedItems = [];

  for (const item of items) {
    const myClaim = item.claims.find(c => c.guestName === personName);
    if (myClaim) {
      const myShare = item.price / myClaim.splitCount;
      itemsTotal += myShare;
      claimedItems.push({ ...item, myShare });
    }
  }

  const unclaimedItems = items.filter(item => item.claims.length === 0);

  const proportion = subtotal > 0 ? itemsTotal / subtotal : 0;
  const taxShare = tax * proportion;
  const adminFeeShare = (adminFee || 0) * proportion;

  const tipMode = state.tipMode || 'percent';
  const tipDollar = state.tipDollar || 0;

  // If tip is already included on the receipt, split the fixed tip amount proportionally
  // If dollar mode, split the flat dollar amount proportionally
  // Otherwise, calculate tip as a percentage of items
  let tipShare;
  if (tipIncluded) {
    tipShare = (tipAmount || 0) * proportion;
  } else if (tipMode === 'dollar') {
    tipShare = Math.max(0, tipDollar) * proportion;
  } else {
    tipShare = itemsTotal * (Math.max(0, tipPercent) / 100);
  }

  const total = itemsTotal + taxShare + tipShare + adminFeeShare;

  return { itemsTotal, taxShare, tipShare, adminFeeShare, total, claimedItems, unclaimedItems };
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
