-- =====================================================================
-- 0002_indexes.sql — everything the query planner needs.
--   psql "$DATABASE_URL" -f db/migrations/0002_indexes.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------- spatial (Near Me / pins)
-- ST_DWithin on geography (metres) only uses an index built on the cast.
CREATE INDEX IF NOT EXISTS attractions_location_geog_gist
  ON attractions USING GIST ((location::geography));
CREATE INDEX IF NOT EXISTS attractions_location_gist
  ON attractions USING GIST (location);
CREATE INDEX IF NOT EXISTS attractions_category_idx
  ON attractions (category);
CREATE INDEX IF NOT EXISTS attractions_mood_tags_gin
  ON attractions USING GIN (mood_tags);
CREATE INDEX IF NOT EXISTS tours_start_point_gist
  ON tours USING GIST ((start_point::geography));

-- ------------------------------------------------------ vector (RAG)
-- HNSW: no training step, good recall at low ef_search. Operator class must
-- match the distance operator used in the query (<=> is cosine).
CREATE INDEX IF NOT EXISTS tours_embedding_hnsw
  ON tours USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS tour_chunks_embedding_hnsw
  ON tour_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS tour_chunks_tour_idx
  ON tour_chunks (tour_id);
-- One passage per (tour, kind, ref) so `npm run rag:index` can upsert instead of
-- duplicating. COALESCE because a NULL ref would otherwise never collide.
CREATE UNIQUE INDEX IF NOT EXISTS tour_chunks_identity_uniq
  ON tour_chunks (tour_id, kind, COALESCE(ref, ''));

-- ----------------------------------------------------- JSONB + search
CREATE INDEX IF NOT EXISTS tours_options_gin
  ON tours USING GIN (options jsonb_path_ops);
CREATE INDEX IF NOT EXISTS tours_inclusions_gin
  ON tours USING GIN (inclusions jsonb_path_ops);
CREATE INDEX IF NOT EXISTS tours_title_trgm
  ON tours USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tours_published_price_idx
  ON tours (base_price) WHERE is_published;

-- -------------------------------------------- inventory & availability
CREATE INDEX IF NOT EXISTS tour_slots_calendar_idx
  ON tour_slots (tour_id, slot_date) WHERE is_open;
CREATE INDEX IF NOT EXISTS tour_slots_guide_idx
  ON tour_slots (guide_id) WHERE guide_id IS NOT NULL;

-- The availability aggregate reads only live rows; INCLUDE makes it index-only.
CREATE INDEX IF NOT EXISTS bookings_live_seats_idx
  ON bookings (slot_id) INCLUDE (seat_count)
  WHERE status IN ('PENDING', 'CONFIRMED');
CREATE INDEX IF NOT EXISTS bookings_user_recent_idx
  ON bookings (user_id, created_at DESC);
-- Sweeper: find PENDING rows whose hold has lapsed.
CREATE INDEX IF NOT EXISTS bookings_expiry_idx
  ON bookings (expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS payments_booking_idx
  ON payments (booking_id, created_at DESC);

-- ------------------------------------------------------------- social
CREATE INDEX IF NOT EXISTS reviews_tour_recent_idx
  ON reviews (tour_id, created_at DESC);
-- Whole comment thread in one ordered range scan.
CREATE INDEX IF NOT EXISTS comments_review_path_idx
  ON comments (review_id, path text_pattern_ops);
CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON comments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wishlists_tour_idx
  ON wishlists (tour_id);

COMMIT;

-- Keep planner stats fresh on the hot tables after seeding.
ANALYZE tours;
ANALYZE tour_slots;
ANALYZE bookings;
ANALYZE attractions;
