-- =====================================================================
-- Tour Mate — 0001_init.sql
-- Plain PostgreSQL DDL. No ORM: Express talks to this schema through
-- node-postgres with hand-written SQL.
--   psql "$DATABASE_URL" -f db/migrations/0001_init.sql
-- Idempotent enough to re-run on a fresh database; drops nothing.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;     -- geometry(Point,4326), ST_DWithin
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, <=> cosine distance
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy title search
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ------------------------------------------------------------- enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('USER', 'GUIDE', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attraction_category AS ENUM ('MUST_VISIT', 'MUST_EAT', 'FAMOUS_RIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE auth_provider AS ENUM ('LOCAL', 'GOOGLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared updated_at trigger.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT      NOT NULL UNIQUE,  -- case-insensitive: no dupe logins
  password_hash  TEXT,                       -- NULL for OAuth-only accounts
  full_name      TEXT        NOT NULL,
  phone          TEXT,
  avatar_url     TEXT,
  role           user_role   NOT NULL DEFAULT 'USER',
  provider       auth_provider NOT NULL DEFAULT 'LOCAL',
  provider_id    TEXT,                       -- Google `sub`
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_local_needs_password
    CHECK (provider <> 'LOCAL' OR password_hash IS NOT NULL),
  CONSTRAINT users_oauth_needs_provider_id
    CHECK (provider = 'LOCAL' OR provider_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_provider_id_key
  ON users (provider, provider_id) WHERE provider_id IS NOT NULL;

DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------------------- tours
CREATE TABLE IF NOT EXISTS tours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT           NOT NULL,
  slug            TEXT           NOT NULL UNIQUE,
  overview        TEXT           NOT NULL,
  tour_type       TEXT           NOT NULL DEFAULT 'HERITAGE',
  base_price      NUMERIC(10, 2) NOT NULL CHECK (base_price >= 0),
  total_seats     INTEGER        NOT NULL CHECK (total_seats > 0),
  duration_days   SMALLINT       NOT NULL CHECK (duration_days > 0),
  duration_nights SMALLINT       NOT NULL CHECK (duration_nights >= 0),
  start_point     geometry(Point, 4326),
  -- Flexible admin-authored content. See docs/jsonb-contracts.md for shapes.
  itinerary       JSONB          NOT NULL DEFAULT '[]'::jsonb,
  inclusions      JSONB          NOT NULL DEFAULT '[]'::jsonb,
  exclusions      JSONB          NOT NULL DEFAULT '[]'::jsonb,
  options         JSONB          NOT NULL DEFAULT '{}'::jsonb,
  gallery         JSONB          NOT NULL DEFAULT '[]'::jsonb,
  refund_policy   JSONB          NOT NULL DEFAULT '[]'::jsonb,
  -- 768 = Ollama nomic-embed-text, the free local default. Must match
  -- EMBEDDING_DIM in the server env; change both together.
  embedding       vector(768),
  is_published    BOOLEAN        NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tours_touch ON tours;
CREATE TRIGGER tours_touch BEFORE UPDATE ON tours
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -------------------------------------------------------- attractions
CREATE TABLE IF NOT EXISTS attractions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT                NOT NULL,
  category      attraction_category NOT NULL,
  description   TEXT                NOT NULL DEFAULT '',
  location      geometry(Point, 4326) NOT NULL,
  image_url     TEXT,
  city          TEXT,
  -- Sensory routing inputs, 0..1. Mood weights combine these per request.
  scenic_score  REAL                NOT NULL DEFAULT 0.5 CHECK (scenic_score BETWEEN 0 AND 1),
  noise_score   REAL                NOT NULL DEFAULT 0.5 CHECK (noise_score BETWEEN 0 AND 1),
  crowd_score   REAL                NOT NULL DEFAULT 0.5 CHECK (crowd_score BETWEEN 0 AND 1),
  mood_tags     TEXT[]              NOT NULL DEFAULT '{}',
  avg_visit_min INTEGER             NOT NULL DEFAULT 45 CHECK (avg_visit_min > 0),
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tour_attractions (
  tour_id       UUID    NOT NULL REFERENCES tours(id)       ON DELETE CASCADE,
  attraction_id UUID    NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
  visit_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tour_id, attraction_id)
);

-- ---------------------------------------------- tour_slots (inventory)
-- Seat inventory is per departure date, not per tour: admins open dates,
-- set capacity, and assign a guide. This table is the availability source
-- of truth; Redis only holds short-lived checkout locks on top of it.
CREATE TABLE IF NOT EXISTS tour_slots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id        UUID        NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  slot_date      DATE        NOT NULL,
  total_seats    INTEGER     NOT NULL CHECK (total_seats > 0),
  price_modifier NUMERIC(10, 2) NOT NULL DEFAULT 0,  -- seasonal +/- on base_price
  guide_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  route_geojson  JSONB,      -- guide's recommended route for Guided Tour Mode
  is_open        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tour_id, slot_date)
);

