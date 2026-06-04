import { describe, it, expect } from 'vitest';
import {
  round2,
  distributeProportionally,
  calculatePersonTotal,
  calculateAllPersonTotals,
  calculateUnaccounted,
  toUSD,
  formatPrice,
  currencySymbol,
} from './SessionContext.jsx';

describe('round2 / distribution', () => {
  it('round2 kills float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it('distributeProportionally sums exactly to total', () => {
    const parts = distributeProportionally(10, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe('per-person totals', () => {
  const state = {
    hostName: 'Host',
    guests: [{ name: 'A' }, { name: 'B' }],
    subtotal: 30, tax: 3, tipPercent: 20, tipMode: 'percent', adminFee: 0,
    items: [
      { id: 0, name: 'Burger', price: 20, claims: [{ guestName: 'A', splitCount: 1 }] },
      { id: 1, name: 'Salad', price: 10, claims: [{ guestName: 'B', splitCount: 1 }] },
    ],
  };

  it('calculatePersonTotal matches expected (A=26, B=13)', () => {
    expect(calculatePersonTotal(state, 'A').total).toBe(26);
    expect(calculatePersonTotal(state, 'B').total).toBe(13);
  });

  it('calculateAllPersonTotals sums to grand total', () => {
    const t = calculateAllPersonTotals(state);
    expect(round2(t.A.total + t.B.total)).toBe(39);
  });

  it('client and server math agree on the "split 3 ways, 1 claimer" case', () => {
    const s = {
      hostName: 'Host', guests: [{ name: 'A' }],
      subtotal: 30, tax: 0, tipPercent: 0,
      items: [{ id: 0, name: 'Platter', price: 30, claims: [{ guestName: 'A', splitCount: 3 }] }],
    };
    expect(calculateUnaccounted(s).totalUnaccounted).toBe(20);
  });
});

describe('currency helpers', () => {
  it('toUSD applies exchange rate, clamps negatives', () => {
    expect(toUSD(10, 1.1)).toBe(11);
    expect(toUSD(-5, 1)).toBe(0);
  });
  it('formatPrice never returns NaN', () => {
    expect(formatPrice(NaN, 'USD')).toBe('$0.00');
    expect(formatPrice(4.5, 'EUR')).toBe('€4.50');
  });
  it('currencySymbol falls back to code', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('SEK')).toBe('SEK ');
  });
});
