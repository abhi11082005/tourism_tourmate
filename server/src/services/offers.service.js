/**
 * Discount engine — coupons and festival campaigns.
 *
 * Design notes:
 *  - All money arithmetic in integer paise, same as pricing.service.js.
 *  - validateCoupon is the single source of truth: it is called by both the
 *    pre-checkout validation endpoint and (once we want server-side pricing of
 *    coupon discounts) by startCheckout.  Neither caller does its own math.
 *  - activeCampaigns is intentionally cheap: one indexed query, no joins,
 *    cacheable at the HTTP layer with Cache-Control: public, max-age=30.
 *  - usage_limit enforcement uses a SELECT … FOR UPDATE to prevent two
 *    concurrent redemptions of the last available use.
 */

import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, notFound } from '../utils/httpError.js';

// ----------------------------------------------------------------- helpers
const toPaise   = (v) => Math.round(Number(v) * 100);
const toRupees  = (p) => (p / 100).toFixed(2);

// ----------------------------------------------------------------- campaigns

/** All campaigns, ordered newest first (admin list). */
export async function listCampaigns() {
  const { rows } = await query(
    `SELECT id, name, discount_percent, banner_url,
            starts_at, ends_at, is_active, created_at
       FROM campaigns
      ORDER BY created_at DESC`
  );
  return rows.map(normaliseCampaign);
}

/** Campaigns that are currently live (public storefront). */
export async function activeCampaigns() {
  const { rows } = await query(
    `SELECT id, name, discount_percent, banner_url,
            starts_at, ends_at, is_active
       FROM campaigns
      WHERE is_active = TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at   IS NULL OR ends_at   >= NOW())
      ORDER BY discount_percent DESC`
  );
  return rows.map(normaliseCampaign);
}

/** Create a campaign. */
export async function createCampaign({ name, discountPercent, bannerUrl, startsAt, endsAt, isActive }) {
  const row = await queryOne(
    `INSERT INTO campaigns (name, discount_percent, banner_url, starts_at, ends_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, discount_percent, banner_url, starts_at, ends_at, is_active, created_at`,
    [name, discountPercent, bannerUrl ?? null, startsAt ?? null, endsAt ?? null, isActive ?? true]
  );
  return normaliseCampaign(row);
}

/** Toggle a campaign's is_active flag. */
export async function setCampaignActive(id, isActive) {
  const row = await queryOne(
    `UPDATE campaigns SET is_active = $2 WHERE id = $1
     RETURNING id, name, discount_percent, banner_url, starts_at, ends_at, is_active`,
    [id, isActive]
  );
  if (!row) throw notFound('Campaign not found');
  return normaliseCampaign(row);
}

function normaliseCampaign(r) {
  return {
    id:              r.id,
    name:            r.name,
    discountPercent: Number(r.discount_percent),
    bannerUrl:       r.banner_url ?? null,
    startsAt:        r.starts_at  ?? null,
    endsAt:          r.ends_at    ?? null,
    isActive:        r.is_active,
    createdAt:       r.created_at ?? undefined,
  };
}

export async function deleteCampaign(id) {
  // Use queryOne and RETURNING * so normaliseCampaign has all the fields it needs
  const row = await queryOne(
    `DELETE FROM campaigns WHERE id = $1 RETURNING *`,
    [id]
  );
  
  if (!row) throw notFound('Campaign not found');
  
  return normaliseCampaign(row);
}

// ----------------------------------------------------------------- coupons

/** All coupons, newest first (admin list). */
export async function listCoupons() {
  const { rows } = await query(
    `SELECT id, code, discount_type, discount_value, min_order_value,
            max_discount, usage_limit, used_count, expires_at, is_active, created_at
       FROM coupons
      ORDER BY created_at DESC`
  );
  return rows.map(normaliseCoupon);
}

/** Create a coupon. */
export async function createCoupon({
  code, discountType, discountValue, minOrderValue,
  maxDiscount, usageLimit, expiresAt, isActive,
}) {
  const row = await queryOne(
    `INSERT INTO coupons
       (code, discount_type, discount_value, min_order_value, max_discount,
        usage_limit, expires_at, is_active)
     VALUES ($1, $2::discount_type, $3, $4, $5, $6, $7, $8)
     RETURNING id, code, discount_type, discount_value, min_order_value,
               max_discount, usage_limit, used_count, expires_at, is_active, created_at`,
    [
      code.trim().toUpperCase(),
      discountType,
      discountValue,
      minOrderValue ?? 0,
      maxDiscount   ?? null,
      usageLimit    ?? null,
      expiresAt     ?? null,
      isActive      ?? true,
    ]
  );
  return normaliseCoupon(row);
}

export async function deleteCoupon(id) {
  // Use queryOne and RETURNING * so normaliseCoupon has all the fields it needs
  const row = await queryOne(
    `DELETE FROM coupons WHERE id = $1 RETURNING *`,
    [id]
  );
  
  if (!row) throw notFound('Coupon not found');
  
  return normaliseCoupon(row);
}

