import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../src/services/pricing.service.js';

/*
 * Pricing is the one place where a rounding slip becomes a failed payment: the
 * gateway signs the amount we send, so a paisa of float drift breaks the
 * signature check at confirm time. These tests pin the integer-paise behaviour.
 */

const tour = {
  base_price: '2500.00', // Postgres NUMERIC arrives as a string
  options: {
    photographer: { label: 'Photographer', type: 'boolean', pricePerSeat: 400 },
    transport: {
      label: 'Transport',
      type: 'enum',
      default: 'shared',
      choices: [
        { value: 'shared', label: 'Shared van', pricePerSeat: 0 },
        { value: 'private', label: 'Private car', pricePerSeat: 900 },
      ],
    },
  },
};

test('base fare multiplies by seats and keeps two decimals', () => {
  const { totalAmount, breakdown } = computeQuote({ tour, seatCount: 3 });
  assert.equal(totalAmount, '7500.00');
  assert.equal(breakdown.lines.length, 1);
  assert.equal(breakdown.lines[0].perSeat, '2500.00');
});

test('slot price modifier is per seat, and may be negative', () => {
  assert.equal(computeQuote({ tour, seatCount: 2, priceModifier: '250.50' }).totalAmount, '5501.00');
  assert.equal(computeQuote({ tour, seatCount: 2, priceModifier: -500 }).totalAmount, '4000.00');
});

test('a zero-cost enum choice adds no line', () => {
  const { totalAmount, breakdown } = computeQuote({
    tour,
    seatCount: 1,
    selectedOptions: { transport: 'shared' },
  });
  assert.equal(totalAmount, '2500.00');
  assert.equal(breakdown.lines.length, 1);
});

test('paid options are charged per seat', () => {
  const { totalAmount } = computeQuote({
    tour,
    seatCount: 2,
    selectedOptions: { transport: 'private', photographer: true },
  });
  // (2500 + 900 + 400) * 2
  assert.equal(totalAmount, '7600.00');
});

test('an enum default applies even when the client sends nothing', () => {
  const withDefault = {
    base_price: '1000',
    options: {
      meals: {
        type: 'enum',
        default: 'veg',
        choices: [{ value: 'veg', pricePerSeat: 300 }],
      },
    },
  };
  assert.equal(computeQuote({ tour: withDefault, seatCount: 1 }).totalAmount, '1300.00');
});

test('unknown options and bad values are rejected, not silently dropped', () => {
  assert.throws(() => computeQuote({ tour, seatCount: 1, selectedOptions: { spa: true } }), {
    status: 400,
  });
  assert.throws(
    () => computeQuote({ tour, seatCount: 1, selectedOptions: { transport: 'helicopter' } }),
    { status: 400 }
  );
  assert.throws(
    () => computeQuote({ tour, seatCount: 1, selectedOptions: { photographer: 'yes' } }),
    { status: 400 }
  );
});

test('seat count must be a positive whole number', () => {
  for (const seatCount of [0, -2, 1.5, '2']) {
    assert.throws(() => computeQuote({ tour, seatCount }), { status: 400 });
  }
});

test('fractional prices do not drift over many seats', () => {
  const odd = { base_price: '0.07', options: {} };
  assert.equal(computeQuote({ tour: odd, seatCount: 3 }).totalAmount, '0.21');
});
