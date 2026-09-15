import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth, requireRole, assertLiveRole } from '../middleware/auth.js';
import * as support from '../services/support.service.js';

/*
 * Help & Support. The traveller-facing routes and the admin inbox share one
 * service and one thread rendering, so what support sees is what the customer
 * sees.
 *
 * Staffness is derived from the live role, never from the request body — a
 * traveller cannot post a message that renders as "Tour Mate support".
 */
export const supportRouter = Router();

supportRouter.use(requireAuth);

const uuid = z.string().uuid();
const isStaff = (req) => req.user.role === 'ADMIN';

const ticketSchema = z.object({
  subject: z.string().min(3).max(160).trim(),
  category: z.enum(['GENERAL', 'BOOKING', 'PAYMENT', 'REFUND', 'ACCESSIBILITY', 'OTHER']),
  bookingId: uuid.optional(),
  body: z.string().min(1).max(4000).trim(),
});

const messageSchema = z.object({ body: z.string().min(1).max(4000).trim() });

/*
 * Admin routes are declared before '/tickets/:ticketId' so that /tickets/inbox
 * is never swallowed by the uuid param route. The uuid validator would reject it
 * with a 422, which is a confusing way to say "wrong route".
 */
supportRouter.get(
  '/tickets/inbox',
  requireRole('ADMIN'),
  assertLiveRole,
  validate(
    'query',
    z
      .object({
        status: z.enum(['WAITING', 'ALL', 'OPEN', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED']),
        limit: z.coerce.number().int().min(1).max(200),
      })
      .partial()
  ),
  asyncHandler(async (req, res) => {
    res.json({ tickets: await support.inbox(req.query) });
  })
);

supportRouter.patch(
  '/tickets/:ticketId/status',
  requireRole('ADMIN'),
  assertLiveRole,
  validate('params', z.object({ ticketId: uuid })),
  validate(
    'body',
    z
      .object({
        status: z.enum(['OPEN', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED']),
        priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
      })
      .partial()
      .refine((v) => v.status || v.priority, { message: 'Send a status or a priority' })
  ),
  asyncHandler(async (req, res) => {
    res.json({ ticket: await support.setStatus({ ticketId: req.params.ticketId, ...req.body }) });
  })
);

/** POST /support/tickets — opens a thread with its first message. */
supportRouter.post(
  '/tickets',
  validate('body', ticketSchema),
  asyncHandler(async (req, res) => {
    const ticket = await support.createTicket({ userId: req.user.id, ...req.body });
    res.status(201).json({ ticket });
  })
);

/** GET /support/tickets — my threads, most recently active first. */
supportRouter.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    res.json({ tickets: await support.listMyTickets(req.user.id) });
  })
);

/** GET /support/tickets/:id — one thread with its messages. */
supportRouter.get(
  '/tickets/:ticketId',
  validate('params', z.object({ ticketId: uuid })),
  asyncHandler(async (req, res) => {
    res.json({
      ticket: await support.getTicket({
        ticketId: req.params.ticketId,
        userId: req.user.id,
        isStaff: isStaff(req),
      }),
    });
  })
);

/** POST /support/tickets/:id/messages — reply; the trigger moves the status. */
supportRouter.post(
  '/tickets/:ticketId/messages',
  validate('params', z.object({ ticketId: uuid })),
  validate('body', messageSchema),
  asyncHandler(async (req, res) => {
    const ticket = await support.replyToTicket({
      ticketId: req.params.ticketId,
      userId: req.user.id,
      isStaff: isStaff(req),
      body: req.body.body,
    });
    res.status(201).json({ ticket });
  })
);