/** Toggle a coupon's is_active flag. */
export async function setCouponActive(id, isActive) {
  const row = await queryOne(
    `UPDATE coupons SET is_active = $2 WHERE id = $1
     RETURNING id, code, discount_type, discount_value, min_order_value,
               max_discount, usage_limit, used_count, expires_at, is_active`,
    [id, isActive]
  );
  if (!row) throw notFound('Coupon not found');
  return normaliseCoupon(row);
}

function normaliseCoupon(r) {
  return {
    id:             r.id,
    code:           r.code,
    discountType:   r.discount_type,
    discountValue:  Number(r.discount_value),
    minOrderValue:  Number(r.min_order_value),
    maxDiscount:    r.max_discount != null ? Number(r.max_discount) : null,
    usageLimit:     r.usage_limit  != null ? Number(r.usage_limit)  : null,
    usedCount:      Number(r.used_count),
    expiresAt:      r.expires_at   ?? null,
    isActive:       r.is_active,
    createdAt:      r.created_at   ?? undefined,
  };
}

// ----------------------------------------------------------------- validation

/**
 * Validate a coupon code and compute the discount for a given quote total.
 *
 * Called from POST /bookings/validate-coupon (preview) and can be called by
 * startCheckout when it needs to apply a code before locking seats.
 *
 * Returns { coupon, discountAmount, finalAmount } in rupee strings.
 * Throws HttpError 400/404 on any hard failure so the caller can surface it.
 *
 * NOTE: this function does NOT increment used_count — that only happens on
 * actual checkout confirm (future: call incrementCouponUse from confirmBooking).
 * Preview calls are free.
 *
 * @param {{ couponCode: string, orderTotal: string|number }} args
 */
export async function validateCoupon({ couponCode, orderTotal }) {
  const code = String(couponCode).trim().toUpperCase();
  if (!code) throw badRequest('Coupon code is required');

  const row = await queryOne(
    `SELECT id, code, discount_type, discount_value, min_order_value,
            max_discount, usage_limit, used_count, expires_at, is_active
       FROM coupons WHERE code = $1`,
    [code]
  );

  // Return a generic "not found / can't check" rather than confirming the code
  // exists-but-is-inactive (information leak prevention).
  if (!row || !row.is_active) {
    throw Object.assign(
      badRequest('That coupon code is not valid or has expired'),
      { code: 'COUPON_INVALID' }
    );
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw Object.assign(
      badRequest('That coupon has expired'),
      { code: 'COUPON_EXPIRED' }
    );
  }

  if (row.usage_limit != null && row.used_count >= row.usage_limit) {
    throw Object.assign(
      badRequest('That coupon has reached its usage limit'),
      { code: 'COUPON_EXHAUSTED' }
    );
  }

  const totalPaise = toPaise(orderTotal);

  if (toPaise(row.min_order_value) > 0 && totalPaise < toPaise(row.min_order_value)) {
    throw Object.assign(
      badRequest(
        `This coupon requires a minimum order of ₹${Number(row.min_order_value).toFixed(0)}`
      ),
      { code: 'COUPON_MIN_NOT_MET' }
    );
  }

  // Compute discount in paise.
  let discountPaise;
  if (row.discount_type === 'PERCENT') {
    discountPaise = Math.round((totalPaise * Number(row.discount_value)) / 100);
    if (row.max_discount != null) {
      discountPaise = Math.min(discountPaise, toPaise(row.max_discount));
    }
  } else {
    // FLAT
    discountPaise = toPaise(row.discount_value);
  }

  // Discount can never exceed the order total.
  discountPaise = Math.min(discountPaise, totalPaise);

  const finalPaise = totalPaise - discountPaise;

  return {
    coupon: {
      // id travels with the result so startCheckout can write a redemption row
      // without a second lookup by code.
      id:             row.id,
      code:           row.code,
      discountType:   row.discount_type,
      discountValue:  Number(row.discount_value),
    },
    discountAmount: toRupees(discountPaise),
    finalAmount:    toRupees(finalPaise),
  };
}

/**
 * Increment the used_count for a coupon after a successful booking confirm.
 * Uses SELECT … FOR UPDATE to prevent over-redemption under concurrent load.
 * Safe to call with a couponCode that no longer exists (no-op).
 */
export async function incrementCouponUse(couponCode) {
  if (!couponCode) return;
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, usage_limit, used_count FROM coupons WHERE code = $1 FOR UPDATE`,
      [String(couponCode).trim().toUpperCase()]
    );
    if (!rows[0]) return; // code was deleted — nothing to do
    const { id, usage_limit, used_count } = rows[0];
    if (usage_limit != null && used_count >= usage_limit) return; // already maxed
    await client.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
      [id]
    );
  });
}
