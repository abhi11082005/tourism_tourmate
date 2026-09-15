import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { ago, inr, shortDate, stamp } from '../lib/format.js';
import { ErrorNote, SectionHeader, StatusChip } from '../components/ui.jsx';
import TourBuilder from '../components/TourBuilder.jsx';
import GuideAssignmentTable from '../components/GuideAssignmentTable.jsx';
import CouponManager from '../components/CouponManager.jsx';
import CampaignManager from '../components/CampaignManager.jsx';

// MapLibre GL is ~900kB. Same call as the tour detail page: load the pin manager on
// demand so it never weighs down the admin console's first paint.
const MapPinManager = lazy(() => import('../components/MapPinManager.jsx'));

/*
 * Admin console. One screen, because the operator running it is usually doing all
 * of these in the same sitting:
 *
 *   1. Analytics tiles + a 30-day revenue bar row (plain divs — a chart library
 *      would be another 200kB for what CSS already does).
 *   2. Support inbox — the other side of the traveller's Help & Support module.
 *      Ordered by who has been waiting longest, because that is the only ordering
 *      that stops a ticket being forgotten.
 *   3. Package workbench — one wizard that both creates a tour and edits an existing
 *      one (itinerary, pricing options, refund ladder, and its live departures),
 *      replacing the old raw-JSON builder and the standalone seat manager.
 *   4. Guide assignment — pin a guide to each upcoming departure.
 *   5. Map pins — click-to-place attractions with the mood scores that drive PostGIS
 *      route selection (lazy-loaded; it pulls in MapLibre).
 *   6. Offers — coupon codes and festival campaigns, the two halves of the discount
 *      engine that surface on the storefront.
 */

export default function AdminDashboard() {
  const analytics = useQuery({
    queryKey: ['analytics'],
    queryFn: ({ signal }) => api.analytics(signal),
    staleTime: 60_000,
  });

  const tours = useQuery({
    queryKey: ['admin-tours'],
    queryFn: ({ signal }) => api.listTours({ limit: 50, sort: 'newest' }, signal),
    staleTime: 60_000,
  });

  const totals = analytics.data?.totals;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-black">Admin</h1>
        <p className="text-sm text-ink-700 dark:text-sand-300">
          Revenue, packages, seats, guides, pins and offers.
        </p>
      </header>

      {analytics.isError && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {analytics.error.message}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Gross revenue" value={inr(totals?.gross_revenue)} hint="all confirmed" />
        <Tile label="Last 30 days" value={inr(totals?.revenue_30d)} hint="confirmed only" />
        <Tile label="Confirmed bookings" value={totals?.confirmed_bookings ?? '—'} />
        <Tile label="In checkout now" value={totals?.in_checkout ?? '—'} hint="seats held in Redis" />
        <Tile label="Departures today" value={totals?.departures_today ?? '—'} />
        <Tile label="Travellers" value={totals?.total_users ?? '—'} />
        <Tile label="New this month" value={totals?.new_users_30d ?? '—'} />
      </section>

      <RevenueBars daily={analytics.data?.daily ?? []} />

      <SupportInbox />

      <TourWorkbench tours={tours.data?.items ?? []} />

      <GuideAssignmentTable />

      <Suspense
        fallback={
          <div className="card grid h-96 place-items-center text-sm text-sand-500 dark:text-sand-400">
            Loading map…
          </div>
        }
      >
        <MapPinManager />
      </Suspense>

      <div className="grid gap-8 xl:grid-cols-2">
        <CouponManager />
        <CampaignManager />
      </div>
    </div>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-sand-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-sand-500">{hint}</p>}
    </div>
  );
}

