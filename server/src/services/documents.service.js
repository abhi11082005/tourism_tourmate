import PDFDocument from 'pdfkit';
import { queryOne } from '../db/pool.js';
import { forbidden, notFound } from '../utils/httpError.js';

/*
 * E-tickets and invoices, generated on demand and streamed straight to the
 * response — nothing is stored, so there is no bucket to secure and no stale
 * copy to invalidate when a booking is cancelled.
 *
 * pdfkit's built-in Helvetica is WinAnsi-encoded and has no rupee glyph, so
 * money is written as "INR 1,234.00". Embedding a Unicode font would fix the
 * symbol at the cost of shipping a ~300KB TTF; the code is clearer than the
 * symbol anyway on a document someone may print in another country.
 */

const money = (value, currency = 'INR') =>
  `${currency} ${Number(value ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const longDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

const INK = { text: '#0f172a', muted: '#64748b', rule: '#cbd5e1', brand: '#0d9488' };

/**
 * One query for everything both documents need: the booking, its tour and slot,
 * the traveller it belongs to, the guide if one is assigned, and the payment
 * that matters (a captured one if there is one, otherwise the latest attempt).
 *
 * Ownership is in the WHERE clause, so another traveller's booking id is a 404
 * rather than a 403 that confirms the id exists.
 */
export async function loadBookingDocument({ bookingId, userId, isStaff = false }) {
  const row = await queryOne(
    `SELECT b.id, b.reference, b.status, b.seat_count, b.total_amount, b.price_breakdown,
            b.selected_options, b.booking_date::text AS booking_date,
            b.created_at, b.cancelled_at,
            t.title AS tour_title, t.slug AS tour_slug,
            t.duration_days, t.duration_nights, t.inclusions,
            g.full_name AS guide_name,
            u.full_name AS traveller_name, u.email AS traveller_email, u.phone AS traveller_phone,
            p.status AS payment_status, p.gateway, p.gateway_payment_id,
            p.amount AS paid_amount, p.currency, p.created_at AS paid_at,
            p.refund_amount, p.refunded_at, p.refund_reference
       FROM bookings b
       JOIN tours      t ON t.id = b.tour_id
       JOIN tour_slots s ON s.id = b.slot_id
       JOIN users      u ON u.id = b.user_id
       LEFT JOIN users g ON g.id = s.guide_id
       LEFT JOIN LATERAL (
         SELECT pay.status, pay.gateway, pay.gateway_payment_id, pay.amount, pay.currency,
                pay.created_at, pay.refund_amount, pay.refunded_at, pay.refund_reference
           FROM payments pay
          WHERE pay.booking_id = b.id
          ORDER BY (pay.status = 'CAPTURED') DESC, pay.created_at DESC
          LIMIT 1
       ) p ON TRUE
      WHERE b.id = $1 AND ($2::boolean OR b.user_id = $3)`,
    [bookingId, isStaff, userId]
  );
  if (!row) throw notFound('Booking not found');
  return row;
}

/**
 * A ticket is proof of travel, so it only exists for a paid booking. An invoice
 * is a financial record and stays available after cancellation — that is how the
 * refund line gets documented.
 */
export function assertDocumentAllowed(booking, kind) {
  if (kind === 'TICKET' && booking.status !== 'CONFIRMED') {
    throw forbidden(
      booking.status === 'PENDING'
        ? 'This booking is still in checkout — complete payment to get your ticket'
        : `No ticket for a ${booking.status.toLowerCase()} booking`
    );
  }
  if (kind === 'INVOICE' && booking.status === 'PENDING') {
    throw forbidden('An invoice is issued once payment completes');
  }
}

/** Filename the browser saves as. */
export const documentFilename = (booking, kind) =>
  `${kind === 'TICKET' ? 'ticket' : 'invoice'}-${booking.reference}.pdf`;

/* ---------- drawing helpers ---------- */

const rule = (doc) => {
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(0.7)
    .strokeColor(INK.rule)
    .stroke();
  doc.moveDown(0.8);
};

/** Label above value, the layout used for every field pair on both documents. */
const field = (doc, label, value, { width, x } = {}) => {
  const startY = doc.y;
  doc.fontSize(8).fillColor(INK.muted).font('Helvetica').text(label.toUpperCase(), x, startY, {
    width,
    characterSpacing: 0.6,
  });
  doc
    .fontSize(11)
    .fillColor(INK.text)
    .font('Helvetica-Bold')
    .text(String(value ?? '—'), x, doc.y + 1, { width });
  return doc.y;
};

/** Two fields side by side; returns the lower of the two baselines. */
const fieldRow = (doc, pairs) => {
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const col = usable / pairs.length;
  const top = doc.y;
  let bottom = top;
  pairs.forEach(([label, value], i) => {
    doc.y = top;
    bottom = Math.max(bottom, field(doc, label, value, { x: left + i * col, width: col - 12 }));
  });
  doc.y = bottom;
  doc.moveDown(0.9);
  return bottom;
};

const header = (doc, title, subtitle) => {
  const left = doc.page.margins.left;
  doc.fontSize(20).fillColor(INK.brand).font('Helvetica-Bold').text('Tour Mate', left, 48);
  doc.fontSize(9).fillColor(INK.muted).font('Helvetica').text('tourmate.example / support@tourmate.example');

  doc.moveUp(2);
  doc
    .fontSize(16)
    .fillColor(INK.text)
    .font('Helvetica-Bold')
    .text(title, { align: 'right' });
  doc.fontSize(9).fillColor(INK.muted).font('Helvetica').text(subtitle, { align: 'right' });

  doc.moveDown(1.6);
  rule(doc);
};

const footer = (doc, note) => {
  doc.moveDown(1.2);
  rule(doc);
  doc.fontSize(8).fillColor(INK.muted).font('Helvetica').text(note, { align: 'left' });
};

/* ---------- documents ---------- */

/**
 * E-ticket. The reference is the only thing a gate agent needs to type, so it
 * gets its own box in a monospace face where 0/O and 1/l stay distinguishable.
 * (A scannable QR would slot in beside this box; it needs one more dependency,
 * so it is deliberately left out until someone asks for it.)
 */
export function renderTicket(doc, b) {
  header(doc, 'E-Ticket', `Issued ${longDate(new Date())}`);

  doc.fontSize(15).fillColor(INK.text).font('Helvetica-Bold').text(b.tour_title);
  doc
    .fontSize(9)
    .fillColor(INK.muted)
    .font('Helvetica')
    .text(`${b.duration_days} day${b.duration_days > 1 ? 's' : ''} / ${b.duration_nights} night${b.duration_nights === 1 ? '' : 's'}`);
  doc.moveDown(1);

  const boxY = doc.y;
  const boxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.roundedRect(doc.page.margins.left, boxY, boxW, 54, 6).fillColor('#f0fdfa').fill();
  doc
    .fontSize(8)
    .fillColor(INK.muted)
    .font('Helvetica')
    .text('BOOKING REFERENCE', doc.page.margins.left + 14, boxY + 10, { characterSpacing: 0.8 });
  doc
    .fontSize(22)
    .fillColor(INK.brand)
    .font('Courier-Bold')
    .text(b.reference, doc.page.margins.left + 14, boxY + 24);
  doc.y = boxY + 54;
  doc.moveDown(1.2);

  fieldRow(doc, [
    ['Departure date', longDate(b.booking_date)],
    ['Travellers', `${b.seat_count} ${b.seat_count === 1 ? 'seat' : 'seats'}`],
  ]);
  fieldRow(doc, [
    ['Lead traveller', b.traveller_name],
    ['Contact', b.traveller_phone ?? b.traveller_email],
  ]);
  fieldRow(doc, [
    ['Guide', b.guide_name ?? 'To be assigned'],
    ['Amount paid', money(b.total_amount, b.currency ?? 'INR')],
  ]);

  const inclusions = Array.isArray(b.inclusions) ? b.inclusions.slice(0, 8) : [];
  if (inclusions.length) {
    doc.fontSize(8).fillColor(INK.muted).font('Helvetica').text('INCLUDED', { characterSpacing: 0.6 });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(INK.text).list(inclusions, { bulletRadius: 1.6, textIndent: 10 });
  }

  footer(
    doc,
    'Carry a photo ID matching the lead traveller name. Please arrive 15 minutes before departure. ' +
      'This ticket is valid only for the date shown above.'
  );
}

/**
 * Invoice. Line items come from bookings.price_breakdown, which is the exact
 * quote the server charged — recomputing prices here could disagree with what
 * was actually taken, which is the one thing an invoice must never do.
 */
export function renderInvoice(doc, b) {
  header(doc, 'Invoice', `${b.reference} / ${longDate(b.created_at)}`);

  fieldRow(doc, [
    ['Billed to', b.traveller_name],
    ['Email', b.traveller_email],
  ]);
  fieldRow(doc, [
    ['Tour', b.tour_title],
    ['Departure', longDate(b.booking_date)],
  ]);
  doc.moveDown(0.4);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const currency = b.currency ?? 'INR';
  const row = (label, perSeat, amount, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK.text);
    const y = doc.y;
    doc.text(label, left, y, { width: right - left - 200 });
    doc.text(perSeat, right - 200, y, { width: 90, align: 'right' });
    doc.text(amount, right - 100, y, { width: 100, align: 'right' });
    doc.moveDown(0.45);
  };

  doc.fontSize(8).fillColor(INK.muted).font('Helvetica');
  row('DESCRIPTION', 'PER SEAT', 'AMOUNT');
  rule(doc);

  const lines = b.price_breakdown?.lines ?? [];
  for (const line of lines) {
    row(line.label, money(line.perSeat, currency), money(line.amount, currency));
  }
  if (!lines.length) row(`Tour package x ${b.seat_count}`, '—', money(b.total_amount, currency));

  rule(doc);
  row(`Total (${b.seat_count} ${b.seat_count === 1 ? 'seat' : 'seats'})`, '', money(b.total_amount, currency), true);
  doc.moveDown(1);

  fieldRow(doc, [
    ['Payment status', b.payment_status ?? 'PENDING'],
    ['Method', b.gateway ? `${b.gateway}${b.gateway_payment_id ? ` / ${b.gateway_payment_id}` : ''}` : '—'],
  ]);

  if (b.refund_amount != null) {
    fieldRow(doc, [
      ['Refunded', `${money(b.refund_amount, currency)} on ${longDate(b.refunded_at)}`],
      ['Refund reference', b.refund_reference ?? '—'],
    ]);
  }
  if (b.status === 'CANCELLED' && b.refund_amount == null) {
    fieldRow(doc, [['Cancelled', longDate(b.cancelled_at)], ['Refund', 'Being processed']]);
  }

  footer(doc, 'Computer-generated invoice. No signature required. Amounts are in ' + currency + '.');
}

/**
 * Stream to the response. Load and authorise *before* calling this: once the
 * first PDF byte is written the status line is already sent, and an error after
 * that point cannot be turned back into a JSON body.
 */
export function streamBookingDocument({ booking, kind, stream }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: {
      Title: `${kind === 'TICKET' ? 'E-Ticket' : 'Invoice'} ${booking.reference}`,
      Author: 'Tour Mate',
      Subject: booking.tour_title,
    },
  });

  doc.pipe(stream);
  if (kind === 'TICKET') renderTicket(doc, booking);
  else renderInvoice(doc, booking);
  doc.end();
  return doc;
}
