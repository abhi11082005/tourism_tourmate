import { useTheme } from '../context/ThemeContext.jsx';

/*
 * Dark/light switch. One button, not a three-way segmented control: the header
 * has no room for it and 'system' is still reachable from dashboard Preferences.
 *
 * Accessibility notes that are easy to get wrong here:
 *   * aria-pressed makes it a toggle button, so a screen reader announces the
 *     state rather than just the name.
 *   * the glyph is aria-hidden and the state lives in the label, otherwise the
 *     announcement is "moon, button".
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl
                  border border-sand-300 text-base transition hover:bg-sand-100
                  dark:border-ink-600 dark:hover:bg-ink-800 ${className}`}
    >
      <span aria-hidden>{isDark ? '☀' : '☾'}</span>
      <span className="sr-only">{isDark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </button>
  );
}
