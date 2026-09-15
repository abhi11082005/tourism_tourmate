import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { ErrorNote } from './ui.jsx';

/*
 * Festival campaigns — the automatic half of the discount engine.
 *
 * Unlike a coupon, a campaign needs no code: while it's active its percentage shows
 * up as a strike-through on every tour card and its banner headlines the homepage
 * (that's what `api.activeCampaigns` / useActiveCampaign read on the guest side). So
 * this screen is really authoring a piece of storefront, not just a rule — hence the
 * banner image and the live/paused toggle sitting front and centre.
 *
 * "Active" is a toggle, never a delete: a Diwali campaign paused in November can be
 * switched back on next year without re-typing it. The date window is the fence; the
 * toggle is the master switch inside it.
 */

const BLANK = {
  name: '',
  discountPercent: 15,
  bannerUrl: '',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

export default function CampaignManager() {
  const qc = useQueryClient();
  const [form, setForm] = useState(BLANK);

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

  const set = (key, cast = (v) => v) => (e) =>
    setForm((f) => ({ ...f, [key]: cast(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }));

  const campaigns = list.data?.campaigns ?? (Array.isArray(list.data) ? list.data : []);

  function submit(e) {
    e.preventDefault();
    create.mutate({
      name: form.name.trim(),
      discountPercent: Number(form.discountPercent),
      bannerUrl: form.bannerUrl.trim() || null,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      isActive: form.isActive,
    });
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Festival campaigns</h2>
      <p className="faint text-xs">
        Auto-applied while live — no code needed. Shows as a homepage banner and strike-through prices on cards.
      </p>

      <form className="mt-3 space-y-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required placeholder="Diwali Getaways" value={form.name} onChange={set('name')} />
          <Field label="Discount (%)" type="number" min="1" max="90" value={form.discountPercent} onChange={set('discountPercent')} />
          <Field label="Starts" type="date" value={form.startsAt} onChange={set('startsAt')} hint="blank = starts now" />
          <Field label="Ends" type="date" value={form.endsAt} onChange={set('endsAt')} hint="blank = no end" />
        </div>

        <label className="block text-sm">
          Banner image URL
          <input className="field mt-1" type="url" placeholder="https://…" value={form.bannerUrl} onChange={set('bannerUrl')} />
        </label>

        {form.bannerUrl.trim() && (
          <img src={form.bannerUrl} alt="" className="h-28 w-full rounded-xl object-cover" loading="lazy" />
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-ink-800 dark:accent-sand-300" checked={form.isActive} onChange={set('isActive')} />
          Live immediately
        </label>

        <ErrorNote error={create.error} />
        {create.isSuccess && <p className="notice-ok">Campaign created.</p>}

        <button className="btn-primary w-full sm:w-auto" disabled={create.isPending || form.name.trim().length < 2}>
          {create.isPending ? 'Creating…' : 'Create campaign'}
        </button>
      </form>

      <ErrorNote error={toggle.error} />

      <div className="mt-5">
        {list.isPending ? (
          <p className="faint text-sm" role="status">Loading campaigns…</p>
        ) : list.isError ? (
          <p className="faint text-sm">Campaigns aren’t available yet.</p>
        ) : campaigns.length === 0 ? (
          <p className="faint text-sm">No campaigns yet. Launch one above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onToggle={() => toggle.mutate({ id: c.id, isActive: !c.isActive })}
                busy={toggle.isPending && toggle.variables?.id === c.id}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CampaignCard({ campaign, onToggle, busy }) {
  const window = [campaign.startsAt, campaign.endsAt]
    .map((d) => (d ? shortDate(String(d).slice(0, 10)) : null))
    .filter(Boolean);

  return (
    <li className="overflow-hidden rounded-xl border border-sand-200 dark:border-ink-700">
      {campaign.bannerUrl ? (
        <img src={campaign.bannerUrl} alt="" className="h-24 w-full object-cover" loading="lazy" />
      ) : (
        <div className="grid h-24 w-full place-items-center bg-sand-100 text-xs text-sand-500 dark:bg-ink-800 dark:text-sand-400">
          no banner
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{campaign.name}</p>
            <p className="text-sm text-glow">{Number(campaign.discountPercent)}% off</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            aria-pressed={campaign.isActive}
            className={[
              'chip shrink-0',
              campaign.isActive
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                : 'bg-sand-100 text-sand-500 dark:bg-ink-800 dark:text-sand-400',
            ].join(' ')}
          >
            {busy ? '…' : campaign.isActive ? 'Live' : 'Paused'}
          </button>
        </div>
        <p className="faint mt-1 text-xs">
          {window.length === 2 ? `${window[0]} – ${window[1]}` : window.length === 1 ? `from ${window[0]}` : 'always on while live'}
        </p>
      </div>
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
