import { PROFILES } from './exploreConfig.js';

/*
 * Walk / Cycle / Drive as a segmented control with a sliding thumb. Native radios again:
 * arrow keys move the selection, and the thumb simply follows the checked index.
 */
export default function TransportSelector({ value, onChange }) {
  const index = Math.max(
    0,
    PROFILES.findIndex((p) => p.value === value)
  );

  return (
    <fieldset>
      <legend className="sr-only">Transport</legend>
      <div className="relative grid grid-cols-3 rounded-2xl bg-sand-100 p-1 dark:bg-ink-800">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-out dark:bg-ink-600"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {PROFILES.map(({ value: v, label, icon: Icon }) => {
          const selected = value === v;
          return (
            <label key={v} className="relative z-10 block cursor-pointer">
              <input
                type="radio"
                name="explore-transport"
                value={v}
                checked={selected}
                onChange={() => onChange(v)}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors duration-200
                            peer-focus-visible:ring-2 peer-focus-visible:ring-glow ${
                              selected ? 'text-ink-900 dark:text-white' : 'faint hover:text-ink-800 dark:hover:text-sand-50'
                            }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
