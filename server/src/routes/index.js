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

export const apiRouter = Router();

/*
 * Guest-visible surface:  /tours, /attractions, /social (reads),
 *                         /bookings/calendar|availability|quote, /assistant/ask, /routing
 * Login required:         /bookings/checkout and everything after it (payment boundary),
 *                         /social writes, /auth/me, all of /users, all of /support
 * Admin only:             /admin/*, /support/tickets/inbox, /support/tickets/:id/status
 */
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/tours', tourRouter);
apiRouter.use('/attractions', attractionRouter);
apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/social', socialRouter);
apiRouter.use('/routing', routingRouter);
apiRouter.use('/assistant', assistantRouter);
apiRouter.use('/support', supportRouter);
apiRouter.use('/admin', adminRouter);
