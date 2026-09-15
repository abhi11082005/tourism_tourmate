import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/*
 * Personal dashboard shell.
 *
 * The module list is data, not markup: one array drives the desktop sidebar and
 * the mobile tab strip, so a new module is one line here and one route in
 * App.jsx. Each module fetches its own data — React Query dedupes the summary
 * call this shell makes for the badges, so Overview asking for it again costs
 * nothing.
 *
 * Layout is mobile-first: a horizontally scrollable strip of tabs above the
 * content on phones, a sticky rail beside it from `lg` up.
 */

const MODULES = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/profile', label: 'Profile' },
  { to: '/dashboard/trips', label: 'My trips', badge: 'liveHolds' },
  { to: '/dashboard/saved', label: 'Saved trips', badge: 'savedCount' },
  { to: '/dashboard/reviews', label: 'Reviews' },
  { to: '/dashboard/documents', label: 'Tickets & invoices' },
  { to: '/dashboard/payments', label: 'Payments & refunds' },
  { to: '/dashboard/support', label: 'Help & support', badge: 'openTickets' },
  { to: '/dashboard/preferences', label: 'Preferences' },
];

const linkClass = ({ isActive }) =>
  `flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-xl px-3 py-2
   text-sm font-medium transition ${
     isActive
       ? 'bg-ink-800 text-sand-50 dark:bg-sand-200 dark:text-ink-900'
       : 'hover:bg-sand-100 dark:hover:bg-ink-800'
   }`;

export default function Dashboard() {
  const { user } = useAuth();

  // Badge counts only. A failure here must not take the dashboard down with it,
  // so there is no error branch — the badges simply do not appear.
  const { data } = useQuery({
    queryKey: ['summary'],
    queryFn: ({ signal }) => api.summary(signal),
    staleTime: 60_000,
  });
  const summary = data?.summary;

  const firstName = (user?.fullName ?? '').trim().split(/\s+/)[0] || 'traveller';
  // Only `home` carries a city name; `lastLocation` is coordinates plus a source.
  const where = user?.home?.city;

  return (
    <div className="space-y-5">
      <header>
        <p className="faint text-xs uppercase tracking-wide">Personal dashboard</p>
        <h1 className="text-2xl font-black">Hello, {firstName}</h1>
        <p className="muted text-sm">
          {where
            ? `Suggestions are tuned to ${where}. Everything about your trips lives here.`
            : 'Everything about your trips, documents and account lives here.'}
        </p>
      </header>

      <div className="lg:flex lg:items-start lg:gap-6">
        {/*
          One <nav> for both breakpoints. On phones it scrolls sideways — a
          nine-item vertical list would push the actual content off the screen.
        */}
        <nav
          aria-label="Dashboard sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:w-56 lg:shrink-0
                     lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0
                     lg:sticky lg:top-20"
        >
          {MODULES.map((m) => {
            const count = m.badge ? summary?.[m.badge] : 0;
            return (
              <NavLink key={m.to} to={m.to} end={m.end} className={linkClass}>
                <span>{m.label}</span>
                {count > 0 && (
                  <span className="rounded-full bg-teal-500/15 px-2 text-xs font-bold text-teal-800 dark:text-teal-200">
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <section className="min-w-0 flex-1 pt-2 lg:pt-0">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