function RevenueBars({ daily }) {
  const peak = useMemo(
    () => daily.reduce((max, d) => Math.max(max, Number(d.revenue)), 0),
    [daily]
  );

  if (!daily.length) {
    return (
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Last 30 days</h2>
        <p className="mt-2 text-sm text-sand-500">No confirmed bookings in the last 30 days.</p>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Last 30 days</h2>
      <ul className="mt-3 flex h-32 items-end gap-1" role="img" aria-label="Daily revenue">
        {daily.map((d) => (
          <li
            key={d.date}
            className="flex-1 rounded-t bg-ink-800"
            style={{ height: `${peak ? (Number(d.revenue) / peak) * 100 : 0}%` }}
            title={`${shortDate(d.date)} — ${inr(d.revenue)} from ${d.bookings} bookings`}
          />
        ))}
      </ul>
      <p className="mt-2 flex justify-between text-[11px] text-sand-500">
        <span>{shortDate(daily[0].date)}</span>
        <span>peak {inr(peak)}</span>
        <span>{shortDate(daily[daily.length - 1].date)}</span>
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- support inbox */

const INBOX_FILTERS = [
  ['WAITING', 'Needs a reply'],
  ['RESOLVED', 'Resolved'],
  ['CLOSED', 'Closed'],
  ['ALL', 'Everything'],
];

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/**
 * The admin side of Help & Support. The default filter is WAITING (OPEN plus
 * AWAITING_CUSTOMER) sorted oldest-first by last message, so the ticket that has
 * been ignored longest is at the top rather than the newest one.
 *
 * Replying does not set a status: the trigger flips AWAITING_CUSTOMER on a staff
 * message and OPEN on the traveller's, and having two writers for that column is
 * how it ends up wrong. Priority and an explicit resolve are the only status
 * writes here, and they are deliberate operator decisions.
 */
function SupportInbox() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('WAITING');
  const [openId, setOpenId] = useState(null);
  const [reply, setReply] = useState('');

  const inbox = useQuery({
    queryKey: ['support-inbox', filter],
    queryFn: ({ signal }) => api.supportInbox({ status: filter, limit: 100 }, signal),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const thread = useQuery({
    queryKey: ['support-thread', openId],
    queryFn: ({ signal }) => api.ticket(openId, signal),
    enabled: Boolean(openId),
    refetchInterval: openId ? 20_000 : false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['support-inbox'] });
    if (openId) qc.invalidateQueries({ queryKey: ['support-thread', openId] });
  };

  const send = useMutation({
    mutationFn: () => api.replyToTicket(openId, { body: reply.trim() }),
    onSuccess: () => {
      setReply('');
      invalidate();
    },
  });

  const patch = useMutation({
    mutationFn: ({ ticketId, ...body }) => api.setTicketStatus(ticketId, body),
    onSuccess: invalidate,
  });

  const tickets = inbox.data?.tickets ?? [];
  const open = thread.data?.ticket;

  return (
    <section className="card p-4">
      <SectionHeader
        title="Support inbox"
        hint="Longest wait first. Replying moves the thread to “awaiting customer” on its own."
      />

      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Ticket filter">
        {INBOX_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => {
              setFilter(value);
              setOpenId(null);
            }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === value
                ? 'bg-ink-800 text-sand-50 dark:bg-sand-200 dark:text-ink-900'
                : 'bg-sand-100 text-ink-700 dark:bg-ink-800 dark:text-sand-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorNote error={inbox.error ?? send.error ?? patch.error} />

      {inbox.isPending ? (
        <p className="faint mt-3 text-sm" role="status">
          Loading tickets…
        </p>
      ) : tickets.length === 0 ? (
        <p className="faint mt-3 text-sm">Nothing here. Empty is the goal.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-xl border border-sand-200 p-3 dark:border-ink-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.subject}</p>
                  <p className="faint mt-0.5 text-xs">
                    <span className="font-mono">{t.reference}</span>
                    {t.requester && <> · {t.requester.name}</>}
                    {t.bookingReference && (
                      <>
                        {' '}
                        · booking <span className="font-mono">{t.bookingReference}</span>
                      </>
                    )}
                    {t.messageCount != null && <> · {t.messageCount} messages</>}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <StatusChip status={t.status} />
                    <StatusChip status={t.priority} />
                    {/* lastMessageAt is a TIMESTAMPTZ, so it needs stamp/ago —
                        shortDate is for bare DATE columns and would show today. */}
                    <span className="faint" title={stamp(t.lastMessageAt)}>
                      waiting {ago(t.lastMessageAt)}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <label className="sr-only" htmlFor={`prio-${t.id}`}>
                    Priority for {t.reference}
                  </label>
                  <select
                    id={`prio-${t.id}`}
                    className="input h-9 py-0 text-xs"
                    value={t.priority}
                    disabled={patch.isPending}
                    onChange={(e) => patch.mutate({ ticketId: t.id, priority: e.target.value })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    aria-expanded={openId === t.id}
                    onClick={() => {
                      setOpenId(openId === t.id ? null : t.id);
                      setReply('');
                    }}
                  >
                    {openId === t.id ? 'Close' : 'Open'}
                  </button>
                </div>
              </div>

              {openId === t.id && (
                <div className="mt-3 border-t border-sand-200 pt-3 dark:border-ink-700">
                  {thread.isPending ? (
                    <p className="faint text-sm" role="status">
                      Loading thread…
                    </p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {(open?.messages ?? []).map((m) => (
                          <li
                            key={m.id}
                            className={`rounded-xl p-3 text-sm ${
                              m.isStaff
                                ? 'bg-sand-100 dark:bg-ink-800'
                                : 'bg-amber-50 dark:bg-ink-700'
                            }`}
                          >
                            <p className="faint text-xs">
                              {m.authorName} · <span title={stamp(m.createdAt)}>{ago(m.createdAt)}</span>
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                          </li>
                        ))}
                      </ul>

                      {open?.status === 'CLOSED' ? (
                        <p className="faint mt-3 text-xs">
                          This thread is closed. Reopen it by setting the status back to open.
                        </p>
                      ) : (
                        <form
                          className="mt-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (reply.trim().length >= 2) send.mutate();
                          }}
                        >
                          <label className="sr-only" htmlFor={`reply-${t.id}`}>
                            Reply to {t.reference}
                          </label>
                          <textarea
                            id={`reply-${t.id}`}
                            className="input min-h-[80px]"
                            maxLength={4000}
                            placeholder="Reply as Tour Mate support…"
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="submit"
                              className="btn-primary text-xs"
                              disabled={send.isPending || reply.trim().length < 2}
                            >
                              {send.isPending ? 'Sending…' : 'Send reply'}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              disabled={patch.isPending}
                              onClick={() => patch.mutate({ ticketId: t.id, status: 'RESOLVED' })}
                            >
                              Mark resolved
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              disabled={patch.isPending}
                              onClick={() => patch.mutate({ ticketId: t.id, status: 'CLOSED' })}
                            >
                              Close
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/*
 * Package workbench — the single create/edit entry point for tours.
 *
 * It replaces the old raw-JSON PackageBuilder and the separate SeatManager: choose
 * "＋ New package" to build from scratch, or pick an existing tour to load it into
 * the same wizard for editing — where step 3 also manages that tour's live
 * departures. The full tour is fetched on demand (same shape and cache key the
 * public detail page reads) so every field pre-fills.
 *
 * TourBuilder owns all the form/seat logic and its own dark-mode, mobile-first
 * layout; this wrapper only decides which tour it's pointed at.
 */
function TourWorkbench({ tours }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState(''); // '' → build a new package

  const editing = useQuery({
    queryKey: ['tour', slug],
    queryFn: ({ signal }) => api.getTour(slug, signal),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

  const handleSaved = (tour) => {
    qc.invalidateQueries({ queryKey: ['admin-tours'] });
    qc.invalidateQueries({ queryKey: ['tours'] });
    // A freshly created tour comes back with its slug — drop straight into editing
    // it so the operator can keep opening dates without hunting for it in the list.
    if (!slug && tour?.slug) setSlug(tour.slug);
  };

  return (
    <section className="space-y-3">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Packages</h2>
          <p className="faint text-xs">
            Build a new tour, or pick one to edit its details and departures.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Choose a package to edit</span>
          <select
            className="field h-9 max-w-[16rem] py-0"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">＋ New package</option>
            {tours.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {slug && editing.isPending ? (
        <p className="faint text-sm" role="status">
          Loading package…
        </p>
      ) : slug && editing.isError ? (
        <ErrorNote error={editing.error} />
      ) : (
        // key forces a clean remount (and re-seed) when switching tours or back to new.
        <TourBuilder
          key={slug || 'new'}
          initialData={slug ? editing.data?.tour ?? null : null}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
