import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr, stamp } from '../lib/format.js';
import {
  campaignState,
  computeDeal,
  endOfDayIn,
  localInputToIso,
  roughDuration,
} from '../lib/campaign.js';
import { ErrorNote } from './ui.jsx';
import CampaignPreview from './sale/CampaignPreview.jsx';

/*
 * Festival campaigns — the automatic half of the discount engine.
 *
 * Unlike a coupon, a campaign needs no code: while it's live its percentage shows up
 * as a strike-through on every tour card, its hero headlines the homepage and a slim
 * announcement bar follows visitors around (that's what `api.activeCampaigns` /
 * useActiveCampaign read on the guest side). So this screen is really authoring a piece
 * of storefront, not just a rule — hence the live preview beside the form, built from
 * the very components customers see.
 *
 * "Active" is a toggle, never a delete: a Diwali campaign paused in November can be
 * switched back on without re-typing it. The date window is the fence; the toggle is
 * the master switch inside it. The API has no "edit dates" call, so a campaign whose
 * window has closed is revived with Duplicate (copies name, discount and banner into
 * the form, dates blank) rather than by editing it.
 *
 * API contract is unchanged: listCampaigns / createCampaign / setCampaignActive /
 * deleteCampaign, same payload shape (name, discountPercent, bannerUrl?, startsAt?,
 * endsAt?, isActive).
 */