DROP TRIGGER IF EXISTS tour_slots_touch ON tour_slots;
CREATE TRIGGER tour_slots_touch BEFORE UPDATE ON tour_slots
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------- bookings
CREATE TABLE IF NOT EXISTS bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT           NOT NULL UNIQUE,   -- human-facing, e.g. TM-8F3K2Q
  user_id          UUID           NOT NULL REFERENCES users(id),
  tour_id          UUID           NOT NULL REFERENCES tours(id),
  slot_id          UUID           NOT NULL REFERENCES tour_slots(id) ON DELETE RESTRICT,
  booking_date     DATE           NOT NULL,
  seat_count       INTEGER        NOT NULL CHECK (seat_count > 0),
  -- Server-computed from tours.options; never trusted from the client.
  total_amount     NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
  price_breakdown  JSONB          NOT NULL DEFAULT '{}'::jsonb,
  selected_options JSONB          NOT NULL DEFAULT '{}'::jsonb,
  status           booking_status  NOT NULL DEFAULT 'PENDING',
  hold_id          TEXT UNIQUE,   -- Redis hold this booking came from (idempotency)
  expires_at       TIMESTAMPTZ,   -- PENDING rows die here
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS bookings_touch ON bookings;
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------- payments
-- Card data never touches this database. We store only the gateway's
-- identifiers so the PCI-DSS scope stays with Razorpay/Stripe.
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID           NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  gateway         TEXT           NOT NULL,
  gateway_order_id TEXT          NOT NULL,
  gateway_payment_id TEXT,
  status          payment_status NOT NULL DEFAULT 'INITIATED',
  amount          NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  currency        CHAR(3)        NOT NULL DEFAULT 'INR',
  signature_verified BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_webhook     JSONB,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (gateway, gateway_order_id)
);

DROP TRIGGER IF EXISTS payments_touch ON payments;
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------- reviews & comments
CREATE TABLE IF NOT EXISTS reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_id    UUID        NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content    TEXT        NOT NULL DEFAULT '',
  media_urls TEXT[]      NOT NULL DEFAULT '{}',   -- S3/Cloudinary keys only
  like_count INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tour_id)                        -- one review per traveller
);

-- Nested comments: adjacency list + a materialised path. The path lets one
-- indexed range scan return a whole thread in display order, which a
-- recursive CTE cannot do without sorting the entire subtree in memory.
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  parent_id  UUID        REFERENCES comments(id)         ON DELETE CASCADE,
  path       TEXT        NOT NULL,                 -- '<uuid>.<uuid>.<uuid>'
  depth      SMALLINT    NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8),
  content    TEXT        NOT NULL,
  like_count INTEGER     NOT NULL DEFAULT 0,
  is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fill path/depth from the parent, and refuse cross-review parents.
CREATE OR REPLACE FUNCTION comments_set_path() RETURNS trigger AS $$
DECLARE parent_path TEXT; parent_review UUID; parent_depth SMALLINT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path  := NEW.id::text;
    NEW.depth := 0;
  ELSE
    SELECT path, review_id, depth INTO parent_path, parent_review, parent_depth
    FROM comments WHERE id = NEW.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'parent comment % not found', NEW.parent_id;
    END IF;
    IF parent_review <> NEW.review_id THEN
      RAISE EXCEPTION 'parent comment % belongs to a different review', NEW.parent_id;
    END IF;
    NEW.path  := parent_path || '.' || NEW.id::text;
    NEW.depth := parent_depth + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comments_set_path_trg ON comments;
CREATE TRIGGER comments_set_path_trg BEFORE INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION comments_set_path();

-- --------------------------------------------- likes, wishlist, chunks
CREATE TABLE IF NOT EXISTS review_likes (
  review_id  UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id UUID        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS wishlists (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_id    UUID        NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tour_id)
);

-- RAG corpus. One row per retrievable passage (overview, a day of the
-- itinerary, an inclusion list...) so the assistant cites something specific
-- instead of a whole tour blob. tours.embedding stays for coarse tour search.
CREATE TABLE IF NOT EXISTS tour_chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id    UUID        NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL,       -- 'overview' | 'itinerary_day' | 'options' | ...
  ref        TEXT,                       -- e.g. 'day:2'
  content    TEXT        NOT NULL,
  embedding  vector(768),        -- see the note on tours.embedding
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger-maintained counters keep review/comment lists to a single query.
CREATE OR REPLACE FUNCTION bump_review_likes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reviews SET like_count = like_count + 1 WHERE id = NEW.review_id;
  ELSE
    UPDATE reviews SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.review_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS review_likes_count ON review_likes;
CREATE TRIGGER review_likes_count AFTER INSERT OR DELETE ON review_likes
  FOR EACH ROW EXECUTE FUNCTION bump_review_likes();

COMMIT;
