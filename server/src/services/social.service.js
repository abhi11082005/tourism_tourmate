import { query, queryOne } from '../db/pool.js';
import { forbidden, notFound } from '../utils/httpError.js';

/** Reviews for a tour, newest first, with the viewer's like state. */
export async function listReviews({ tourId, viewerId, limit = 10, offset = 0 }) {
  const { rows } = await query(
    `SELECT r.id, r.rating, r.content, r.media_urls, r.like_count, r.created_at,
            u.id AS author_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
            EXISTS (
              SELECT 1 FROM review_likes rl
               WHERE rl.review_id = r.id AND rl.user_id = $2::uuid
            ) AS liked_by_me,
            (SELECT COUNT(*)::int FROM comments c WHERE c.review_id = r.id) AS comment_count
       FROM reviews r
       JOIN users u ON u.id = r.user_id
      WHERE r.tour_id = $1
      ORDER BY r.created_at DESC
      LIMIT $3 OFFSET $4`,
    [tourId, viewerId ?? null, limit, offset]
  );
  return rows;
}

/** Only travellers with a confirmed booking may review. */
export async function createReview({ userId, tourId, rating, content, mediaUrls }) {
  const booked = await queryOne(
    `SELECT 1 FROM bookings
      WHERE user_id = $1 AND tour_id = $2 AND status = 'CONFIRMED' LIMIT 1`,
    [userId, tourId]
  );
  if (!booked) throw forbidden('Only travellers who completed this tour can review it');

  return queryOne(
    `INSERT INTO reviews (user_id, tour_id, rating, content, media_urls)
     VALUES ($1, $2, $3, $4, $5::text[])
     ON CONFLICT (user_id, tour_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           content = EXCLUDED.content,
           media_urls = EXCLUDED.media_urls
     RETURNING id, rating, content, media_urls, like_count, created_at`,
    [userId, tourId, rating, content, mediaUrls ?? []]
  );
}

/**
 * Whole comment thread in one indexed range scan, already in display order.
 *
 * Ordering by `path` puts every reply directly under its parent, so the client
 * only has to indent by `depth` — no client-side tree building, no recursive CTE.
 */
export async function listComments({ reviewId, viewerId, limit = 200 }) {
  const { rows } = await query(
    `SELECT c.id, c.parent_id, c.depth, c.content, c.like_count, c.is_deleted, c.created_at,
            u.id AS author_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
            EXISTS (
              SELECT 1 FROM comment_likes cl
               WHERE cl.comment_id = c.id AND cl.user_id = $2::uuid
            ) AS liked_by_me
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.review_id = $1
      ORDER BY c.path
      LIMIT $3`,
    [reviewId, viewerId ?? null, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    depth: r.depth,
    // Deleted comments stay in place so replies beneath them keep their context.
    content: r.is_deleted ? '[removed]' : r.content,
    likeCount: r.like_count,
    likedByMe: r.liked_by_me,
    createdAt: r.created_at,
    author: r.is_deleted
      ? null
      : { id: r.author_id, name: r.author_name, avatarUrl: r.author_avatar },
  }));
}

export async function addComment({ reviewId, userId, parentId, content }) {
  const review = await queryOne('SELECT 1 FROM reviews WHERE id = $1', [reviewId]);
  if (!review) throw notFound('Review not found');

  // path/depth are filled by the comments_set_path trigger, which also rejects
  // a parent from a different review.
  return queryOne(
    `INSERT INTO comments (review_id, user_id, parent_id, content, path)
     VALUES ($1, $2, $3, $4, '')
     RETURNING id, parent_id, depth, content, like_count, created_at`,
    [reviewId, userId, parentId ?? null, content]
  );
}

export async function softDeleteComment({ commentId, userId, role }) {
  const row = await queryOne(
    `UPDATE comments
        SET is_deleted = TRUE
      WHERE id = $1 AND (user_id = $2 OR $3 = 'ADMIN')
      RETURNING id`,
    [commentId, userId, role]
  );
  if (!row) throw forbidden('You can only delete your own comment');
  return row;
}

/** Idempotent like toggle. The counter is maintained by a trigger. */
export async function toggleReviewLike({ reviewId, userId }) {
  const inserted = await queryOne(
    `INSERT INTO review_likes (review_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING review_id`,
    [reviewId, userId]
  );
  if (inserted) return { liked: true };

  await query('DELETE FROM review_likes WHERE review_id = $1 AND user_id = $2', [
    reviewId,
    userId,
  ]);
  return { liked: false };
}

export async function toggleCommentLike({ commentId, userId }) {
  const inserted = await queryOne(
    `INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING comment_id`,
    [commentId, userId]
  );
  if (inserted) {
    await query('UPDATE comments SET like_count = like_count + 1 WHERE id = $1', [commentId]);
    return { liked: true };
  }
  const removed = await queryOne(
    'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING comment_id',
    [commentId, userId]
  );
  if (removed) {
    await query(
      'UPDATE comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
      [commentId]
    );
  }
  return { liked: false };
}

/** Wishlist ("Save for later"). */
export async function toggleWishlist({ userId, tourId }) {
  const inserted = await queryOne(
    `INSERT INTO wishlists (user_id, tour_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING tour_id`,
    [userId, tourId]
  );
  if (inserted) return { saved: true };
  await query('DELETE FROM wishlists WHERE user_id = $1 AND tour_id = $2', [userId, tourId]);
  return { saved: false };
}

export async function listWishlist(userId) {
  const { rows } = await query(
    `SELECT t.id, t.title, t.slug, t.base_price, t.duration_days, t.duration_nights,
            t.gallery -> 0 -> 'url' AS cover_url, w.created_at AS saved_at
       FROM wishlists w JOIN tours t ON t.id = w.tour_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC`,
    [userId]
  );
  return rows;
}
