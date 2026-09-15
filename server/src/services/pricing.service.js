import { badRequest } from '../utils/httpError.js';

/*
 * Dynamic pricing. tours.options (JSONB) is the only source of prices:
 *
 *   { "ac":       { "label": "...", "type": "boolean", "pricePerSeat": 900 },
 *     "mealPlan": { "label": "...", "type": "enum", "default": "none",
 *                   "choices": [ { "value": "veg", "pricePerSeat": 1200 }, ... ] } }
 *
 * All arithmetic runs in integer paise (1/100 of a rupee). Floating-point rupees
 * drift by a paisa on ~2% of totals, which then fails gateway signature checks.
 */

const toPaise = (value) => {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw badRequest('Price configuration is invalid');
  return Math.round(n * 100);
};
const toRupeeString = (paise) => (paise / 100).toFixed(2);

/**
 * @param {object}  tour            row from tours (base_price, options)
 * @param {object}  selectedOptions client's choices, e.g. { ac: true, mealPlan: 'veg' }
 * @param {number}  seatCount
 * @param {number|string} priceModifier  per-seat seasonal adjustment from the slot
 * @returns {{ totalAmount: string, breakdown: object }}
 */
export function computeQuote({ tour, selectedOptions = {}, seatCount, priceModifier = 0 }) {
  if (!Number.isInteger(seatCount) || seatCount < 1) {
    throw badRequest('seatCount must be a positive whole number');
  }

  const catalogue = tour.options ?? {};
  const unknown = Object.keys(selectedOptions).filter((k) => !(k in catalogue));
  if (unknown.length) {
    throw badRequest(`Unknown option(s): ${unknown.join(', ')}`);
  }

  const basePerSeat = toPaise(tour.base_price) + toPaise(priceModifier);
  const lines = [
    { key: 'base', label: 'Base fare', perSeat: basePerSeat, amount: basePerSeat * seatCount },
  ];

  for (const [key, spec] of Object.entries(catalogue)) {
    const chosen = selectedOptions[key];

    if (spec.type === 'boolean') {
      if (chosen === undefined || chosen === false) continue;
      if (chosen !== true) throw badRequest(`Option "${key}" expects true or false`);
      const perSeat = toPaise(spec.pricePerSeat ?? 0);
      lines.push({ key, label: spec.label ?? key, perSeat, amount: perSeat * seatCount });
      continue;
    }

    if (spec.type === 'enum') {
      const value = chosen ?? spec.default;
      if (value === undefined) continue;
      const choice = (spec.choices ?? []).find((c) => c.value === value);
      if (!choice) {
        const allowed = (spec.choices ?? []).map((c) => c.value).join(', ');
        throw badRequest(`Option "${key}" must be one of: ${allowed}`);
      }
      if (!choice.pricePerSeat) continue;
      const perSeat = toPaise(choice.pricePerSeat);
      lines.push({
        key,
        label: `${spec.label ?? key}: ${choice.label ?? choice.value}`,
        perSeat,
        amount: perSeat * seatCount,
      });
      continue;
    }

    throw badRequest(`Option "${key}" has an unsupported type "${spec.type}"`);
  }

  const totalPaise = lines.reduce((sum, l) => sum + l.amount, 0);

  return {
    totalAmount: toRupeeString(totalPaise),
    breakdown: {
      seatCount,
      currency: 'INR',
      lines: lines.map((l) => ({
        key: l.key,
        label: l.label,
        perSeat: toRupeeString(l.perSeat),
        amount: toRupeeString(l.amount),
      })),
      total: toRupeeString(totalPaise),
    },
  };
}
