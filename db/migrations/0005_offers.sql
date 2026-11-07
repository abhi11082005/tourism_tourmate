-- Discount engine: coupons and festival campaigns
-- Migration 0005

-- Enum for coupon discount types
CREATE TYPE discount_type AS ENUM ('PERCENT', 'FLAT');

-- Festival campaigns (auto-applied, site-wide)
CREATE TABLE campaigns (
  id                SERIAL PRIMARY KEY,
  name              TEXT        NOT NULL,
  discount_percent  INTEGER     NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  banner_url        TEXT,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX idx_campaigns_active ON campaigns (is_active, starts_at, ends_at)
  WHERE is_active = TRUE;

-- Coupon codes (manual entry at checkout)
CREATE TABLE coupons (
  id               SERIAL PRIMARY KEY,
  code             TEXT          NOT NULL UNIQUE,
  discount_type    discount_type NOT NULL,
  discount_value   INTEGER       NOT NULL CHECK (discount_value > 0),
  min_order_value  INTEGER       NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
  max_discount     INTEGER       CHECK (max_discount IS NULL OR max_discount > 0),
  usage_limit      INTEGER       CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count       INTEGER       NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at       TIMESTAMPTZ,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (code = UPPER(code) AND code ~ '^[A-Z0-9]+$')
);

CREATE INDEX idx_coupons_code ON coupons (code) WHERE is_active = TRUE;
CREATE INDEX idx_coupons_active ON coupons (is_active, expires_at);

-- Coupon redemptions (audit trail + usage enforcement)
CREATE TABLE coupon_redemptions (
  id          SERIAL PRIMARY KEY,
  coupon_id   INTEGER      NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  booking_id  UUID         NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  discount    INTEGER      NOT NULL CHECK (discount > 0),
  redeemed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, booking_id)
);

CREATE INDEX idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id);
CREATE INDEX idx_coupon_redemptions_user ON coupon_redemptions (user_id);
