import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/*
 * Global dark/light mode.
 *
 * Three states, not two: 'system' is the default and follows the OS live, so a
 * phone that dims itself at sunset dims the app too. 'light' and 'dark' are
 * explicit overrides.
 *
 * The class goes on <html> (Tailwind's darkMode: 'class'), and index.html has
 * already applied it from localStorage before this module ever runs — this
 * provider keeps it in sync, it does not do the initial paint.
 */

const STORAGE_KEY = 'tourmate.theme';
const ThemeContext = createContext(null);

const isTheme = (v) => v === 'light' || v === 'dark' || v === 'system';

function storedTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = () =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(storedTheme);
  // What is actually on screen: 'system' resolved against the OS setting.
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);

  // Follow the OS while in 'system' mode. addEventListener('change') is the
  // modern API; Safari < 14 only had addListener, hence the fallback.
  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return;
    const onChange = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // Keeps the mobile browser chrome (address bar) in step with the page.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0a0b12' : '#fdf8f3');
  }, [resolved]);

  const setTheme = useCallback((next) => {
    if (!isTheme(next)) return;
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* in-memory only for this tab */
    }
  }, []);

  /**
   * The saved account preference, applied on sign-in — but only on a device that
   * has never been told otherwise. Someone who set dark mode on this laptop
   * keeps it even if their phone saved 'light' to the account.
   */
  const applyRemoteTheme = useCallback((next) => {
    if (!isTheme(next)) return;
    let hasLocalChoice = false;
    try {
      hasLocalChoice = localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      hasLocalChoice = false;
    }
    if (!hasLocalChoice) setThemeState(next);
  }, []);

  /** What the toggle button does: flip what is currently on screen. */
  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, isDark: resolved === 'dark', setTheme, toggle, applyRemoteTheme }),
    [theme, resolved, setTheme, toggle, applyRemoteTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
