import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr, shortDate } from '../lib/format.js';
import { ErrorNote } from './ui.jsx';

/*
 * Coupon codes — the code-entered half of the discount engine (campaigns are the
 * automatic half). An operator mints a code with its guard-rails here; the traveller
 * types it in the booking rail, where the server re-validates and prices it *before*
 * the seat hold.
 *
 * The guard-rails matter and map straight to columns the server enforces: a percent
 * coupon can carry a max cap (so "20% off" can't blow past ₹1,000 on a group
 * booking), a minimum order gates small carts, and a usage limit stops a leaked code
 * running forever. Nothing here computes a discount — this screen only defines the
 * rules; the money is applied server-side at validate/checkout.
 *
 * Cards, not a table: coupons are few and each has a lot of small facts, which reads
 * better as a wrapping card grid than as a wide table squeezed onto a phone.
 */

const BLANK = {
  code: '',
  discountType: 'PERCENT',
  value: 10,
  minOrderValue: '',
  maxDiscount: '',
  usageLimit: '',
  expiresAt: '',
  isActive: true,
};

export default function CouponManager() {
  const qc = useQueryClient();
  const [form, setForm] = useState(BLANK);

  const list = useQuery({
    queryKey: ['coupons'],
    queryFn: ({ signal }) => api.listCoupons(signal),
    staleTime: 30_000,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (body) => api.createCoupon(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setForm(BLANK);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }) => api.setCouponActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });

  const set = (key, cast = (v) => v) => (e) =>
    setForm((f) => ({ ...f, [key]: cast(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }));

  const isPercent = form.discountType === 'PERCENT';
  const coupons = list.data?.coupons ?? (Array.isArray(list.data) ? list.data : []);

  function submit(e) {
    e.preventDefault();
    create.mutate({
      code: form.code.trim().toUpperCase(),
      discountType: form.discountType,
      discountValue: Number(form.value),
      minOrderValue: form.minOrderValue === '' ? 0 : Number(form.minOrderValue),
      maxDiscount: isPercent && form.maxDiscount !== '' ? Number(form.maxDiscount) : null,
      usageLimit: form.usageLimit === '' ? null : Number(form.usageLimit),
      expiresAt: form.expiresAt || null,
      isActive: form.isActive,
    });
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Coupon codes</h2>
      <p className="faint text-xs">Codes travellers type at checkout. The server re-checks every rule before it holds a seat.</p>

      <form className="mt-3 space-y-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-sm">
            Code
            <input
              className="field mt-1 font-mono uppercase"
              required
              placeholder="MONSOON20"
              value={form.code}
              onChange={set('code', (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <label className="block text-sm">
            Type
            <select className="field mt-1" value={form.discountType} onChange={set('discountType')}>
              <option value="PERCENT">Percent off</option>
              <option value="FLAT">Flat amount off</option>
            </select>
          </label>
          <Field
            label={isPercent ? 'Percent off (%)' : 'Amount off (₹)'}
            type="number"
            min="1"
            max={isPercent ? '100' : undefined}
            value={form.value}
            onChange={set('value')}
          />
          <Field label="Min order (₹)" type="number" min="0" value={form.minOrderValue} onChange={set('minOrderValue')} hint="blank = no minimum" />
          {isPercent && (
            <Field label="Max discount cap (₹)" type="number" min="0" value={form.maxDiscount} onChange={set('maxDiscount')} hint="blank = uncapped" />
          )}
          <Field label="Max uses" type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} hint="blank = unlimited" />
          <Field label="Expires" type="date" value={form.expiresAt} onChange={set('expiresAt')} hint="blank = no expiry" />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-ink-800 dark:accent-sand-300" checked={form.isActive} onChange={set('isActive')} />
          Active immediately
        </label>

        <ErrorNote error={create.error} />
        {create.isSuccess && <p className="notice-ok">Coupon created.</p>}

        <button className="btn-primary w-full sm:w-auto" disabled={create.isPending || form.code.trim().length < 3}>
          {create.isPending ? 'Creating…' : 'Create coupon'}
        </button>
      </form>

      <ErrorNote error={toggle.error} />

      <div className="mt-5">
        {list.isPending ? (
          <p className="faint text-sm" role="status">Loading coupons…</p>
        ) : list.isError ? (
          <p className="faint text-sm">Coupons aren’t available yet.</p>
        ) : coupons.length === 0 ? (
          <p className="faint text-sm">No coupons yet. Mint your first one above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coupons.map((c) => (
              <CouponCard key={c.id} coupon={c} onToggle={() => toggle.mutate({ id: c.id, isActive: !c.isActive })} busy={toggle.isPending && toggle.variables?.id === c.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CouponCard({ coupon, onToggle, busy }) {
  const isPercent = coupon.discountType === 'PERCENT';
  const headline = isPercent ? `${Number(coupon.discountValue)}% off` : `${inr(coupon.discountValue)} off`;
  const expired = coupon.expiresAt && new Date(coupon.expiresAt) < new Date();

  return (
    <li className="flex flex-col rounded-xl border border-sand-200 p-3 dark:border-ink-700">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-bold">{coupon.code}</p>
          <p className="text-sm">{headline}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={coupon.isActive}
          className={[
            'chip shrink-0',
            coupon.isActive
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
              : 'bg-sand-100 text-sand-500 dark:bg-ink-800 dark:text-sand-400',
          ].join(' ')}
        >
          {busy ? '…' : coupon.isActive ? 'Active' : 'Paused'}
        </button>
      </div>

      <dl className="faint mt-2 space-y-0.5 text-xs">
        {Number(coupon.minOrderValue) > 0 && <div>Min order {inr(coupon.minOrderValue)}</div>}
        {isPercent && coupon.maxDiscount != null && <div>Capped at {inr(coupon.maxDiscount)}</div>}
        <div>
          {coupon.usageLimit != null
            ? `${coupon.usedCount ?? 0} / ${coupon.usageLimit} used`
            : `${coupon.usedCount ?? 0} used · unlimited`}
        </div>
        <div className={expired ? 'text-red-600 dark:text-red-300' : ''}>
          {coupon.expiresAt
            ? `${expired ? 'Expired' : 'Expires'} ${shortDate(String(coupon.expiresAt).slice(0, 10))}`
            : 'No expiry'}
        </div>
      </dl>
    </li>
  );
}

function Field({ label, hint, ...input }) {
  return (
    <label className="block text-sm">
      {label}
      <input className="field mt-1" {...input} />
      {hint && <span className="faint mt-1 block text-[11px]">{hint}</span>}
    </label>
  );
}
