import { inr } from '../../lib/format.js';
import { computeDeal } from '../../lib/campaign.js';

/*
 * "From ₹X / seat", with the campaign strike-through when a discount campaign was
 * handed to this page. The arithmetic is computeDeal — the same floor-the-discount
 * rule the server uses at checkout — so the number here matches the one the server
 * will charge for the base seat. It is still a display of the campaign; the server
 * prices the booking.
 */

const SIZES = {
  sm: { price: 'text-base', meta: 'text-[11px]' },
  md: { price: 'text-xl', meta: 'text-xs' },
  lg: { price: 'text-3xl', meta: 'text-sm' },
};

export function campaignPercent(discountCampaign) {
  const percent = Number(discountCampaign?.percent);
  return Number.isFinite(percent) && percent > 0 ? percent : 0;
}

export default function PriceTag({ basePrice, discountCampaign, size = 'md', showCampaign = true }) {
  const s = SIZES[size] ?? SIZES.md;
  const percent = campaignPercent(discountCampaign);
  const label = discountCampaign?.label || discountCampaign?.name;
  const deal = percent > 0 ? computeDeal(basePrice, percent) : null;

  if (deal) {
    return (
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`${s.price} font-black tabular-nums text-green-700 dark:text-green-400`}>
            {inr(deal.discounted)}
          </span>
          <span className={`${s.meta} faint`}>/seat</span>
          <span className={`${s.meta} faint tabular-nums line-through`}>{inr(deal.original)}</span>
        </p>
        {showCampaign && (
          <>
            <p className={`${s.meta} mt-0.5 font-semibold text-emerald-700 dark:text-emerald-300`}>
              You save {inr(deal.saved)}
            </p>
            <p className={`${s.meta} font-semibold text-glow`}>
              {percent}% off{label ? ` · ${label}` : ''}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <p className="flex items-baseline gap-1.5">
      <span className={`${s.price} font-black tabular-nums`}>{inr(basePrice)}</span>
      <span className={`${s.meta} faint`}>/seat</span>
    </p>
  );
}
