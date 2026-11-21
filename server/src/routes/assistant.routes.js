import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate, asyncHandler } from '../middleware/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { answerStream } from '../services/rag.service.js';
import { queryOne } from '../db/pool.js';
import { HttpError, notFound } from '../utils/httpError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { openSse, sendEvent } from '../assistant/sse.js';
import { createLlm } from '../assistant/llm.js';
import { buildTools } from '../assistant/tools/index.js';
import { defaultDeps } from '../assistant/tools/deps.js';
import { buildAssistantGraph } from '../assistant/graph.js';
import { createTourResolver } from '../assistant/tourResolver.js';
import {
  createConversation,
  getOwnedConversation,
  recentMessages,
  appendMessage,
  setConversationTour,
} from '../services/assistantConversations.service.js';

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

/* ------------------------------------------------------------------ /chat
 * Central assistant (LangGraph). One endpoint for every page; the optional
 * `tourId` says which tour the traveller is looking at. /ask above is unchanged.
 *
 *   auth        optionalAuth — guests may chat, signed-in users own their history
 *   ownership   conversationId must belong to the caller (user id, or guest key)
 *   streaming   SSE events: meta, intent, tool, sources, token, error, done
 *
 * Phase 1 tools are read-only: nothing here holds seats or touches payments.
 */

// A turn can fan out to several DB calls plus an LLM call, so it is limited
// separately from (and slightly above) the legacy single-shot /ask.
const chatLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7' });

const HISTORY_TURNS = 6;
const clip = (s, n = 500) => (s.length > n ? s.slice(0, n) : s);

// Built once, on first use, so booting the API never depends on the assistant.
let graphPromise;
function getGraph() {
  graphPromise ??= defaultDeps()
    .then((deps) =>
      buildAssistantGraph({
        tools: buildTools(deps),
        llm: createLlm(),
        resolveTour: createTourResolver({ db: deps.db }),
        log: logger,
      })
    )
    .catch((err) => {
      graphPromise = undefined; // retry on the next request instead of caching a failure
      throw err;
    });
  return graphPromise;
}

const guestKeySchema = z.string().min(16).max(64).optional();

assistantRouter.post(
  '/chat',
  optionalAuth,
  chatLimiter,
  validate(
    'body',
    z.object({
      message: z.string().trim().min(2).max(500),
      conversationId: z.string().uuid().optional(),
      guestKey: guestKeySchema,
      tourId: z.string().uuid().optional(),
      location: z
        .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
        .optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    if (env.LLM_PROVIDER === 'none' || !env.LLM_API_KEY) {
      throw new HttpError(503, 'The assistant is not configured on this environment', {
        code: 'LLM_NOT_CONFIGURED',
      });
    }

    const { message, conversationId, guestKey, tourId, location } = req.body;
    const user = req.user ? { id: req.user.id, role: req.user.role } : null;

    if (tourId) {
      const tour = await queryOne('SELECT 1 FROM tours WHERE id = $1 AND is_published', [tourId]);
      if (!tour) throw notFound('Tour not found');
    }

    // Ownership is checked BEFORE anything is streamed or written.
    const conversation = conversationId
      ? await getOwnedConversation({ conversationId, userId: user?.id, guestKey })
      : await createConversation({ userId: user?.id, tourId: tourId ?? null });

    const history = (await recentMessages(conversation.id, HISTORY_TURNS)).map((m) => ({
      role: m.role,
      content: clip(m.content),
      intent: m.intent ?? null, // lets "yes" / "what happens" carry on the previous topic
    }));

    await appendMessage({ conversationId: conversation.id, role: 'user', content: message });

    const graph = await getGraph();

    openSse(res);
    sendEvent(res, 'meta', {
      conversationId: conversation.id,
      // The raw guest key is shown exactly once, when the conversation is created.
      ...(conversation.guestKey ? { guestKey: conversation.guestKey } : {}),
    });

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const state = await graph.invoke(
        {
          question: message,
          history,
          context: {
            tourId: tourId ?? null,
            user,
            location: location ?? null,
            focusTourId: conversation.tourId ?? null,
          },
        },
        {
          configurable: {
            emit: (event, data) => sendEvent(res, event, data),
            signal: controller.signal,
          },
        }
      );

      // Remember the tour this chat is now about, so the next message need not name it again.
      const aboutTour = state.context?.tourId ?? null;
      if (aboutTour && aboutTour !== conversation.tourId) {
        await setConversationTour(conversation.id, aboutTour).catch((err) =>
          logger.error({ err }, 'assistant: could not store conversation tour')
        );
      }

      await appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: state.answer ?? '',
        intent: state.intent,
        toolCalls: state.toolResults.map(({ name, group, ok }) => ({ name, group, ok })),
      }).catch((err) => logger.error({ err }, 'assistant: could not store reply'));
    } catch (err) {
      if (!controller.signal.aborted) {
        logger.error({ err }, 'assistant graph failed');
        sendEvent(res, 'error', { message: 'Assistant unavailable' });
      }
    } finally {
      sendEvent(res, 'done', {});
      res.end();
    }
  })
);

/*
 * Replay a conversation the caller owns. POST rather than GET so a guest's key
 * travels in the body — CORS only allows Content-Type/Authorization headers, and
 * a key in the URL would end up in access logs.
 */
assistantRouter.post(
  '/conversations/:id/history',
  optionalAuth,
  validate('params', z.object({ id: z.string().uuid() })),
  validate('body', z.object({ guestKey: guestKeySchema })),
  asyncHandler(async (req, res) => {
    const conversation = await getOwnedConversation({
      conversationId: req.params.id,
      userId: req.user?.id,
      guestKey: req.body.guestKey,
    });
    const messages = await recentMessages(conversation.id, 50);
    res.json({
      conversationId: conversation.id,
      messages: messages.map(({ role, content, created_at }) => ({ role, text: content, at: created_at })),
    });
  })
);
