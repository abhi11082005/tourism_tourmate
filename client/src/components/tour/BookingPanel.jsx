import { Loader2, Lock } from 'lucide-react';
import SeatCalendar from '../SeatCalendar.jsx';
import PriceConfigurator from '../PriceConfigurator.jsx';
import CouponField from '../CouponField.jsx';
import PriceTag from './PriceTag.jsx';

/*
 * The booking flow in one place: date → travellers & options (with the live price
 * breakdown) → coupon → pay. It is presentational — every piece of state and every
 * handler comes from TourDetail, so the desktop rail and the mobile sheet are two
 * frames around the same single source of truth. Only ONE of them is ever mounted.
 *
 * `layout="rail"`  : desktop sidebar. Scrolls internally if taller than the viewport
 *                    and keeps the pay button pinned, so it is never cut off.
 * `layout="sheet"` : inside BottomSheet. Scrolling body + pinned footer that clears
 *                    the home indicator.
 */

function Step({ n, title, children }) {
  return (
    <section aria-label={title}>
      <p className="mb-2 flex items-center gap-2 text-sm font-bold">
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full bg-ink-800 text-[11px] font-black text-sand-50 dark:bg-sand-300 dark:text-ink-900"
        >
          {n}
        </span>
        {title}
      </p>
      {children}
    </section>
  );
}

export function checkoutLabel({ slot, isCheckingOut, isGuest, seatCount }) {
  if (!slot) return 'Pick a date first';
  if (isCheckingOut) return 'Holding your seats…';
  if (isGuest) return 'Sign in to book';
  return `Pay for ${seatCount} ${seatCount === 1 ? 'seat' : 'seats'}`;
}

export default function BookingPanel({
  layout = 'rail',
  tour,
  slot,
  onSelectSlot,
  seatCount,
  onSeatCountChange,
  selection,
  onSelectionChange,
  couponAmount,
  discountCampaign,
  onAppliedCouponChange,
  onCouponAmountChange,
  checkoutError,
  isCheckingOut,
  isGuest,
  onCheckout,
}) {
  const isSheet = layout === 'sheet';

  const fields = (
    <div className={`space-y-5 ${isSheet ? 'px-5 pb-5 pt-1' : 'p-4'}`}>
      <Step n={1} title="Choose a departure">
        <SeatCalendar tourId={tour.id} value={slot} onSelect={onSelectSlot} seatCount={seatCount} />
      </Step>

      <Step n={2} title="Travellers & options">
        <PriceConfigurator
          tour={tour}
          slotId={slot?.slotId}
          seatCount={seatCount}
          onSeatCountChange={onSeatCountChange}
          selected={selection}
          onSelectedChange={onSelectionChange}
          maxSeats={Math.min(20, slot?.availableSeats ?? 20)}
          couponAmount={couponAmount}
          discountCampaign={discountCampaign}
        />
      </Step>

      <CouponField
        tourId={tour.id}
        slotId={slot?.slotId}
        seatCount={seatCount}
        selectedOptions={selection}
        onAppliedChange={onAppliedCouponChange}
        onAmountChange={onCouponAmountChange}
      />
    </div>
  );

  const footer = (
    <div
      className={`shrink-0 space-y-2 border-t border-sand-200 bg-white dark:border-ink-600 dark:bg-ink-900 ${
        isSheet
          ? 'px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]'
          : 'rounded-b-3xl p-4'
      }`}
    >
      {checkoutError && (
        <p className="notice-error" role="alert">
          {checkoutError}
        </p>
      )}

      <button
        type="button"
        className="btn-primary w-full min-h-12 text-base"
        disabled={!slot || isCheckingOut}
        aria-busy={isCheckingOut}
        onClick={onCheckout}
      >
        {isCheckingOut && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {checkoutLabel({ slot, isCheckingOut, isGuest, seatCount })}
      </button>

      <p className="faint flex items-center justify-center gap-1.5 text-center text-xs">
        <Lock className="h-3 w-3" aria-hidden />
        Seats are held for 10 minutes while you pay.
      </p>
    </div>
  );

  if (isSheet) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{fields}</div>
        {footer}
      </div>
    );
  }

  return (
    <section
      aria-label="Book this tour"
      className="flex max-h-[calc(100dvh-var(--hdr,4rem)-2rem)] flex-col rounded-3xl border border-sand-200 bg-sand-100/60 shadow-sm dark:border-ink-600 dark:bg-ink-950/40"
    >
      <div className="shrink-0 px-5 pb-1 pt-5">
        <p className="faint text-[11px] font-bold uppercase tracking-[0.14em]">Reserve your seats</p>
        <div className="mt-1">
          <PriceTag basePrice={tour.base_price} discountCampaign={discountCampaign} size="lg" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{fields}</div>
      {footer}
    </section>
  );
}
