/*
 * Which tour is the traveller talking about?
 *
 * On a tour page the answer is the page. In the central chat it has to come from
 * the words: a pasted link ("…/tours/pink-city-heritage-trail"), a slug, or the name
 * ("book pink city heritage trail on 21 november"). Matching is deterministic and runs
 * over the published catalogue only, so a message can never point the assistant at a
 * draft tour, and the model never decides which tour a price is quoted for.
 *
 * The catalogue is small (published tours: id, slug, title) and cached briefly.
 */

const TITLE_STOP = new Set(['the', 'and', 'for', 'tour', 'tours', 'trip', 'package', 'packages']);
const SLUG_IN_URL = /\/tours\/([a-z0-9][a-z0-9-]*)/i;

const words = (text) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * @param {{ db: { query: Function }, ttlMs?: number, clock?: () => number }} deps
 */
export function createTourResolver({ db, ttlMs = 60_000, clock = Date.now }) {
  let cache = { at: -Infinity, tours: [] };

  async function catalogue() {
    if (clock() - cache.at > ttlMs) {
      const { rows } = await db.query('SELECT id, slug, title FROM tours WHERE is_published');
      cache = {
        at: clock(),
        tours: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          // Words that identify the tour: "Pink City Heritage Trail" -> pink city heritage trail.
          tokens: [...new Set(words(r.title).filter((w) => w.length >= 3 && !TITLE_STOP.has(w)))],
        })),
      };
    }
    return cache.tours;
  }

  /** The tour named in the message, or null when none (or several) fit. */
  async function resolve(question) {
    const tours = await catalogue();

    const slug = question.match(SLUG_IN_URL)?.[1]?.toLowerCase();
    if (slug) {
      const hit = tours.find((t) => t.slug === slug);
      if (hit) return { tourId: hit.id, slug: hit.slug, title: hit.title };
    }

    const said = new Set(words(question));
    const scored = tours
      .map((t) => ({ t, hits: t.tokens.filter((w) => said.has(w)).length }))
      // Needs most of the name, and never just one common word like "heritage".
      .filter(({ t, hits }) => hits >= 2 && hits / t.tokens.length >= 0.75)
      .sort((a, b) => b.hits / b.t.tokens.length - a.hits / a.t.tokens.length || b.hits - a.hits);

    if (!scored.length) return null;
    const [best, runnerUp] = scored;
    const ratio = (x) => x.hits / x.t.tokens.length;
    // Two tours fit equally well: do not guess which one was meant.
    if (runnerUp && ratio(runnerUp) === ratio(best) && runnerUp.hits === best.hits) return null;
    return { tourId: best.t.id, slug: best.t.slug, title: best.t.title };
  }

  /** Catalogue entry for a tour id (page or conversation focus), for naming it in the reply. */
  async function describe(tourId) {
    if (!tourId) return null;
    const hit = (await catalogue()).find((t) => t.id === tourId);
    return hit ? { tourId: hit.id, slug: hit.slug, title: hit.title } : null;
  }

  return { resolve, describe };
}
