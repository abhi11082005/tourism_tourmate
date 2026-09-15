import { randomBytes } from 'node:crypto';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';

/*
 * Help & Support: threaded tickets in Postgres, with the same thread rendered
 * for the traveller and for the admin inbox.
 *
 * Two invariants worth knowing before editing this file:
 *   * last_message_at and the OPEN/AWAITING_CUSTOMER flip are maintained by the
 *     support_messages_bump trigger, not here. Setting them in application code
 *     as well would let the two drift.
 *   * `is_staff` is stamped per message from the caller's live role, so
 *     re-reading a thread years later still shows who was staff at the time.
 */

const OPEN_STATES = ['OPEN', 'AWAITING_CUSTOMER'];

// 4 random bytes, same shape as a booking reference. Collisions would surface as
// a unique violation rather than a silently shared ticket, which is the safe way
// round; at 4.3e9 values it is not a practical concern.
const reference = () => `TM-S-${randomBytes(4).toString('hex').toUpperCase()}`;

const TICKET_COLUMNS = `
  t.id, t.reference, t.subject, t.category, t.status, t.priority,
  t.booking_id, t.last_message_at, t.resolved_at, t.created_at`;

const toTicket = (r) => ({
  id: r.id,
  reference: r.reference,
  subject: r.subject,
  category: r.category,
  status: r.status,
  priority: r.priority,
  bookingId: r.booking_id,
  bookingReference: r.booking_reference ?? null,
  lastMessageAt: r.last_message_at,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
  messageCount: r.message_count === undefined ? undefined : Number(r.message_count),
  requester: r.requester_name ? { name: r.requester_name, email: r.requester_email } : undefined,
});

const toMessage = (r) => ({
  id: r.id,
  body: r.body,
  isStaff: r.is_staff,
  authorName: r.author_name ?? (r.is_staff ? 'Tour Mate support' : 'You'),
  attachments: r.attachments ?? [],
  createdAt: r.created_at,
});

/**
 * Ticket + opening message in one transaction: a ticket with no message is a row
 * nobody can answer, and the trigger that stamps last_message_at only fires on
 * the message insert.
 */
export async function createTicket({ userId, subject, category, bookingId, body }) {
  if (bookingId) {
    // Without this check a traveller could attach a stranger's booking id and
    // read its reference back out of their own ticket.
    const owned = await queryOne('SELECT 1 FROM bookings WHERE id = $1 AND user_id = $2', [
      bookingId,
      userId,
    ]);
    if (!owned) throw badRequest('That booking is not on your account');
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO support_tickets (reference, user_id, booking_id, subject, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, reference, subject, category, status, priority, booking_id,
                 last_message_at, resolved_at, created_at`,
      [reference(), userId, bookingId ?? null, subject, category]
    );
    const ticket = rows[0];

    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, author_id, is_staff, body)
       VALUES ($1, $2, FALSE, $3)`,
      [ticket.id, userId, body]
    );

    return toTicket(ticket);
  });
}

/** The traveller's own list. */
export async function listMyTickets(userId) {
  const { rows } = await query(
    `SELECT ${TICKET_COLUMNS}, b.reference AS booking_reference,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)
              AS message_count
       FROM support_tickets t
       LEFT JOIN bookings b ON b.id = t.booking_id
      WHERE t.user_id = $1
      ORDER BY t.last_message_at DESC
      LIMIT 50`,
    [userId]
  );
  return rows.map(toTicket);
}

/**
 * One thread with its messages. Staff may open any ticket; everyone else only
 * their own — enforced in the WHERE clause rather than after the fetch, so an
 * unauthorised id is indistinguishable from a missing one. A 403 here would
 * confirm the row exists, which is a slow leak of other people's ticket ids.
 */
export async function getTicket({ ticketId, userId, isStaff = false }) {
  const ticket = await queryOne(
    `SELECT ${TICKET_COLUMNS}, b.reference AS booking_reference,
            u.full_name AS requester_name, u.email AS requester_email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN bookings b ON b.id = t.booking_id
      WHERE t.id = $1 AND ($2::boolean OR t.user_id = $3)`,
    [ticketId, isStaff, userId]
  );
  if (!ticket) throw notFound('Ticket not found');

  const { rows: messages } = await query(
    `SELECT m.id, m.body, m.is_staff, m.attachments, m.created_at,
            u.full_name AS author_name
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = $1
      ORDER BY m.created_at ASC`,
    [ticketId]
  );

  return { ...toTicket(ticket), messages: messages.map(toMessage) };
}

/**
 * Reply. The trigger reopens a resolved thread when the customer writes, and
 * moves an open one to AWAITING_CUSTOMER when staff do — so nothing here needs
 * to touch `status`.
 */
export async function replyToTicket({ ticketId, userId, isStaff = false, body }) {
  const ticket = await queryOne(
    `SELECT id, status FROM support_tickets
      WHERE id = $1 AND ($2::boolean OR user_id = $3)`,
    [ticketId, isStaff, userId]
  );
  if (!ticket) throw notFound('Ticket not found');
  if (ticket.status === 'CLOSED') {
    throw forbidden('This ticket is closed — please open a new one');
  }

  await query(
    `INSERT INTO support_ticket_messages (ticket_id, author_id, is_staff, body)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, userId, isStaff, body]
  );

  return getTicket({ ticketId, userId, isStaff });
}

/**
 * Admin inbox. Default view is "still needs us", oldest-waiting first, which is
 * the order support should actually work in — and the one the partial index
 * support_tickets_inbox_idx is built for.
 *
 * @param {{ status?: 'ALL'|'WAITING'|'OPEN'|'AWAITING_CUSTOMER'|'RESOLVED'|'CLOSED',
 *           limit?: number }} opts
 */
export async function inbox({ status = 'WAITING', limit = 100 } = {}) {
  const filters = { WAITING: OPEN_STATES, ALL: null };
  const states = status in filters ? filters[status] : [status];

  const { rows } = await query(
    // `priority DESC` sorts by the enum's declaration order, so URGENT comes
    // before HIGH before NORMAL — no CASE expression needed.
    `SELECT ${TICKET_COLUMNS},
            b.reference AS booking_reference,
            u.full_name AS requester_name, u.email AS requester_email,
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)
              AS message_count
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN bookings b ON b.id = t.booking_id
      WHERE ($1::ticket_status[] IS NULL OR t.status = ANY($1))
      ORDER BY (t.status IN ('OPEN', 'AWAITING_CUSTOMER')) DESC,
               t.priority DESC,
               t.last_message_at ASC
      LIMIT $2`,
    [states, limit]
  );
  return rows.map(toTicket);
}

/**
 * Admin status change. RESOLVED stamps resolved_at; anything else clears it, so
 * a reopened ticket does not keep a resolution date it no longer has.
 */
export async function setStatus({ ticketId, status, priority }) {
  const ticket = await queryOne(
    `UPDATE support_tickets
        SET status      = COALESCE($2::ticket_status, status),
            priority    = COALESCE($3::ticket_priority, priority),
            resolved_at = CASE
              WHEN $2::ticket_status IN ('RESOLVED', 'CLOSED') THEN COALESCE(resolved_at, NOW())
              WHEN $2::ticket_status IS NULL                   THEN resolved_at
              ELSE NULL
            END
      WHERE id = $1
      RETURNING id, reference, subject, category, status, priority, booking_id,
                last_message_at, resolved_at, created_at`,
    [ticketId, status ?? null, priority ?? null]
  );
  if (!ticket) throw notFound('Ticket not found');
  return toTicket(ticket);
}
