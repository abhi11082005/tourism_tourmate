import { inr } from '../lib/format.js';
import { hasPriceRange } from './TourBits.jsx';

/*
 * Display-only price transparency. Only rendered when the detail API returned
 * optional add-ons; otherwise the card's existing TourPrice is all that shows.
 * Nothing is summed here: the "fully loaded" figure is the server's max_price,
 * and the real total is always the one confirmed at checkout.
 */
export default function TourPriceBreakdown({ tour, discount = null, options }) {
  if (!options?.length) return null;

  return (
    <section aria-labelledby="qv-price">
      <h3 id="qv-price" className="text-sm font-semibold">
        Price details
      </h3>
      <dl className="mt-2 divide-y divide-sand-100 rounded-xl border border-sand-100 text-sm dark:divide-ink-700 dark:border-ink-700">
        <div className="flex items-start justify-between gap-3 p-3">
          <dt>
            Included base price
            <span className="block text-xs faint">per seat</span>
          </dt>
          <dd className="text-right">
            {discount ? (
              <>
                <strong className="text-green-700 dark:text-green-400">{inr(discount.discounted)}</strong>{' '}
                <s className="text-xs faint">{inr(discount.original)}</s>
                <span className="block text-[11px] font-semibold text-glow">
                  {discount.percent}% off · {discount.label}
                </span>
              </>
            ) : (
              <strong>{inr(tour.base_price)}</strong>
            )}
          </dd>
        </div>

        <div className="p-3">
          <dt className="text-xs font-semibold uppercase tracking-wider faint">Optional add-ons</dt>
          <dd>
            <ul className="mt-2 space-y-1.5">
              {options.map((o) => (
                <li key={o.id ?? o.name} className="flex items-center justify-between gap-3">
                  <span>{o.name}</span>
                  <span className="shrink-0 tabular-nums">+{inr(o.price)}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>

        {hasPriceRange(tour) && (
          <div className="flex items-start justify-between gap-3 p-3">
            <dt>
              Estimated fully loaded
              <span className="block text-xs faint">with every add-on, per seat</span>
            </dt>
            <dd className="text-right font-semibold">up to {inr(tour.max_price)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs faint">The final amount is confirmed at checkout.</p>
    </section>
  );
}