const { test } = require('node:test');
const assert = require('node:assert');
const { round2, distributeProportionally, calculateAllPersonTotals, calculateUnaccounted } = require('../lib/totals');

test('round2 eliminates float drift', () => {
  assert.strictEqual(round2(0.1 + 0.2), 0.3);
  assert.strictEqual(round2(1.005), 1.01);
});

test('distributeProportionally sums EXACTLY to total (no penny drift)', () => {
  const parts = distributeProportionally(10, [1, 1, 1]);
  assert.strictEqual(parts.reduce((a, b) => a + b, 0), 10);
  // largest-remainder gives the extra cent to one person
  assert.deepStrictEqual([...parts].sort(), [3.33, 3.33, 3.34]);
});

test('distributeProportionally handles zero total/weights', () => {
  assert.deepStrictEqual(distributeProportionally(0, [1, 2]), [0, 0]);
  assert.deepStrictEqual(distributeProportionally(10, [0, 0]), [0, 0]);
});

test('calculateAllPersonTotals: two guests, tax + 20% tip sum to grand total', () => {
  const session = {
    hostName: 'Host',
    guests: [{ name: 'A' }, { name: 'B' }],
    subtotal: 30,
    tax: 3,
    tipPercent: 20,
    tipMode: 'percent',
    items: [
      { id: 0, name: 'Burger', price: 20, claims: [{ guestName: 'A', splitCount: 1 }] },
      { id: 1, name: 'Salad', price: 10, claims: [{ guestName: 'B', splitCount: 1 }] },
    ],
  };
  const totals = calculateAllPersonTotals(session);
  // A: 20 items + tax(2) + tip(4) = 26 ; B: 10 + 1 + 2 = 13 ; sum 39
  const sum = round2(totals.A.total + totals.B.total);
  assert.strictEqual(sum, 39);
  assert.strictEqual(totals.A.total, 26);
  assert.strictEqual(totals.B.total, 13);
});

test('calculateUnaccounted: a fully unclaimed item is flagged with its value', () => {
  const session = {
    hostName: 'Host', guests: [{ name: 'A' }],
    subtotal: 30, tax: 0, tipPercent: 0,
    items: [
      { id: 0, name: 'Burger', price: 20, claims: [{ guestName: 'A', splitCount: 1 }] },
      { id: 1, name: 'Wine', price: 10, claims: [] }, // nobody claimed
    ],
  };
  const { totalUnaccounted } = calculateUnaccounted(session);
  assert.strictEqual(totalUnaccounted, 10);
});

test('calculateUnaccounted: "split 3 ways" with only 1 claimer leaves 2/3 unaccounted', () => {
  const session = {
    hostName: 'Host', guests: [{ name: 'A' }],
    subtotal: 30, tax: 0, tipPercent: 0,
    items: [
      { id: 0, name: 'Platter', price: 30, claims: [{ guestName: 'A', splitCount: 3 }] },
    ],
  };
  const { totalUnaccounted } = calculateUnaccounted(session);
  assert.strictEqual(totalUnaccounted, 20); // 2 of the 3 shares never claimed
});

test('calculateUnaccounted: everything claimed → 0', () => {
  const session = {
    hostName: 'Host', guests: [{ name: 'A' }, { name: 'B' }],
    subtotal: 30, tax: 3, tipPercent: 18,
    items: [
      { id: 0, name: 'Burger', price: 20, claims: [{ guestName: 'A', splitCount: 1 }] },
      { id: 1, name: 'Salad', price: 10, claims: [{ guestName: 'B', splitCount: 1 }] },
    ],
  };
  assert.strictEqual(calculateUnaccounted(session).totalUnaccounted, 0);
});

test('quantity item: per-unit shares split correctly', () => {
  const session = {
    hostName: 'Host', guests: [{ name: 'A' }, { name: 'B' }],
    subtotal: 18, tax: 0, tipPercent: 0,
    items: [
      { id: 0, name: 'Beer', price: 18, quantity: 4, unitPrice: 4.5,
        claims: [{ guestName: 'A', units: 3 }, { guestName: 'B', units: 1 }] },
    ],
  };
  const t = calculateAllPersonTotals(session);
  assert.strictEqual(t.A.total, 13.5);
  assert.strictEqual(t.B.total, 4.5);
});
