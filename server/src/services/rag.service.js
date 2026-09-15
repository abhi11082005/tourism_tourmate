import { query, queryOne } from '../db/pool.js';
import { env } from '../config/env.js';
import { redis } from '../db/redis.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

/*
 * "Ask the Expert" — RAG over the tour's own data.
 *
 * Retrieval:  pgvector cosine distance (<=>) over tour_chunks, restricted to the
 *             tour on screen so answers can never leak another package's prices.
 * Live facts: seat availability and the price of the exact configuration are read
 *             from Postgres/Redis and injected as ground truth, because embeddings
 *             go stale the moment inventory moves.
 * Generation: a free-tier LLM, streamed. Budget is 3s end to end, so retrieval is
 *             capped at 5 chunks and the answer is capped at ~220 tokens.
 */

const EMBED_CACHE_PREFIX = 'rag:embed:';
const EMBED_CACHE_TTL = 60 * 60 * 24;

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: () => ({
      authorization: `Bearer ${env.LLM_API_KEY}`,
      'content-type': 'application/json',
    }),
  },
  gemini: {
    url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    headers: () => ({
      authorization: `Bearer ${env.LLM_API_KEY}`,
      'content-type': 'application/json',
    }),
  },
};

/**
 * Embed a query. Cached in Redis because travellers ask the same handful of
 * questions ("is the AC worth it?") and each embedding call costs ~200ms.
 */
export async function embed(text) {
  const key = `${EMBED_CACHE_PREFIX}${Buffer.from(text).toString('base64url').slice(0, 80)}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached);

  const vector = await embedViaProvider(text);
  await redis.set(key, JSON.stringify(vector), 'EX', EMBED_CACHE_TTL).catch(() => {});
  return vector;
}

async function embedViaProvider(text) {
  // Swap this for your embeddings endpoint (Ollama nomic-embed-text locally,
  // or any OpenAI-compatible /embeddings route). Dimension must match the column.
  const res = await fetch(`${process.env.EMBEDDING_URL ?? 'http://localhost:11434/api/embeddings'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text', prompt: text }),
  }).catch(() => null);

  if (!res?.ok) {
    throw new HttpError(503, 'The assistant is warming up, try again in a moment', {
      code: 'EMBEDDING_UNAVAILABLE',
    });
  }
  const body = await res.json();
  const vector = body.embedding ?? body.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new HttpError(503, 'Embedding response was malformed');
  if (vector.length !== env.EMBEDDING_DIM) {
    throw new HttpError(
      500,
      `Embedding dimension ${vector.length} does not match the vector(${env.EMBEDDING_DIM}) column`
    );
  }
  return vector;
}

/** pgvector literal: '[0.1,0.2,...]'. Passed as a bound parameter, never inlined. */
const toVectorLiteral = (v) => `[${v.join(',')}]`;

/** Top-k passages for this tour by cosine distance. */
export async function retrieve({ tourId, queryVector, k = 5 }) {
  const { rows } = await query(
    `SELECT c.kind, c.ref, c.content,
            1 - (c.embedding <=> $2::vector) AS similarity
       FROM tour_chunks c
      WHERE c.tour_id = $1
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2::vector
      LIMIT $3`,
    [tourId, toVectorLiteral(queryVector), k]
  );
  return rows;
}

/** Ground truth the model is not allowed to contradict. */
async function liveFacts(tourId) {
  const tour = await queryOne(
    `SELECT t.title, t.base_price, t.duration_days, t.duration_nights, t.options,
            t.refund_policy
       FROM tours t WHERE t.id = $1`,
    [tourId]
  );
  const { rows: slots } = await query(
    `SELECT s.slot_date::text AS date,
            s.total_seats - COALESCE(SUM(b.seat_count)
              FILTER (WHERE b.status = 'CONFIRMED'), 0)::int AS seats_left,
            s.price_modifier
       FROM tour_slots s
       LEFT JOIN bookings b ON b.slot_id = s.id
      WHERE s.tour_id = $1 AND s.is_open AND s.slot_date >= CURRENT_DATE
      GROUP BY s.id
      ORDER BY s.slot_date
      LIMIT 14`,
    [tourId]
  );
  return { tour, slots };
}

function buildPrompt({ question, chunks, facts }) {
  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.kind}${c.ref ? ` ${c.ref}` : ''}) ${c.content}`)
    .join('\n');

  const availability = facts.slots
    .map((s) => `${s.date}: ${s.seats_left} seats${Number(s.price_modifier) ? ` (+₹${s.price_modifier}/seat)` : ''}`)
    .join('; ');

  return [
    {
      role: 'system',
      content:
        'You are the booking expert for Tour Mate. Answer only from CONTEXT and LIVE DATA. ' +
        'If the answer is not there, say you will check with the operations team. ' +
        'Quote prices in INR per seat. Be concrete and under 90 words. Never invent dates or seat counts.',
    },
    {
      role: 'user',
      content:
        `TOUR: ${facts.tour.title} (${facts.tour.duration_days}D/${facts.tour.duration_nights}N, ` +
        `base ₹${facts.tour.base_price}/seat)\n` +
        `LIVE AVAILABILITY: ${availability || 'no open dates'}\n` +
        `UPGRADE PRICES: ${JSON.stringify(facts.tour.options)}\n` +
        `REFUND POLICY: ${JSON.stringify(facts.tour.refund_policy)}\n\n` +
        `CONTEXT:\n${context}\n\nQUESTION: ${question}`,
    },
  ];
}

/**
 * Streams the answer as Server-Sent Events. Streaming is what keeps the
 * perceived latency under the 3s budget even when the model is slow.
 * @param {import('express').Response} res
 */
export async function answerStream({ tourId, question, res }) {
  if (env.LLM_PROVIDER === 'none' || !env.LLM_API_KEY) {
    throw new HttpError(503, 'The assistant is not configured on this environment', {
      code: 'LLM_NOT_CONFIGURED',
    });
  }
  const provider = PROVIDERS[env.LLM_PROVIDER];

  const [queryVector, facts] = await Promise.all([embed(question), liveFacts(tourId)]);
  const chunks = await retrieve({ tourId, queryVector });

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`event: sources\ndata: ${JSON.stringify(chunks.map((c) => ({ kind: c.kind, ref: c.ref })))}\n\n`);

  const upstream = await fetch(provider.url, {
    method: 'POST',
    headers: provider.headers(),
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages: buildPrompt({ question, chunks, facts }),
      max_tokens: 260,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Assistant unavailable' })}\n\n`);
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const token = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (token) res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
        } catch {
          // Partial JSON across chunk boundaries — the next read completes it.
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'assistant stream broke');
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream interrupted' })}\n\n`);
  } finally {
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
}
