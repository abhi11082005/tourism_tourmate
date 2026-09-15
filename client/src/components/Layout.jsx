import { useEffect } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import AccountMenu from './AccountMenu.jsx';
import LocationBanner from './LocationBanner.jsx';

/*
 * Mobile-first shell: a bottom tab bar on phones (thumb reach), a top bar from
 * `md` up. Both render from one nav array so they can never drift apart.
 *
 * Signing in adds a fifth tab (Dashboard) rather than replacing one, so the
 * shape of the app does not change under the user — and the desktop header swaps
 * the bare name for AccountMenu, which is where the dashboard sub-pages live.
 */

const GUEST_TABS = [
  { to: '/', label: 'Tours', icon: '◎', end: true },
  { to: '/explore', label: 'Explore', icon: '⌖' },
  { to: '/dashboard/saved', label: 'Saved', icon: '♡' },
  { to: '/dashboard/trips', label: 'Trips', icon: '✓' },
];

// Appended for signed-in users only: RequireAuth would bounce a guest straight
// to /login, and a tab that always redirects is not a tab.
const DASHBOARD_TAB = { to: '/dashboard', label: 'Account', icon: '☰', end: true };

const topLink = ({ isActive }) =>
  `rounded-xl px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-ink-800 text-sand-50 dark:bg-ink-200 '
      : 'hover:bg-sand-100 dark:hover:bg-ink-800'
  }`;

export default function Layout() {
  const { user, isGuest, isAdmin } = useAuth();
  const { applyRemoteTheme } = useTheme(); 
  const savedTheme = user?.preferences?.theme;

  // The account's saved theme is an offer, not an order — applyRemoteTheme
  // ignores it when this device already has a choice of its own.
  useEffect(() => {
    if (savedTheme) applyRemoteTheme(savedTheme);
  }, [savedTheme, applyRemoteTheme]);

  const tabs = isGuest ? GUEST_TABS : [...GUEST_TABS, DASHBOARD_TAB];

  return (
    <div className="flex min-h-dvh flex-col ">
      <header
        className="sticky top-0 z-20 border-b border-sand-100 bg-sand-50/95 backdrop-blur
                   dark:border-ink-700 dark:bg-ink-900"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4">
          <Link to="/" className="text-lg font-black tracking-tight">
            Tour<span className="text-glow">Mate</span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
            {GUEST_TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={topLink}>
                {t.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink to="/admin" className={topLink}>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeToggle />
            {isGuest ? (
              <Link to="/login" className="btn-primary">
                Sign in
              </Link>
            ) : (
              <AccountMenu />
            )}
          </div>
        </div>

        {isGuest && (
          <p className="muted bg-sand-100 px-4 py-1.5 text-center text-xs dark:bg-ink-900">
            Browsing as a guest — you only need an account when you pay.
          </p>
        )}
      </header>

      {/* Only renders when the browser refused a location and no city is saved. */}
      <LocationBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 md:pb-10">
        <Outlet />
      </main>

      {/* Bottom tab bar, phones only. pb-safe keeps it clear of the home bar. */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-20 grid border-t border-sand-100 bg-white/95
                    backdrop-blur dark:border-ink-700 dark:bg-ink-900/95 md:hidden ${
                      isGuest ? 'grid-cols-4' : 'grid-cols-5'
                    }`}
        aria-label="Main"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] ${
                isActive
                  ? 'font-semibold text-ink-900 dark:text-sand-50'
                  : 'text-sand-500 dark:text-sand-400'
              }`
            }
          >
            <span aria-hidden className="text-lg leading-none">
              {t.icon}
            </span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
