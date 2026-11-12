-- =====================================================================
-- Tour Mate — 0004_user_profile_support.sql
--
-- Adds what the personal dashboard needs and nothing else:
--   * users:    home + last-seen location (PostGIS), preferences (JSONB),
--               credential timestamps
--   * payments: refund tracking, so "Payment & Refund Status" reads real
--               columns instead of inferring from the status enum
--   * support:  tickets + threaded messages, with an admin inbox in mind
--
-- Every statement is IF NOT EXISTS / OR REPLACE so a partially applied run
-- can be repeated. Runs after 0003_seed; nothing here depends on seed data.
-- =====================================================================

BEGIN;

-- ------------------------------------------------------------- enums
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('OPEN', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE geo_source AS ENUM ('GPS', 'MANUAL', 'IP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- users: location + preferences
-- =====================================================================
-- Two locations, deliberately separate. `home_*` is a stable profile field the
-- traveller edits; `last_*` is the volatile browser reading captured at login
-- and used for "near you" ranking. Mixing them would mean a trip to Goa
-- permanently rewrites someone's home city.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS home_city        TEXT,
  ADD COLUMN IF NOT EXISTS home_country     TEXT,
  ADD COLUMN IF NOT EXISTS home_location    geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS last_location    geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_source  geo_source,
  -- Flat, additive, and read on every page: theme, locale, currency,
  -- notification opt-ins, preferred moods. JSONB (not a column per setting)
  -- so adding a toggle is a client change, not a migration.
  ADD COLUMN IF NOT EXISTS preferences      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Set on every password change. A token minted before this instant is
  -- refused, which is how "sign out my other devices" works without a
  -- server-side session table.
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at    TIMESTAMPTZ;

-- Guard against a stray array or string landing in preferences: every reader
-- does `preferences->>'theme'`, which silently returns NULL for a non-object.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_preferences_is_object;
ALTER TABLE users
  ADD CONSTRAINT users_preferences_is_object
  CHECK (jsonb_typeof(preferences) = 'object');

-- Existing rows predate password_changed_at; treat the account creation time as
-- the epoch so their current tokens stay valid instead of all logging out.
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;

-- GiST, not B-tree: these are geometries. Partial, because most rows are NULL
-- until someone fills in a home city or grants location permission once.
CREATE INDEX IF NOT EXISTS users_home_location_gix
  ON users USING GIST (home_location) WHERE home_location IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_last_location_gix
  ON users USING GIST (last_location) WHERE last_location IS NOT NULL;

-- =====================================================================
-- payments: refund tracking
-- =====================================================================
-- The status enum already has REFUNDED, but a status alone cannot answer
-- "how much came back, when, and under which gateway reference" — which is
-- exactly what the dashboard's refund indicator has to show. Still no card
-- data: these are the gateway's own identifiers, so PCI-DSS scope is unchanged.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refund_amount    NUMERIC(10, 2) CHECK (refund_amount >= 0),
  ADD COLUMN IF NOT EXISTS refunded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reference TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason   TEXT;

-- One row per booking is the norm; the dashboard joins on booking_id for every
-- trip in the list, so this index carries the whole "my payments" query.
CREATE INDEX IF NOT EXISTS payments_booking_created_idx
  ON payments (booking_id, created_at DESC);

-- =====================================================================
-- support tickets
-- =====================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT            NOT NULL UNIQUE,   -- TM-S-4F2A9C, quoted in email
  user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Optional, and ON DELETE SET NULL: a ticket about a booking must survive
  -- the booking being purged, or the audit trail loses the complaint.
  booking_id      UUID            REFERENCES bookings(id) ON DELETE SET NULL,
  subject         TEXT            NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 160),
  category        TEXT            NOT NULL DEFAULT 'GENERAL',
  status          ticket_status   NOT NULL DEFAULT 'OPEN',
  priority        ticket_priority NOT NULL DEFAULT 'NORMAL',
  -- Denormalised from the newest message. The admin inbox sorts by it, and a
  -- per-row MAX() subquery over messages would make that scan every thread.
  last_message_at TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT support_tickets_category_known
    CHECK (category IN ('GENERAL', 'BOOKING', 'PAYMENT', 'REFUND', 'ACCESSIBILITY', 'OTHER'))
);

DROP TRIGGER IF EXISTS support_tickets_touch ON support_tickets;
CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: losing a staff account must not delete the
  -- replies it wrote. `is_staff` is captured at write time for the same reason.
  author_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  is_staff    BOOLEAN     NOT NULL DEFAULT FALSE,
  body        TEXT        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  attachments JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- Cloudinary/S3 URLs only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_messages_attachments_is_array
    CHECK (jsonb_typeof(attachments) = 'array')
);

-- Keep the parent thread in step with its newest message, in the same
-- transaction as the insert. A customer replying to a ticket support marked
-- RESOLVED reopens it — otherwise the reply lands in a closed thread nobody
-- is watching. A staff reply moves it to AWAITING_CUSTOMER instead.
CREATE OR REPLACE FUNCTION support_bump_ticket() RETURNS trigger AS $$
BEGIN
  UPDATE support_tickets
     SET last_message_at = NEW.created_at,
         status = CASE
           WHEN NEW.is_staff AND status = 'OPEN'   THEN 'AWAITING_CUSTOMER'
           WHEN NOT NEW.is_staff                   THEN 'OPEN'
           ELSE status
         END,
         resolved_at = CASE WHEN NOT NEW.is_staff THEN NULL ELSE resolved_at END
   WHERE id = NEW.ticket_id
     AND status <> 'CLOSED';   -- a closed ticket stays closed; open a new one
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_messages_bump ON support_ticket_messages;
CREATE TRIGGER support_messages_bump AFTER INSERT ON support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION support_bump_ticket();

-- The traveller's own list: "my tickets, newest first".
CREATE INDEX IF NOT EXISTS support_tickets_user_idx
  ON support_tickets (user_id, created_at DESC);

-- The admin inbox: only unfinished threads, oldest-waiting first. Partial, so
-- the index stays small as resolved tickets pile up over the years.
CREATE INDEX IF NOT EXISTS support_tickets_inbox_idx
  ON support_tickets (last_message_at ASC)
  WHERE status IN ('OPEN', 'AWAITING_CUSTOMER');

CREATE INDEX IF NOT EXISTS support_tickets_booking_idx
  ON support_tickets (booking_id) WHERE booking_id IS NOT NULL;

-- Whole thread in display order from one index range scan.
CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_ticket_messages (ticket_id, created_at ASC);

COMMIT;
