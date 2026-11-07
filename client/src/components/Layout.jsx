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

  useEffect(() => {
    if (savedTheme) applyRemoteTheme(savedTheme);
  }, [savedTheme, applyRemoteTheme]);

  const tabs = isGuest ? GUEST_TABS : [...GUEST_TABS, DASHBOARD_TAB];

  return (
    <div className="flex min-h-dvh flex-col">
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

      <LocationBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4">
        <Outlet />
      </main>

      {/* Expanded Multi-Column Footer */}
      <footer className="mt-12 border-t border-sand-200 bg-sand-50 pt-12 dark:border-ink-800 dark:bg-ink-950">
        <div className="mx-auto max-w-6xl px-4 pb-10">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
            
            {/* Column 1: Logo */}
            <div>
              <Link to="/" className="text-3xl font-black tracking-tight text-ink-900 dark:text-sand-50">
                Tour<span className="text-glow">Mate</span>
              </Link>
            </div>

            {/* Column 2: About Us & Blog */}
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">About Us</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-sand-600 dark:text-sand-400">
                  <li><Link to="/about" className="hover:text-ink-900 dark:hover:text-sand-50">About Us</Link></li>
                  <li><Link to="/different" className="hover:text-ink-900 dark:hover:text-sand-50">What Makes Us Different</Link></li>
                  <li><Link to="/people" className="hover:text-ink-900 dark:hover:text-sand-50">Our People</Link></li>
                  <li><Link to="/giving" className="hover:text-ink-900 dark:hover:text-sand-50">Giving Back</Link></li>
                  <li><Link to="/contact" className="hover:text-ink-900 dark:hover:text-sand-50">Contact Us</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">Blog</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-sand-600 dark:text-sand-400">
                  <li><Link to="/blog/kings-day" className="hover:text-ink-900 dark:hover:text-sand-50">TourMate's Guide to King's Day</Link></li>
                </ul>
              </div>
            </div>

            {/* Column 3: Collections */}
            <div>
              <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">Collections</h3>
              <ul className="flex flex-col gap-2.5 text-sm text-sand-600 dark:text-sand-400">
                <li><Link to="/collections/discounts" className="hover:text-ink-900 dark:hover:text-sand-50">Discounts/Specials</Link></li>
                <li><Link to="/collections/private" className="hover:text-ink-900 dark:hover:text-sand-50">Private + Tailor-Made</Link></li>
                <li><Link to="/collections/luxury" className="hover:text-ink-900 dark:hover:text-sand-50">Luxury Tours</Link></li>
                <li><Link to="/collections/tulip" className="hover:text-ink-900 dark:hover:text-sand-50">Tulip Tours</Link></li>
                <li><Link to="/collections/favorites" className="hover:text-ink-900 dark:hover:text-sand-50">Staff Favorites</Link></li>
                <li><Link to="/collections/traveler-favorites" className="hover:text-ink-900 dark:hover:text-sand-50">Traveler Favorites</Link></li>
                <li><Link to="/collections/electric" className="hover:text-ink-900 dark:hover:text-sand-50">Electric Bike Tours</Link></li>
                <li><Link to="/collections/multi-adventure" className="hover:text-ink-900 dark:hover:text-sand-50">Multi-Adventure Tours</Link></li>
                <li><Link to="/collections/food-drink" className="hover:text-ink-900 dark:hover:text-sand-50">Food + Drink Tours</Link></li>
                <li><Link to="/collections/family" className="hover:text-ink-900 dark:hover:text-sand-50">Family Friendly Tours</Link></li>
                <li><Link to="/collections/new" className="hover:text-ink-900 dark:hover:text-sand-50">New Tours</Link></li>
              </ul>
            </div>

            {/* Column 4: Subscribe, Contact, Follow */}
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">Subscribe</h3>
                <p className="mb-3 text-sm text-sand-600 dark:text-sand-400">Get the TourMate Newsletter!</p>
                <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
                  <div className="flex gap-2">
                    <input type="text" placeholder="First Name" className="w-full rounded border border-sand-200 bg-white px-3 py-2 text-sm outline-none focus:border-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:focus:border-sand-50" />
                    <input type="text" placeholder="Last Name" className="w-full rounded border border-sand-200 bg-white px-3 py-2 text-sm outline-none focus:border-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:focus:border-sand-50" />
                  </div>
                  <div className="flex gap-2">
                    <input type="email" placeholder="your@email.com" className="w-full rounded border border-sand-200 bg-white px-3 py-2 text-sm outline-none focus:border-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:focus:border-sand-50" />
                    <button type="submit" className="flex items-center justify-center rounded bg-ink-900 px-4 py-2 font-bold text-white transition-colors hover:bg-ink-800 dark:bg-sand-100 dark:text-ink-900 dark:hover:bg-white">
                      →
                    </button>
                  </div>
                </form>
              </div>

              <div>
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">Contact Us</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-sand-600 dark:text-sand-400">
                  <li className="flex items-center gap-2">
                    <span aria-hidden="true">📞</span> +1-570-965-2064
                  </li>
                  <li className="flex items-center gap-2">
                    <span aria-hidden="true">✉️</span> info@tourmate.com
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-sand-50">Follow Us</h3>
                <div className="flex gap-3 text-lg text-ink-900 dark:text-sand-50">
                  {/* Substitute with your icon library (e.g., Lucide React, FontAwesome) */}
                  <a href="#" aria-label="Facebook">ⓕ</a>
                  <a href="#" aria-label="Twitter">𝕏</a>
                  <a href="#" aria-label="Pinterest">℗</a>
                  <a href="#" aria-label="Instagram">ⓘ</a>
                  <a href="#" aria-label="YouTube">▶</a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Sub-footer */}
        <div className="border-t border-sand-200 bg-sand-100 dark:border-ink-800 dark:bg-ink-900">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-4 pb-24 md:flex-row md:pb-4 text-xs text-sand-500 dark:text-sand-400">
            <p>© TourMate {new Date().getFullYear()} All rights reserved.</p>
            <div className="flex gap-4">
              <Link to="/cookies" className="hover:text-ink-900 dark:hover:text-sand-50 transition-colors">Cookie Preferences</Link>
              <Link to="/terms" className="hover:text-ink-900 dark:hover:text-sand-50 transition-colors">Terms + Conditions</Link>
              <Link to="/privacy" className="hover:text-ink-900 dark:hover:text-sand-50 transition-colors">Privacy Policy</Link>
            </div>
          </div>
        </div>
      </footer>

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