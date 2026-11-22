import { Link } from 'react-router-dom';

/*
 * Global footer, rendered once by Layout.
 *
 * Every link here is data, so a destination is added or removed in one line.
 * Only routes that are proven to exist (they appear in Layout's own navigation)
 * are listed. Add more to the arrays below once you have confirmed them in your
 * router — an empty array simply hides its section.
 *
 * Social links render only when the matching Vite env var is set, e.g.
 *   VITE_SOCIAL_INSTAGRAM=https://instagram.com/yourhandle
 * No env var, no link — never a dead "#".
 */

const EXPLORE_LINKS = [
  { to: '/', label: 'All tours' },
  { to: '/explore', label: 'Explore destinations' },
];

const TRIP_LINKS = [
  { to: '/dashboard/trips', label: 'My trips' },
  { to: '/dashboard/saved', label: 'Saved tours' },
  { to: '/dashboard', label: 'My account' },
];

// About / contact / policy pages. Empty until those routes are confirmed.
const COMPANY_LINKS = [];
const LEGAL_LINKS = [];

const SOCIALS = [
  { label: 'Instagram', href: import.meta.env.VITE_SOCIAL_INSTAGRAM },
  { label: 'Facebook', href: import.meta.env.VITE_SOCIAL_FACEBOOK },
  { label: 'X', href: import.meta.env.VITE_SOCIAL_X },
  { label: 'YouTube', href: import.meta.env.VITE_SOCIAL_YOUTUBE },
  { label: 'Pinterest', href: import.meta.env.VITE_SOCIAL_PINTEREST },
].filter((s) => s.href);

const linkClass =
  'rounded-sm text-sm text-sand-600 transition-colors duration-200 hover:text-ink-900 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ' +
  'focus-visible:outline-glow dark:text-sand-400 dark:hover:text-sand-50';

function LinkColumn({ title, links }) {
  if (!links.length) return null;
  const id = `footer-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <nav aria-labelledby={id}>
      <h2
        id={id}
        className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-ink-900 dark:text-sand-50"
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className={linkClass}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-sand-200 bg-sand-50 dark:border-ink-800 dark:bg-ink-950">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-14">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Brand */}
          <div className="lg:col-span-5">
            <Link
              to="/"
              className="inline-block rounded-sm text-3xl font-black tracking-tight text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-glow dark:text-sand-50"
            >
              Tour<span className="text-glow">Mate</span>
            </Link>
            <p className="mt-4 max-w-sm text-xl font-semibold leading-snug tracking-tight text-ink-900 dark:text-sand-50">
              Plan less. <span className="text-glow">Wander more.</span>
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-sand-600 dark:text-sand-400">
              Find guided tours, save the ones you love and book when you are ready. Browse as a
              guest — you only need an account when you pay.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-7 lg:pl-8">
            <LinkColumn title="Explore" links={EXPLORE_LINKS} />
            <LinkColumn title="Your trips" links={TRIP_LINKS} />
            <LinkColumn title="TourMate" links={COMPANY_LINKS} />
          </div>
        </div>

        {/* Discovery CTA (no newsletter endpoint exists, so no fake signup form) */}
        <div className="mt-12 flex flex-col gap-5 border-t border-sand-200 pt-8 dark:border-ink-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold text-ink-900 dark:text-sand-50">
              Not sure where to go next?
            </p>
            <p className="mt-1 text-sm text-sand-600 dark:text-sand-400">
              Browse destinations and save a few favourites for later.
            </p>
          </div>
          <Link
            to="/explore"
            className="group inline-flex items-center gap-2 self-start rounded-xl border border-ink-900 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors duration-200 hover:bg-ink-900 hover:text-sand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow dark:border-sand-50 dark:text-sand-50 dark:hover:bg-sand-50 dark:hover:text-ink-900 sm:self-auto"
          >
            Start exploring
            <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </Link>
        </div>
      </div>

      {/* Bottom bar. Extra bottom padding on phones clears the fixed tab bar
          (4rem) plus the device safe area. */}
      <div className="border-t border-sand-200 bg-sand-100 dark:border-ink-800 dark:bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-xs text-sand-600 dark:text-sand-400 md:flex-row md:items-center md:justify-between md:pb-5">
          <p>
            © {year} Tour<span className="font-semibold text-glow">Mate</span>. All rights reserved.
          </p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-sm transition-colors duration-200 hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow dark:hover:text-sand-50"
              >
                {l.label}
              </Link>
            ))}
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm transition-colors duration-200 hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow dark:hover:text-sand-50"
              >
                {s.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}