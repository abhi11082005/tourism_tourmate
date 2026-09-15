import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler, asyncHandler } from './middleware/index.js';
import { query } from './db/pool.js';
import { redis } from './db/redis.js';
import cookieParser from 'cookie-parser';

export function createApp() {
  const app = express();
  app.use(cookieParser());

  // Behind nginx/Render/Fly: trust one proxy hop so express-rate-limit and the
  // logger see the real client IP instead of the load balancer's.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs on the client origin, which loads
      // Mapbox tiles/workers and would need a much looser policy than this.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = curl, mobile webview, server-to-server. Allow it;
        // cookies are not used for auth, the token travels in Authorization.
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        cb(new Error(`Origin ${origin} is not allowed`));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    })
  );

  app.use(
    compression({
      filter(req, res) {
        // The assistant streams Server-Sent Events. Compression buffers them and
        // the first token would arrive late, blowing the 3-second budget.
        if (res.getHeader('content-type')?.toString().includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    })
  );

  app.use(
    express.json({
      limit: '256kb',
      // Gateway webhooks sign the exact bytes sent; keep them for HMAC checks.
      verify(req, _res, buf) {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise dominate the log.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    })
  );

  /**
   * Liveness + dependency check. Reports which backing store is down so a deploy
   * can be rolled back before customers hit a checkout that cannot hold seats.
   */
  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      const [postgres, cache] = await Promise.allSettled([query('SELECT 1'), redis.ping()]);
      const checks = {
        postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
        redis: cache.status === 'fulfilled' && cache.value === 'PONG' ? 'up' : 'down',
      };
      const healthy = Object.values(checks).every((v) => v === 'up');
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        checks,
        env: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
      });
    })
  );

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!isProd) logger.debug('app built in development mode');
  return app;
}
