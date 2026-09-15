import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth } from '../middleware/auth.js';
import * as users from '../services/users.service.js';

/*
 * Everything the dashboard reads or writes about "me". There is no /users/:id —
 * the account is always taken from the verified token, so one traveller cannot
 * address another's row by guessing an id.
 */
export const userRouter = Router();

userRouter.use(requireAuth);

const limit = (max, fallback) => z.coerce.number().int().min(1).max(max).default(fallback);

/** GET /users/me — the same shape as /auth/me, for pages that mount standalone. */
userRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: await users.getUser(req.user.id) });
  })
);

/*
 * PATCH is a partial update: every field is optional and an absent key means
 * "leave it alone". An empty string is allowed on the optional fields and means
 * "clear it" — the service turns that into NULL.
 */
const profileSchema = z
  .object({
    fullName: z.string().min(2).max(120).trim(),
    phone: z.union([z.string().min(8).max(20), z.literal('')]),
    avatarUrl: z.union([z.string().url().max(500), z.literal('')]),
    homeCity: z.string().max(80),
    homeCountry: z.string().max(80),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });

userRouter.patch(
  '/me',
  validate('body', profileSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await users.updateProfile(req.user.id, req.body) });
  })
);

/*
 * PUT /users/me/location — called right after login, from either the browser
 * Geolocation API (source GPS) or the manual city box shown when permission is
 * denied (source MANUAL). `setAsHome` is what separates "I am travelling" from
 * "I have moved", and defaults to false so a one-off reading never rewrites the
 * profile.
 */
const locationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  source: z.enum(['GPS', 'MANUAL', 'IP']).default('GPS'),
  city: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  setAsHome: z.boolean().default(false),
});

userRouter.put(
  '/me/location',
  validate('body', locationSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await users.updateLocation(req.user.id, req.body) });
  })
);

/*
 * PATCH /users/me/preferences — the theme toggle, locale, currency and
 * notification switches. `.strict()` rejects unknown keys rather than letting a
 * typo accumulate silently in the JSONB blob forever.
 */
const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    locale: z.string().min(2).max(10),
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP']),
    distanceUnit: z.enum(['km', 'mi']),
    moods: z.array(z.string().max(30)).max(12),
    notifications: z
      .object({
        email: z.boolean(),
        whatsapp: z.boolean(),
        promotions: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one preference' });

userRouter.patch(
  '/me/preferences',
  validate('body', preferencesSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await users.updatePreferences(req.user.id, req.body) });
  })
);

/** GET /users/me/summary — the dashboard header counters, one round trip. */
userRouter.get(
  '/me/summary',
  asyncHandler(async (req, res) => {
    res.json({ summary: await users.summary(req.user.id) });
  })
);

/** GET /users/me/activity — reviews and comments merged, newest first. */
userRouter.get(
  '/me/activity',
  validate('query', z.object({ limit: limit(100, 50) }).partial()),
  asyncHandler(async (req, res) => {
    res.json({ activity: await users.activityLog(req.user.id, req.query) });
  })
);

/** GET /users/me/payments — payment and refund tracking. */
userRouter.get(
  '/me/payments',
  validate('query', z.object({ limit: limit(100, 50) }).partial()),
  asyncHandler(async (req, res) => {
    res.json({ payments: await users.paymentHistory(req.user.id, req.query) });
  })
);
