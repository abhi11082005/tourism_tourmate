import { ShieldCheck } from 'lucide-react';

/*
 * Cancellation tiers, straight from tour.refund_policy. Nothing is derived beyond
 * ordering (longest notice first): no implied "no refund after…" row, no invented
 * fees. If the tour defines no tiers, the section does not render at all.
 */

export default function CancellationPolicy({ tiers }) {
  const rows = [...(tiers ?? [])]
    .filter((t) => t && t.daysBefore != null && t.refundPercent != null)
    .sort((a, b) => Number(b.daysBefore) - Number(a.daysBefore));
  if (!rows.length) return null;

  return (
    <section
      aria-label="Cancellation policy"
      className="rounded-2xl border border-sand-200 bg-white p-5 dark:border-ink-600 dark:bg-ink-900"
    >
      <h3 className="flex items-center gap-2 text-base font-bold">
        <ShieldCheck className="h-5 w-5 text-sand-600 dark:text-sand-300" aria-hidden />
        Cancellation policy
      </h3>

      <ol className="mt-4 space-y-4">
        {rows.map((tier) => {
          const pct = Math.max(0, Math.min(100, Number(tier.refundPercent)));
          return (
            <li key={tier.daysBefore}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{tier.daysBefore}+ days before departure</span>
                <span className="font-bold tabular-nums">{tier.refundPercent}% refunded</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand-100 dark:bg-ink-800"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
