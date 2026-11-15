import { inr } from '../../lib/format.js';

/*
 * The price block for a discounted tour on a photo (white-on-dark): sale price first
 * and largest, the original struck through, and the saving stated in rupees so
 * nobody has to do the subtraction. Display only — `deal` comes from discountFor()
 * (or computeDeal in the admin preview); nothing here computes a price.
 */
export default function DealPrice({ deal, className = '' }) {
  return (
    <div className={`min-w-0 leading-tight ${className}`}>
      <p className="flex items-baseline gap-1.5">
        <span className="sr-only">Sale price </span>
        <span className="text-2xl font-black tabular-nums sm:text-[1.7rem]">{inr(deal.discounted)}</span>
        <span className="text-xs text-white/70">/seat</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="sr-only">Original price </span>
        <s className="tabular-nums text-white/60">{inr(deal.original)}</s>
        <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 font-semibold text-emerald-200">
          You save {inr(deal.saved)}
        </span>
      </p>
    </div>
  );
}
