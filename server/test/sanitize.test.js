const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeScan, num, normalizeCurrency } = require('../lib/sanitize');

test('num coerces strings, symbols, and EU decimal commas', () => {
  assert.strictEqual(num('12.99'), 12.99);
  assert.strictEqual(num('$12.99'), 12.99);
  assert.strictEqual(num('18,00'), 18.0);   // EU decimal comma
  assert.strictEqual(num(12.5), 12.5);
});

test('num clamps NaN/negative/garbage to 0', () => {
  assert.strictEqual(num('abc'), 0);
  assert.strictEqual(num(-5), 0);
  assert.strictEqual(num(NaN), 0);
  assert.strictEqual(num(undefined), 0);
});

test('sanitizeScan drops junk rows and coerces prices (no NaN reaches client)', () => {
  const out = sanitizeScan({
    items: [
      { name: 'Latte', price: '4.50' },
      { name: '', price: 0 },          // junk → dropped
      { name: 'Beer', price: 'oops' }, // unparseable → price 0, kept (has name)
    ],
    tax: '2.00',
    currency: 'usd',
  });
  assert.strictEqual(out.items.length, 2);
  assert.strictEqual(out.items[0].price, 4.5);
  assert.strictEqual(out.items[1].price, 0);
  assert.strictEqual(out.tax, 2);
  assert.strictEqual(out.currency, 'USD');
  // every price is a finite number
  assert.ok(out.items.every(i => Number.isFinite(i.price)));
});

test('sanitizeScan preserves valid quantity items and clamps quantity', () => {
  const out = sanitizeScan({ items: [{ name: 'Beer', price: 18, quantity: 4, unitPrice: 4.5 }] });
  assert.strictEqual(out.items[0].quantity, 4);
  assert.strictEqual(out.items[0].unitPrice, 4.5);
  const clamped = sanitizeScan({ items: [{ name: 'X', price: 1000, quantity: 999 }] });
  assert.strictEqual(clamped.items[0].quantity, 99);
});

test('sanitizeScan turns "tip included but $0" into not-included', () => {
  const out = sanitizeScan({ items: [{ name: 'A', price: 5 }], tipIncluded: true, tipAmount: 0 });
  assert.strictEqual(out.tipIncluded, false);
});

test('normalizeCurrency defaults invalid to USD', () => {
  assert.strictEqual(normalizeCurrency('eur'), 'EUR');
  assert.strictEqual(normalizeCurrency('€'), 'USD');
  assert.strictEqual(normalizeCurrency(null), 'USD');
});
