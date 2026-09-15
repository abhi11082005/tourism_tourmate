#!/usr/bin/env node
/**
 * Fills tour_chunks.embedding (and tours.embedding) so "Ask the Expert" has
 * something to retrieve. Run after `npm run seed`, and again whenever an admin
 * edits a package:
 *
 *   npm run rag:index              # only rows with a NULL embedding
 *   npm run rag:index -- --all     # re-embed everything
 *   npm run rag:index -- --tour <uuid>
 *
 * Chunks are re-derived from the tour's own JSONB (overview, each itinerary day,
 * inclusions/exclusions, each priced option) so the index can always be rebuilt
 * from the source of truth rather than from whatever the seed happened to write.
 */
import { query, withTransaction, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/db/redis.js';
import { embed } from '../src/services/rag.service.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

const args = process.argv.slice(2);
const reEmbedAll = args.includes('--all');
const tourFilter = args[args.indexOf('--tour') + 1];
const onlyTour = args.includes('--tour') ? tourFilter : null;

const toVectorLiteral = (v) => `[${v.join(',')}]`;

/**
 * Flatten one tour row into the passages a traveller might ask about.
 * `kind`/`ref` match what 0003_seed.sql writes, so re-indexing upserts the
 * seeded rows in place rather than leaving duplicates behind.
 */
function chunksForTour(tour) {
  const out = [];
  const push = (kind, ref, content) => {
    const text = String(content ?? '').trim();
    if (text.length >= 20) out.push({ kind, ref, content: text });
  };

  push('overview', null, `${tour.title}\n${tour.overview}`);
  push(
    'pricing',
    null,
    `${tour.title} costs ₹${tour.base_price} per seat for ${tour.duration_days} days and ` +
      `${tour.duration_nights} nights.`
  );

  for (const [i, day] of (tour.itinerary ?? []).entries()) {
    const dayNo = day.day ?? i + 1;
    const body = [day.summary, day.description, ...(day.activities ?? [])]
      .filter(Boolean)
      .join('. ');
    push('itinerary_day', `day:${dayNo}`, `Day ${dayNo} — ${day.title ?? ''}: ${body}`);
  }

  if (tour.inclusions?.length) push('inclusions', null, `Included: ${tour.inclusions.join(', ')}.`);
  if (tour.exclusions?.length) push('exclusions', null, `Not included: ${tour.exclusions.join(', ')}.`);

  push('options', null, `Upgrade options and per-seat prices: ${JSON.stringify(tour.options)}`);

  if (tour.refund_policy?.length) {
    const tiers = tour.refund_policy
      .map((t) => `${t.refundPercent}% back if cancelled ${t.daysBefore}+ days before departure`)
      .join('; ');
    push('refund', null, `Cancellation policy: ${tiers}.`);
  }

  return out;
}

async function main() {
  const { rows: tours } = await query(
    `SELECT id, title, slug, overview, base_price, duration_days, duration_nights,
            itinerary, inclusions, exclusions, options, refund_policy
       FROM tours
      WHERE ($1::uuid IS NULL OR id = $1::uuid)
      ORDER BY created_at`,
    [onlyTour ?? null]
  );

  if (!tours.length) {
    logger.warn('no tours matched — run `npm run seed` first');
    return;
  }

  let embedded = 0;
  let skipped = 0;

  for (const tour of tours) {
    const chunks = chunksForTour(tour);

    // Replace this tour's chunk set in one transaction so a failed run never
    // leaves the assistant retrieving half of an old itinerary.
    await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        'SELECT kind, ref, content, embedding IS NOT NULL AS has_embedding FROM tour_chunks WHERE tour_id = $1',
        [tour.id]
      );
      const seen = new Map(existing.map((r) => [`${r.kind}|${r.ref ?? ''}`, r]));

      for (const chunk of chunks) {
        const key = `${chunk.kind}|${chunk.ref ?? ''}`;
        const prior = seen.get(key);
        const unchanged = prior?.content === chunk.content && prior.has_embedding;

        if (unchanged && !reEmbedAll) {
          skipped += 1;
          seen.delete(key);
          continue;
        }

        const vector = await embed(chunk.content);
        await client.query(
          `INSERT INTO tour_chunks (tour_id, kind, ref, content, embedding)
           VALUES ($1, $2, $3, $4, $5::vector)
           ON CONFLICT (tour_id, kind, COALESCE(ref, '')) DO UPDATE
             SET content = EXCLUDED.content, embedding = EXCLUDED.embedding`,
          [tour.id, chunk.kind, chunk.ref, chunk.content, toVectorLiteral(vector)]
        );
        embedded += 1;
        seen.delete(key);
      }

      // Anything left in `seen` describes content the admin has since deleted.
      for (const stale of seen.values()) {
        await client.query(
          'DELETE FROM tour_chunks WHERE tour_id = $1 AND kind = $2 AND ref IS NOT DISTINCT FROM $3',
          [tour.id, stale.kind, stale.ref]
        );
      }

      // Tour-level vector powers "packages like this one" on the listing page.
      const summary = chunks
        .filter((c) => c.kind === 'overview' || c.kind === 'itinerary_day')
        .map((c) => c.content)
        .join(' ')
        .slice(0, 4_000);
      const tourVector = await embed(summary);
      await client.query('UPDATE tours SET embedding = $2::vector WHERE id = $1', [
        tour.id,
        toVectorLiteral(tourVector),
      ]);
    });

    logger.info({ tour: tour.slug, chunks: chunks.length }, 'indexed');
  }

  logger.info({ tours: tours.length, embedded, skipped, dim: env.EMBEDDING_DIM }, 'rag index complete');
}

try {
  await main();
} catch (err) {
  logger.error({ err }, 'rag indexing failed');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([closePool(), closeRedis()]);
}
