/*
 * RAG tools: descriptions, itinerary and policies from the indexed tour content.
 *
 * Scoping is unchanged from the legacy assistant: with a tour on screen, retrieval
 * is restricted to that tour (existing `retrieve`), so answers cannot leak another
 * package's prices. Without one (the central chatbot), search spans published tours only.
 */

const clip = (s, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function ragTools(deps) {
  async function retrieveAcrossTours(vector, k = 5) {
    const { rows } = await deps.db.query(
      `SELECT c.kind, c.ref, c.content, t.title AS tour_title, t.slug,
              1 - (c.embedding <=> $1::vector) AS similarity
         FROM tour_chunks c
         JOIN tours t ON t.id = c.tour_id AND t.is_published
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2`,
      [`[${vector.join(',')}]`, k]
    );
    return rows;
  }

  return [
    {
      name: 'tour_knowledge',
      group: 'rag',
      async run(ctx, { question }) {
        const vector = await deps.rag.embed(question);
        const rows = ctx.tourId
          ? await deps.rag.retrieve({ tourId: ctx.tourId, queryVector: vector, k: 5 })
          : await retrieveAcrossTours(vector, 5);
        return {
          data: {
            passages: rows.map((r) => ({
              kind: r.kind,
              ref: r.ref ?? null,
              tour: r.tour_title ?? undefined,
              text: clip(r.content),
            })),
          },
          sources: rows.map((r) => ({ kind: r.kind, ref: r.ref ?? null })),
        };
      },
    },
    {
      name: 'tour_policies',
      group: 'rag',
      async run(ctx) {
        if (!ctx.tourId) return { data: { needsTour: true } };
        const row = await deps.db.queryOne(
          `SELECT title, refund_policy, inclusions, exclusions
             FROM tours WHERE id = $1 AND is_published`,
          [ctx.tourId]
        );
        if (!row) return { data: { needsTour: true } };
        return {
          data: {
            tour: row.title,
            refundPolicy: row.refund_policy,
            inclusions: row.inclusions,
            exclusions: row.exclusions,
          },
          sources: [{ kind: 'policy', ref: 'refund' }],
        };
      },
    },
  ];
}
