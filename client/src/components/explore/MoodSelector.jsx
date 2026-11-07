import { Check } from 'lucide-react';
import { MOODS } from './exploreConfig.js';

/*
 * Mood cards. Native radio inputs under the hood, so arrow keys, Tab order and screen
 * reader semantics come from the browser; the card is just the visible face.
 */
export default function MoodSelector({ value, onChange }) {
  return (
    <fieldset>
      <legend className="sr-only">Route mood</legend>
      <div className="grid grid-cols-2 gap-2">
        {MOODS.map(({ value: v, label, description, icon: Icon }) => {
          const selected = value === v;
          return (
            <label key={v} className="block cursor-pointer">
              <input
                type="radio"
                name="explore-mood"
                value={v}
                checked={selected}
                onChange={() => onChange(v)}
                className="peer sr-only"
              />
              <span
                className={`relative flex h-full flex-col gap-2 rounded-2xl border p-3 transition-all duration-200
                            peer-focus-visible:ring-2 peer-focus-visible:ring-glow peer-focus-visible:ring-offset-2 ${
                              selected
                                ? 'border-ink-800 bg-white shadow-md dark:border-sand-300 dark:bg-ink-800'
                                : 'border-sand-200 bg-white/60 hover:-translate-y-px hover:border-sand-300 hover:bg-white dark:border-ink-600 dark:bg-ink-800/50 dark:hover:bg-ink-800'
                            }`}
              >
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 ${
                    selected
                      ? 'bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900'
                      : 'bg-sand-100 text-sand-700 dark:bg-ink-700 dark:text-sand-300'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-bold">{label}</span>
                  <span className="muted block text-xs leading-snug">{description}</span>
                </span>
                <span
                  aria-hidden
                  className={`absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-glow text-white transition-all duration-200 ${
                    selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
