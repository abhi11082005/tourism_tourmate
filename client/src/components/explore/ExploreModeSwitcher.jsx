import { Compass, Flag } from 'lucide-react';

/*
 * PERSONAL TOUR | GUIDED TOUR. A tablist (the panel it controls is `explore-mode-panel`)
 * with a sliding thumb. The two modes read as different things at a glance: personal is
 * charcoal, guided takes the warm accent.
 */
const TABS = [
  { value: 'personal', label: 'Personal tour', icon: Compass },
  { value: 'guided', label: 'Guided tour', icon: Flag },
];

export default function ExploreModeSwitcher({ mode, onChange }) {
  const index = mode === 'guided' ? 1 : 0;

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' ? Math.min(1, index + 1) : Math.max(0, index - 1);
    onChange(TABS[next].value);
    // Move focus with the selection (roving tabindex pattern).
    document.getElementById(`explore-tab-${TABS[next].value}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Tour mode"
      onKeyDown={onKeyDown}
      className="relative grid grid-cols-2 rounded-2xl bg-sand-100 p-1 dark:bg-ink-800"
    >
      <span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/2)] rounded-xl shadow-md transition-all duration-300 ease-out ${
          index === 0 ? 'bg-ink-800 dark:bg-sand-300' : 'bg-glow'
        }`}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {TABS.map(({ value, label, icon: Icon }) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            id={`explore-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="explore-mode-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(value)}
            className={`relative z-10 flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-200 ${
              selected
                ? value === 'personal'
                  ? 'text-sand-50 dark:text-ink-900'
                  : 'text-white'
                : 'faint hover:text-ink-800 dark:hover:text-sand-50'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
