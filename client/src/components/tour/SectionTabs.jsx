/*
 * Sticky section navigation (Itinerary · Map · Reviews). It scrolls to the section
 * and reflects the one currently in view. It sits directly under the app's own top
 * bar — `--hdr` is that bar's measured height — and never overlaps content because
 * every section carries a matching scroll-margin-top.
 */
export default function SectionTabs({ tabs, active, onSelect }) {
  return (
    <nav
      aria-label="Tour sections"
      className="sticky top-[var(--hdr,4rem)] z-10 -mx-4 border-b border-sand-200 bg-sand-50/95 px-4 backdrop-blur
                 md:mx-0 md:px-0 dark:border-ink-600 dark:bg-ink-900/95"
    >
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ id, label }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={isActive ? 'true' : undefined}
                className={`relative min-h-12 whitespace-nowrap px-4 text-sm font-semibold transition-colors ${
                  isActive ? 'text-ink-900 dark:text-white' : 'faint hover:text-ink-800 dark:hover:text-sand-50'
                }`}
              >
                {label}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-glow transition-opacity ${
                    isActive ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
