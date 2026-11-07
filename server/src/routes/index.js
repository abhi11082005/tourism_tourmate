// backend/src/routes/api.routes.js
import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { userRouter } from './users.routes.js';
import { tourRouter } from './tours.routes.js';
import { attractionRouter } from './attractions.routes.js';
import { bookingRouter } from './bookings.routes.js';
import { socialRouter } from './social.routes.js';
import { routingRouter } from './routing.routes.js';
import { assistantRouter } from './assistant.routes.js';
import { supportRouter } from './support.routes.js';
import { adminRouter } from './admin.routes.js';
import { campaignRouter } from './campaigns.routes.js';
import { spotlightRouter } from './spotlight.routes.js'; // Added the new spotlight router

export const apiRouter = Router();

/*
 * ==========================================
 * ROUTE MOUNTING BY ACCESS LEVEL
 * ==========================================
 */

/*
 * 1. GUEST-VISIBLE SURFACE (Public Access)
 * Accessible without authentication.
 * Includes: Discovery, curated spotlights, public reviews, AI assistant queries, and routing.
 */
apiRouter.use('/tours', tourRouter);
apiRouter.use('/attractions', attractionRouter);
apiRouter.use('/spotlights', spotlightRouter); // Mount the highly optimized PostGIS spotlight route
apiRouter.use('/social', socialRouter); // Note: Should have internal checks to only allow GET/reads
apiRouter.use('/campaigns', campaignRouter); // Note: Should restrict to /campaigns/active for guests
apiRouter.use('/assistant', assistantRouter);
apiRouter.use('/routing', routingRouter);

/*
 * 2. AUTHENTICATION (Public / Session Management)
 */
apiRouter.use('/auth', authRouter);

/*
 * 3. HYBRID BOUNDARIES (Mixed Access)
 * These routers contain both public routes and protected routes.
 * The protection middleware (e.g., JWT verification) MUST be applied 
 * inside these specific route files for their protected endpoints.
 * 
 * - bookings: /calendar, /availability, /quote are PUBLIC. /checkout is PROTECTED.
 * - support: FAQs are PUBLIC. /tickets are PROTECTED.
 */
apiRouter.use('/bookings', bookingRouter); 
apiRouter.use('/support', supportRouter);

/*
 * 4. LOGIN REQUIRED (Protected Surface)
 * Strict authentication boundary. User must be signed in.
 */
apiRouter.use('/users', userRouter); 
// Note: If you want to strictly protect writes to /social at the top level, 
// you would apply an auth middleware here, but since reads are public, 
// the auth middleware should be applied inside social.routes.js for POST/PUT/DELETE.

/*
 * 5. ADMIN ONLY
 * Strict authorization boundary. User must have 'admin' role.
 */
// The admin auth and role-check middleware should be applied directly inside admin.routes.js
apiRouter.use('/admin', adminRouter);