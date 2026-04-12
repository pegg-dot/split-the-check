import { createContext, useContext, useReducer, useCallback } from 'react';

const SessionContext = createContext(null);

const initialState = {
  // Host info
  hostName: '',
  venmoHandle: '',

  // Receipt items from AI
  items: [], // { id, name, price, claims: [{ guestName, splitCount }] }

  // Tax
  subtotal: 0,
  tax: 0,

  // Per-person tip percentages: { "Sarah": 20, "Alex": 18 }
  tipPercents: {},

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
      return { ...state, tipPercents: { ...state.tipPercents, [action.name]: action.percent } };
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
        if (existingClaim) return item; // already claimed
        return { ...item, claims: [...item.claims, { guestName: action.guestName, splitCount: action.splitCount }] };
      });
      return { ...state, items };
    }
    case 'UNCLAIM_ITEM': {
      const items = state.items.map(item => {
        if (item.id !== action.itemId) return item;
        return { ...item, claims: item.claims.filter(c => c.guestName !== action.guestName) };
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
      // Hydrate full session from server, preserve currentUser
      const s = action.session;
      return {
        ...state,
        hostName: s.hostName,
        venmoHandle: s.venmoHandle,
        items: s.items,
        subtotal: s.subtotal,
        tax: s.tax,
        tipPercents: s.tipPercents || {},
        sessionId: s.id,
        guests: s.guests,
        payments: s.payments || [],
      };
    }
    case 'SYNC_ITEMS': {
      return { ...state, items: action.items };
    }
    case 'SYNC_GUESTS': {
      return { ...state, guests: action.guests };
    }
    case 'SYNC_TIP_PERCENTS': {
      return { ...state, tipPercents: action.tipPercents };
    }
    case 'SYNC_PAYMENTS': {
      return { ...state, payments: action.payments };
    }
    default:
      return state;
  }
}

// Calculate what a person owes
export function calculatePersonTotal(state, personName, tipPercent) {
  const { items, tax, subtotal } = state;
  const tip = tipPercent ?? state.tipPercents[personName] ?? 18;
  if (!subtotal || subtotal === 0) return { itemsTotal: 0, taxShare: 0, tipPercent: tip, tipShare: 0, total: 0, claimedItems: [] };

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

  // Track unclaimed items separately — don't auto-charge anyone
  const unclaimedItems = items.filter(item => item.claims.length === 0);

  // Tax is proportional to your share of the FULL receipt subtotal
  // Tip is based on your items only
  const proportion = subtotal > 0 ? itemsTotal / subtotal : 0;
  const taxShare = tax * proportion;
  const tipShare = itemsTotal * (tip / 100);
  const total = itemsTotal + taxShare + tipShare;

  return { itemsTotal, taxShare, tipPercent: tip, tipShare, total, claimedItems, unclaimedItems };
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
