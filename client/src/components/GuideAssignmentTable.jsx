import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { ErrorNote } from './ui.jsx';

/*
 * Manual guide assignment.
 *
 * Lists the departures that are coming up and lets an operator pin a guide to each
 * one from a dropdown. The write is deliberately the existing slot PATCH
 * (`updateSlot({ guideId })`) — the same endpoint the seat manager uses — so a guide
 * change here and a capacity change there can never disagree about what a slot is.
 *
 * Reads (`/admin/departures`, `/admin/guides`) are allowed to fail quietly: if the
 * backend hasn't shipped them yet the table shows an empty state instead of a crash,
 * and the rest of the console keeps working. Sending `guideId: null` unassigns.
 *
 * Responsive by construction: a real table on sm+, stacked cards on phones, because
 * a five-column table does not survive a 360px screen.
 */

export default function GuideAssignmentTable() {
  const qc = useQueryClient();
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 20;

  const departures = useQuery({
    queryKey: ['departures', { onlyUnassigned }],
    queryFn: ({ signal }) => api.upcomingDepartures({ days: 60, onlyUnassigned }, signal),
    staleTime: 30_000,
    retry: false,
  });

  const guidesQuery = useQuery({
    queryKey: ['guides'],
    queryFn: ({ signal }) => api.guides(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const assign = useMutation({
    mutationFn: ({ slotId, guideId }) => api.updateSlot(slotId, { guideId: guideId || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departures'] }),
  });

  const allRows = departures.data?.departures ?? (Array.isArray(departures.data) ? departures.data : []);
  const guides = guidesQuery.data?.guides ?? (Array.isArray(guidesQuery.data) ? guidesQuery.data : []);

  // Client-side search + pagination
  const { rows, totalPages } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? allRows.filter((d) => {
          const title = (d.tourTitle ?? d.title ?? '').toLowerCase();
          const date = (d.date ?? '').toLowerCase();
          return title.includes(term) || date.includes(term);
        })
      : allRows;

    const total = Math.ceil(filtered.length / perPage);
    const start = (page - 1) * perPage;
    const paginated = filtered.slice(start, start + perPage);
    return { rows: paginated, totalPages: total };
  }, [allRows, search, page]);

  // Reset to page 1 when search changes
  const handleSearch = (val) => {
    setSearch(val);
    setPage(1);
  };

  const savingId = assign.isPending ? assign.variables?.slotId : null;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Guide assignment</h2>
          <p className="faint text-xs">Upcoming departures over the next 60 days.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-ink-800 dark:accent-sand-300"
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
          />
          Only unassigned
        </label>
      </div>

      <ErrorNote error={assign.error} />

      {departures.isPending ? (
        <p className="faint mt-3 text-sm" role="status">Loading departures…</p>
      ) : departures.isError ? (
        <p className="faint mt-3 text-sm">Departures aren’t available yet.</p>
      ) : allRows.length === 0 ? (
        <p className="faint mt-3 text-sm">
          {onlyUnassigned ? 'Every upcoming departure has a guide. Nice.' : 'No departures in the next 60 days.'}
        </p>
      ) : (
        <>
          {/* Search bar */}
          <div className="mt-3">
            <label className="sr-only" htmlFor="departure-search">Search by tour name or date</label>
            <input
              id="departure-search"
              type="search"
              className="field w-full text-sm sm:max-w-sm"
              placeholder="Search by tour name or date…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          {rows.length === 0 ? (
            <p className="faint mt-3 text-sm">No departures match your search.</p>
          ) : (
        <>
          {/* Table on sm+ */}
          <div className="mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Upcoming departures and their guides</caption>
              <thead className="text-xs uppercase text-sand-500 dark:text-sand-400">
                <tr>
                  <th scope="col" className="py-2 pr-3">Tour</th>
                  <th scope="col" className="py-2 pr-3">Date</th>
                  <th scope="col" className="py-2 pr-3">Seats</th>
                  <th scope="col" className="py-2">Guide</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.slotId} className="border-t border-sand-100 dark:border-ink-700">
                    <td className="py-2 pr-3">{d.tourTitle ?? d.title ?? '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{shortDate(d.date)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {d.availableSeats ?? '—'}
                      <span className="faint"> / {d.totalSeats ?? '—'}</span>
                    </td>
                    <td className="py-2">
                      <GuidePicker
                        slot={d}
                        guides={guides}
                        saving={savingId === d.slotId}
                        onChange={(guideId) => assign.mutate({ slotId: d.slotId, guideId })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards on phones */}
          <ul className="mt-3 space-y-2 sm:hidden">
            {rows.map((d) => (
              <li key={d.slotId} className="rounded-xl border border-sand-200 p-3 dark:border-ink-700">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold">{d.tourTitle ?? d.title ?? '—'}</p>
                  <span className="faint shrink-0 text-xs">{shortDate(d.date)}</span>
                </div>
                <p className="faint mt-0.5 text-xs tabular-nums">
                  {d.availableSeats ?? '—'} / {d.totalSeats ?? '—'} seats
                </p>
                <div className="mt-2">
                  <GuidePicker
                    slot={d}
                    guides={guides}
                    saving={savingId === d.slotId}
                    onChange={(guideId) => assign.mutate({ slotId: d.slotId, guideId })}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-sand-200 pt-4 dark:border-ink-700">
              <p className="faint text-xs">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost h-8 px-3 text-xs"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-ghost h-8 px-3 text-xs"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </>
      )}
    </section>
  );
}

function GuidePicker({ slot, guides, saving, onChange }) {
  const current = slot.guideId ?? '';
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Guide for {slot.tourTitle ?? 'departure'} on {shortDate(slot.date)}</span>
      <select
        className="field h-9 max-w-[14rem] py-0 text-sm"
        value={current}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {/* A guide who was removed from the roster but still sits on this slot stays
            selectable so the row shows the truth rather than silently blanking. */}
        {current && !guides.some((g) => g.id === current) && (
          <option value={current}>{slot.guideName ?? 'Current guide'}</option>
        )}
        {guides.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name ?? g.fullName ?? g.email ?? g.id}
          </option>
        ))}
      </select>
      {saving && <span className="faint text-xs">saving…</span>}
    </label>
  );
}
