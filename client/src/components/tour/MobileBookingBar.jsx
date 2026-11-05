import { shortDate } from '../../lib/format.js';
import PriceTag from './PriceTag.jsx';

/*
 * Fixed booking bar for screens without the desktop rail (< lg).
 *
 * Position: on phones the app shell already pins a tab bar to the bottom (4rem), so
 * this sits directly on top of it; from md up that tab bar is gone and the bar sits
 * at the screen edge, padded for the home indicator.
 */

export default function MobileBookingBar({ basePrice, discountCampaign, slot, seatCount, onOpen }) {
  return (
    <div
      className="fixed inset-x-0 bottom-16 z-30 border-t border-sand-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(18,20,31,0.25)]
                 backdrop-blur md:bottom-0 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden
                 dark:border-ink-600 dark:bg-ink-900/95"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="min-w-0">
          {slot ? (
            <>
              <p className="truncate text-sm font-bold">
                {shortDate(slot.date)} · {seatCount} {seatCount === 1 ? 'traveller' : 'travellers'}
              </p>
              <p className="faint text-[11px]">Tap to review price</p>
            </>
          ) : (
            <>
              <p className="faint text-[11px] font-semibold uppercase tracking-wide">From</p>
              <PriceTag
                basePrice={basePrice}
                discountCampaign={discountCampaign}
                size="md"
                showCampaign={false}
              />
            </>
          )}
        </div>

        <button type="button" className="btn-primary shrink-0 px-6" onClick={onOpen}>
          Book this trip
        </button>
      </div>
    </div>
  );
}
