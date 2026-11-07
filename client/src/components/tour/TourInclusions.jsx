import { Check, X } from 'lucide-react';

/*
 * "What's included" / "Not included". Each list renders only when the tour has
 * entries for it, so a tour with no exclusions doesn't show an empty box.
 */

function Column({ title, items, tone }) {
  if (!items.length) return null;
  const included = tone === 'in';
  const Icon = included ? Check : X;

  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-sand-200 bg-white p-5 dark:border-ink-600 dark:bg-ink-900"
    >
      <h3 className="flex items-center gap-2 text-base font-bold">
        <span
          className={`grid h-6 w-6 place-items-center rounded-full ${
            included
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
          }`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
        </span>
        {title}
      </h3>
      <ul className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-start gap-3 text-sm leading-relaxed">
            <Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                included ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
              }`}
              aria-hidden
            />
            <span className="muted">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TourInclusions({ inclusions, exclusions }) {
  const included = (inclusions ?? []).filter(Boolean);
  const excluded = (exclusions ?? []).filter(Boolean);
  if (!included.length && !excluded.length) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Column title="What's included" items={included} tone="in" />
      <Column title="Not included" items={excluded} tone="out" />
    </div>
  );
}
