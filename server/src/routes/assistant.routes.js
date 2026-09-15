import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate, asyncHandler } from '../middleware/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { answerStream } from '../services/rag.service.js';
import { queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

export const assistantRouter = Router();

// LLM calls cost money and time; 12/min per IP is plenty for a chat panel.
const askLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7' });

/**
 * "Ask the Expert". Streams Server-Sent Events (`sources`, `token`, `done`) so the
 * first words reach the user well inside the 3-second budget.
 * Guest accessible — the panel sits on the tour page, before login.
 */
assistantRouter.post(
  '/ask',
  optionalAuth,
  askLimiter,
  validate(
    'body',
    z.object({
      tourId: z.string().uuid(),
      question: z.string().trim().min(3).max(500),
    })
  ),
  asyncHandler(async (req, res) => {
    const tour = await queryOne('SELECT 1 FROM tours WHERE id = $1 AND is_published', [
      req.body.tourId,
    ]);
    if (!tour) throw notFound('Tour not found');

    // Client may vanish mid-stream; stop writing when it does.
    req.on('close', () => res.destroyed || res.end());

    await answerStream({ tourId: req.body.tourId, question: req.body.question, res });
  })
);
