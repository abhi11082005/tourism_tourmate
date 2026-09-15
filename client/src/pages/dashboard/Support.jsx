import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { ago, stamp } from '../../lib/format.js';
import { ErrorNote, Loading, SectionHeader, StatusChip, humanStatus } from '../../components/ui.jsx';

/*
 * Help & support: the traveller's side of the ticket system.
 *
 * Three states in one screen — list, thread, new ticket — because a support flow
 * that navigates away from the list loses the thing the user was comparing
 * against. `openId` decides which is showing; there are no extra routes to keep
 * in sync.
 *
 * Payments.jsx links here with { bookingId, category } in router state, so
 * "question about this payment" opens the form already pointed at the right
 * booking. That is the whole reason the form accepts a seed.
 */

const CATEGORIES = [
  ['BOOKING', 'A booking'],
  ['PAYMENT', 'A payment'],
  ['REFUND', 'A refund'],
  ['ACCESSIBILITY', 'Accessibility'],
  ['GENERAL', 'Something else'],
  ['OTHER', 'Not sure'],
];

export default function Support() {
  const seed = useLocation().state ?? {};
  const [openId, setOpenId] = useState(null);
  const [composing, setComposing] = useState(Boolean(seed.bookingId));

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tickets'],
    queryFn: ({ signal }) => api.tickets(signal),
    staleTime: 30_000,
  });

  if (isPending) return <Loading label="Loading your conversations…" />;
  if (isError) return <ErrorNote error={error} />;

  const tickets = data.tickets ?? [];

  if (openId) return <Thread ticketId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      <SectionHeader title="Help & support" hint="We answer within one working day.">
        {!composing && (
          <button type="button" className="btn-primary" onClick={() => setComposing(true)}>
            New ticket
          </button>
        )}
      </SectionHeader>

      {composing && (
        <NewTicket
          seed={seed}
          onCancel={() => setComposing(false)}
          onCreated={(ticket) => {
            setComposing(false);
            setOpenId(ticket.id);
          }}
        />
      )}

      {tickets.length === 0 && !composing ? (
        <div className="card p-6 text-center">
          <p className="font-semibold">Nothing open</p>
          <p className="muted mt-1 text-sm">
            Ask us anything about a booking, a payment or accessibility on a tour.
          </p>
          <button type="button" className="btn-primary mt-4" onClick={() => setComposing(true)}>
            Start a ticket
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenId(t.id)}
                className="card block w-full p-4 text-left transition hover:border-teal-400"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{t.subject}</p>
                  <span className="faint text-xs" title={stamp(t.lastMessageAt)}>
                    {ago(t.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <StatusChip status={t.status} />
                  {(t.priority === 'HIGH' || t.priority === 'URGENT') && (
                    <StatusChip status={t.priority} />
                  )}
                  <span className="faint font-mono">{t.reference}</span>
                  <span className="faint capitalize">{humanStatus(t.category)}</span>
                  {t.bookingReference && (
                    <span className="faint">· booking {t.bookingReference}</span>
                  )}
                  {t.messageCount > 0 && (
                    <span className="faint">
                      · {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'}
                    </span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="card p-4">
        <h2 className="font-bold">Prefer to talk?</h2>
        <dl className="muted mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="font-semibold">Email</dt>
            <dd>
              <a href="mailto:help@tourmate.dev" className="underline">
                help@tourmate.dev
              </a>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Phone</dt>
            <dd>
              <a href="tel:+911412345678" className="underline">
                +91 141 234 5678
              </a>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Hours</dt>
            <dd>9:00–19:00 IST, seven days</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">On tour</dt>
            <dd>Your guide&apos;s number is on your ticket PDF</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/*
 * The composer. `bookingId` is only sent when the user actually has a booking to
 * attach — the server rejects an id that is not on the account, which is the
 * check that stops someone reading a stranger's reference back out of a ticket.
 */
function NewTicket({ seed, onCancel, onCreated }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subject: '',
    category: seed.category ?? 'GENERAL',
    body: '',
    bookingId: seed.bookingId ?? '',
  });

  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (body) => api.createTicket(body),
    onSuccess: ({ ticket }) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      onCreated(ticket);
    },
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const { bookingId, ...rest } = form;
        create.mutate(bookingId ? { ...rest, bookingId } : rest);
      }}
    >
      <h2 className="font-bold">New ticket</h2>
      <label className="block text-sm">
        What is it about?
        <select className="field mt-1" value={form.category} onChange={set('category')}>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Related booking <span className="faint">(optional)</span>
        <select className="field mt-1" value={form.bookingId} onChange={set('bookingId')}>
          <option value="">Not about a specific booking</option>
          {(bookings.data?.items ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.reference} — {b.tourTitle}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Subject
        <input
          className="field mt-1"
          required
          minLength={3}
          maxLength={160}
          value={form.subject}
          onChange={set('subject')}
          placeholder="Refund for cancelled Amber Fort tour"
        />
      </label>

      <label className="block text-sm">
        Details
        <textarea
          className="field mt-1 min-h-32"
          required
          maxLength={4000}
          value={form.body}
          onChange={set('body')}
          placeholder="Dates, reference numbers and what you expected to happen all help us answer in one go."
        />
        <span className="faint mt-1 block text-xs">{form.body.length}/4000</span>
      </label>

      <ErrorNote error={create.error} />

      <div className="flex gap-2">
        <button className="btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Sending…' : 'Send to support'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/*
 * One thread. Polls while it is open — 20s is frequent enough to feel live during
 * a back-and-forth and cheap enough that an abandoned tab is not a problem.
 * `status` is never sent from here: a trigger moves OPEN ↔ AWAITING_CUSTOMER when
 * a message lands, so the thread's state is always a consequence of its messages.
 */
function Thread({ ticketId, onBack }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: ({ signal }) => api.ticket(ticketId, signal),
    refetchInterval: 20_000,
  });

  const reply = useMutation({
    mutationFn: (text) => api.replyToTicket(ticketId, { body: text }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  if (isPending) return <Loading label="Opening the conversation…" />;
  if (isError) return <ErrorNote error={error} />;

  const t = data.ticket;
  const closed = t.status === 'CLOSED';

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="faint text-sm underline">
        ← All tickets
      </button>

      <header className="card p-4">
        <h1 className="text-lg font-bold">{t.subject}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <StatusChip status={t.status} />
          <StatusChip status={t.priority} />
          <span className="faint font-mono">{t.reference}</span>
          <span className="faint capitalize">{humanStatus(t.category)}</span>
          {t.bookingReference && <span className="faint">· booking {t.bookingReference}</span>}
        </p>
        <p className="faint mt-1 text-xs">
          Opened {stamp(t.createdAt)}
          {t.resolvedAt && ` · resolved ${stamp(t.resolvedAt)}`}
        </p>
      </header>

      <ol className="space-y-3">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className={`card p-4 ${
              m.isStaff ? 'border-teal-300 bg-teal-50/40 dark:border-teal-500/40 dark:bg-teal-500/5' : ''
            }`}
          >
            <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold">
                {m.isStaff ? 'Tour Mate support' : m.authorName}
              </span>
              <span className="faint" title={stamp(m.createdAt)}>
                {ago(m.createdAt)}
              </span>
            </p>
            <p className="mt-2 whitespace-pre-line text-sm">{m.body}</p>
          </li>
        ))}
      </ol>

      {closed ? (
        <p className="muted card p-4 text-sm">
          This ticket is closed. Start a new one and we will pick it up from here.
        </p>
      ) : (
        <form
          className="card space-y-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            reply.mutate(body);
          }}
        >
          <label className="block text-sm font-semibold">
            Reply
            <textarea
              className="field mt-1 min-h-24"
              required
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <ErrorNote error={reply.error} />
          <button className="btn-primary" disabled={reply.isPending || body.trim().length === 0}>
            {reply.isPending ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      )}
    </div>
  );
}