const BLANK = {
  name: '',
  discountPercent: 15,
  bannerUrl: '',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

const DISCOUNT_PRESETS = [10, 15, 20, 25, 30, 40, 50];
const END_PRESETS = [
  ['3 days', 3],
  ['7 days', 7],
  ['14 days', 14],
];

/* live first, then what's coming, then paused, then history */
const ORDER = { live: 0, scheduled: 1, paused: 2, ended: 3 };

/** Pure form validation; the same result drives the inline hints and the submit guard. */
function validate(form, now = Date.now()) {
  const out = {};
  const pct = Number(form.discountPercent);
  if (!Number.isInteger(pct) || pct < 1 || pct > 90) out.discount = 'Enter a whole number from 1 to 90.';

  const s = localInputToIso(form.startsAt);
  const e = localInputToIso(form.endsAt);
  if (form.startsAt && !s) out.startsAt = 'That is not a valid date and time.';
  if (form.endsAt && !e) out.endsAt = 'That is not a valid date and time.';
  if (!out.endsAt && e) {
    if (new Date(e).getTime() <= now) out.endsAt = 'That time has already passed, so the campaign would never go live.';
    else if (s && new Date(e).getTime() <= new Date(s).getTime()) out.endsAt = 'The end must be after the start.';
  }
  return out;
}

export default function CampaignManager() {
  const qc = useQueryClient();
  const formRef = useRef(null);
  const [form, setForm] = useState(BLANK);
  const [samplePrice, setSamplePrice] = useState('12999');
  const [bannerFailed, setBannerFailed] = useState(false);

  // Keeps "Ends in 3h" and the Live/Ended chips honest while the page sits open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const list = useQuery({
    queryKey: ['campaigns', 'all'],
    queryFn: ({ signal }) => api.listCampaigns(signal),
    staleTime: 30_000,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (body) => api.createCampaign(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setForm(BLANK);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }) => api.setCampaignActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const drop = useMutation({
    mutationFn: (id) => api.deleteCampaign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const set = (key, cast = (v) => v) => (e) =>
    setForm((f) => ({ ...f, [key]: cast(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }));
  const patch = (changes) => setForm((f) => ({ ...f, ...changes }));

  const campaigns = useMemo(() => {
    const raw = list.data?.campaigns ?? (Array.isArray(list.data) ? list.data : []);
    return [...raw].sort(
      (a, b) =>
        ORDER[campaignState(a, now)] - ORDER[campaignState(b, now)] ||
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
  }, [list.data, now]);

  const counts = useMemo(() => {
    const c = { live: 0, scheduled: 0, paused: 0, ended: 0 };
    let best = 0;
    for (const camp of campaigns) {
      const state = campaignState(camp, now);
      c[state] += 1;
      if (state === 'live') best = Math.max(best, Number(camp.discountPercent));
    }
    return { ...c, best };
  }, [campaigns, now]);

  const issues = useMemo(() => validate(form), [form]);
  const hasIssues = Object.keys(issues).length > 0;

  // The unsaved form as a campaign object, for the live preview.
  const draft = useMemo(
    () => ({
      name: form.name.trim(),
      discountPercent: Number(form.discountPercent) || 0,
      bannerUrl: form.bannerUrl.trim() || null,
      startsAt: localInputToIso(form.startsAt),
      endsAt: localInputToIso(form.endsAt),
      isActive: form.isActive,
    }),
    [form]
  );

  const pct = Number(form.discountPercent);
  const exampleDeal = !issues.discount ? computeDeal(samplePrice, pct) : null;

  function submit(e) {
    e.preventDefault();
    if (Object.keys(validate(form)).length > 0) return;
    const body = {
      name: form.name.trim(),
      discountPercent: Number(form.discountPercent),
      isActive: form.isActive,
    };
    // Only include optional fields when they have a value
    if (form.bannerUrl.trim()) body.bannerUrl = form.bannerUrl.trim();
    /*
     * "Blank start = starts now" is sent as an explicit timestamp, a minute back to
     * absorb clock drift between this browser and the server. Checkout only accepts a
     * campaign whose start has passed, so a campaign saved with no start date would
     * advertise a discount on the cards and then be refused at payment. (The checkout
     * query is fixed server-side too; this keeps older deployments safe.)
     */
    body.startsAt = draft.startsAt ?? new Date(Date.now() - 60_000).toISOString();
    if (draft.endsAt) body.endsAt = draft.endsAt;
    create.mutate(body);
  }

  const handleDelete = (id, name) => {
    if (window.confirm(`Are you sure you want to delete the campaign "${name}"?\n\nThis cannot be undone.`)) {
      drop.mutate(id);
    }
  };

  // Revive an ended campaign (or reuse a good one next year): copy it into the form.
  const handleDuplicate = (c) => {
    setForm({
      name: `${c.name} (copy)`.slice(0, 120),
      discountPercent: Number(c.discountPercent),
      bannerUrl: c.bannerUrl ?? '',
      startsAt: '',
      endsAt: '',
      isActive: true,
    });
    setBannerFailed(false);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startsInFuture = draft.startsAt && new Date(draft.startsAt).getTime() > now;

  return (
    <section className="card space-y-6 p-4 sm:p-6">
      <header>
        <h2 className="text-sm font-semibold">Festival campaigns</h2>
        <p className="faint text-xs">
          Auto-applied while live — no code needed. Shows as a homepage hero, a sale announcement bar and
          strike-through prices with the saving on every tour card.
        </p>
      </header>

      {/* ---- at a glance: only numbers the campaign list can honestly provide */}
      {campaigns.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Live now" value={counts.live} tone="text-emerald-700 dark:text-emerald-300" />
          <Tile label="Scheduled" value={counts.scheduled} />
          <Tile label="Paused" value={counts.paused} />
          <Tile label="Ended" value={counts.ended} />
          <Tile label="Best live offer" value={counts.best ? `${counts.best}%` : '—'} />
        </dl>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------------------ form */}
        <form ref={formRef} className="scroll-mt-24 space-y-5" onSubmit={submit}>
          <Field
            label="Campaign name"
            required
            maxLength={120}
            placeholder="Diwali Getaways"
            value={form.name}
            onChange={set('name')}
            hint="Shown on the homepage hero, the announcement bar and every discounted card."
          />

          {/* Discount */}
          <fieldset className="space-y-2">
            <legend className="text-sm">Discount</legend>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="90"
                step="1"
                aria-label="Discount percentage slider"
                className="h-2 flex-1 accent-glow"
                value={Number.isFinite(pct) ? Math.min(Math.max(pct, 1), 90) : 1}
                onChange={set('discountPercent')}
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  aria-label="Discount percent"
                  aria-invalid={Boolean(issues.discount)}
                  className="field w-20 text-center"
                  value={form.discountPercent}
                  onChange={set('discountPercent')}
                />
                <span className="text-sm font-semibold">%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DISCOUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pct === p}
                  onClick={() => patch({ discountPercent: p })}
                  className={`chip transition ${
                    pct === p ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : 'hover:bg-sand-100 dark:hover:bg-ink-800'
                  }`}
                >
                  {p}%
                </button>
              ))}
            </div>
            {issues.discount ? (
              <p className="text-[11px] text-red-600 dark:text-red-300" role="alert">
                {issues.discount}
              </p>
            ) : exampleDeal ? (
              <p className="faint text-xs">
                On a {inr(exampleDeal.original)} tour, travellers pay {inr(exampleDeal.discounted)} and save{' '}
                {inr(exampleDeal.saved)}. The percentage applies to every tour.
              </p>
            ) : null}
          </fieldset>

          {/* Schedule */}
          <fieldset className="space-y-3">
            <legend className="text-sm">Schedule</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Starts"
                type="datetime-local"
                value={form.startsAt}
                onChange={set('startsAt')}
                error={issues.startsAt}
                hint="Blank = starts as soon as you create it."
              />
              <Field
                label="Ends"
                type="datetime-local"
                value={form.endsAt}
                onChange={set('endsAt')}
                error={issues.endsAt}
                hint="Blank = no end. A real end date powers the honest countdown."
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="faint text-xs">Quick end:</span>
              {END_PRESETS.map(([label, days]) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => patch({ endsAt: endOfDayIn(days) })}
                  className="chip transition hover:bg-sand-100 dark:hover:bg-ink-800"
                >
                  {label} · 11:59 PM
                </button>
              ))}
              {(form.startsAt || form.endsAt) && (
                <button
                  type="button"
                  onClick={() => patch({ startsAt: '', endsAt: '' })}
                  className="chip transition hover:bg-sand-100 dark:hover:bg-ink-800"
                >
                  Clear dates
                </button>
              )}
            </div>
            <p className="faint text-[11px]">Times are in your local time zone.</p>
          </fieldset>

          {/* Banner */}
          <div className="space-y-2">
            <Field
              label="Banner image URL"
              type="url"
              placeholder="https://…"
              value={form.bannerUrl}
              onChange={(e) => {
                setBannerFailed(false);
                set('bannerUrl')(e);
              }}
              hint="Wide landscape photo, 16:9, at least 1600 px across. Blank = a photo from your tours is used."
            />
            {form.bannerUrl.trim() &&
              (bannerFailed ? (
                <p className="notice-error" role="alert">
                  That image couldn’t be loaded. Check the link — visitors would see a tour photo instead.
                </p>
              ) : (
                <img
                  src={form.bannerUrl.trim()}
                  alt="Banner preview"
                  className="h-28 w-full rounded-xl object-cover"
                  loading="lazy"
                  onError={() => setBannerFailed(true)}
                />
              ))}
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ink-800 dark:accent-sand-300"
                checked={form.isActive}
                onChange={set('isActive')}
              />
              {startsInFuture ? 'Switch on automatically at the start time' : 'Live immediately'}
            </label>
            {!form.isActive && (
              <p className="faint text-xs">Saved as paused: nothing shows until you set it live from the list.</p>
            )}
          </div>

          <ErrorNote error={create.error} />
          {create.isSuccess && <p className="notice-ok">Campaign created.</p>}

          <button
            className="btn-primary w-full sm:w-auto"
            disabled={create.isPending || form.name.trim().length < 2 || hasIssues}
          >
            {create.isPending ? 'Creating…' : 'Create campaign'}
          </button>
        </form>

        {/* --------------------------------------------------------------- preview */}
        <div className="lg:sticky lg:top-24">
          <CampaignPreview draft={draft} samplePrice={samplePrice} onSamplePriceChange={setSamplePrice} />
        </div>
      </div>

      {/* Show toggle or drop errors */}
      <ErrorNote error={toggle.error || drop.error} />

      <div>
        <h3 className="mb-3 text-sm font-semibold">All campaigns</h3>
        {list.isPending ? (
          <p className="faint text-sm" role="status">
            Loading campaigns…
          </p>
        ) : list.isError ? (
          <div className="notice-error flex flex-wrap items-center justify-between gap-3" role="alert">
            <span>Campaigns aren’t available right now.</span>
            <button type="button" className="btn-ghost min-h-10" onClick={() => list.refetch()}>
              Try again
            </button>
          </div>
        ) : campaigns.length === 0 ? (
          <p className="faint text-sm">No campaigns yet. Launch one above and watch the preview build itself.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                now={now}
                samplePrice={samplePrice}
                onToggle={() => toggle.mutate({ id: c.id, isActive: !c.isActive })}
                toggleBusy={toggle.isPending && toggle.variables?.id === c.id}
                onDelete={() => handleDelete(c.id, c.name)}
                deleteBusy={drop.isPending && drop.variables === c.id}
                onDuplicate={() => handleDuplicate(c)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Tile({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl border border-sand-100 p-3 dark:border-ink-700">
      <dt className="faint text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className={`mt-0.5 text-xl font-black tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

const STATE_UI = {
  live: { label: 'Live', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200' },
  paused: { label: 'Paused', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' },
  ended: { label: 'Ended', cls: 'bg-sand-100 text-sand-500 dark:bg-ink-800 dark:text-sand-400' },
};

function CampaignCard({ campaign, now, samplePrice, onToggle, toggleBusy, onDelete, deleteBusy, onDuplicate }) {
  const state = campaignState(campaign, now);
  const ui = STATE_UI[state];
  const start = campaign.startsAt ? new Date(campaign.startsAt).getTime() : null;
  const end = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;
  const deal = computeDeal(samplePrice, campaign.discountPercent);
  const busy = toggleBusy || deleteBusy;

  const timing =
    state === 'live'
      ? end
        ? `Ends in ${roughDuration(end - now)}`
        : 'No end date'
      : state === 'scheduled'
        ? `Starts in ${roughDuration(start - now)}`
        : state === 'ended'
          ? `Ended ${stamp(campaign.endsAt)}`
          : 'Switched off';

  const window =
    start && end
      ? `${stamp(campaign.startsAt)} → ${stamp(campaign.endsAt)}`
      : start
        ? `From ${stamp(campaign.startsAt)}`
        : end
          ? `Until ${stamp(campaign.endsAt)}`
          : 'Always on while live';

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-sand-200 dark:border-ink-700">
      <div className="relative h-28 w-full bg-ink-800">
        {campaign.bannerUrl ? (
          <img src={campaign.bannerUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-white/50">no banner</div>
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <span className="absolute left-3 top-3 rounded-full bg-glow px-2.5 py-0.5 text-xs font-black text-ink-900 shadow">
          {Number(campaign.discountPercent)}% OFF
        </span>
        <span className={`chip absolute right-3 top-3 border-transparent ${ui.cls}`}>{ui.label}</span>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <p className="truncate text-sm font-semibold">{campaign.name}</p>
        <p className="mt-0.5 text-xs font-medium">{timing}</p>
        <p className="faint mt-0.5 text-xs">{window}</p>
        {deal && (
          <p className="faint mt-1 flex-1 text-xs">
            On a {inr(deal.original)} tour: {inr(deal.discounted)}, saves {inr(deal.saved)}.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-sand-100 pt-2 dark:border-ink-700/50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              disabled={busy || state === 'ended'}
              className="btn-ghost min-h-9 px-3 text-xs"
              title={state === 'ended' ? 'The window has closed. Duplicate it with new dates instead.' : undefined}
            >
              {toggleBusy ? '…' : campaign.isActive ? 'Pause' : 'Set live'}
            </button>
            <button type="button" onClick={onDuplicate} disabled={busy} className="btn-ghost min-h-9 px-3 text-xs">
              Duplicate
            </button>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  );
}

function Field({ label, hint, error, ...input }) {
  return (
    <label className="block text-sm">
      {label}
      <input className="field mt-1" aria-invalid={error ? true : undefined} {...input} />
      {error ? (
        <span className="mt-1 block text-[11px] text-red-600 dark:text-red-300" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="faint mt-1 block text-[11px]">{hint}</span>
      )}
    </label>
  );
}
