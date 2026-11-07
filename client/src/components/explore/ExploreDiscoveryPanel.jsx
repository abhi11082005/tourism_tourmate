import ExploreHeader from './ExploreHeader.jsx';
import ExploreModeSwitcher from './ExploreModeSwitcher.jsx';
import { GLASS } from './exploreConfig.js';

/*
 * Desktop floating panel (left). The header and mode switcher stay put; only the
 * planner underneath scrolls, so the switcher is never lost on a long route result.
 */
export default function ExploreDiscoveryPanel({ mode, onModeChange, placesLabel, children }) {
  return (
    <aside
      aria-label="Explore planner"
      className={`absolute bottom-4 left-4 top-4 z-10 flex w-[24rem] flex-col overflow-hidden rounded-3xl xl:w-[26rem] ${GLASS}`}
    >
      <div className="shrink-0 space-y-4 border-b border-sand-200/70 p-5 pb-4 dark:border-ink-600/70">
        <ExploreHeader placesLabel={placesLabel} />
        <ExploreModeSwitcher mode={mode} onChange={onModeChange} />
      </div>

      <div
        id="explore-mode-panel"
        role="tabpanel"
        aria-labelledby={`explore-tab-${mode}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"
      >
        {children}
      </div>
    </aside>
  );
}
