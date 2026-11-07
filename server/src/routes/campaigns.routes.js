import { Router } from 'express';
import { asyncHandler } from '../middleware/index.js';
import { activeCampaigns } from '../services/offers.service.js';

export const campaignRouter = Router();

/*
 * Public, cacheable endpoint for the homepage festival banner and tour-card
 * strike-through pricing. No auth required: guests see the same campaigns as
 * signed-in users.
 *
 * Cache-Control: public, max-age=30 so the CDN edge can serve this without
 * hitting the database every time. 30 seconds is fresh enough that a newly
 * launched campaign appears within half a minute.
 */
campaignRouter.get(
  '/active',
  asyncHandler(async (_req, res) => {
    const campaigns = await activeCampaigns();
    res.set('cache-control', 'public, max-age=30');
    res.json({ campaigns });
  })
);
