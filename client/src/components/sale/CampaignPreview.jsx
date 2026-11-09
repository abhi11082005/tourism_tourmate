import { useState } from 'react';
import SaleHero from './SaleHero.jsx';
import DealPrice from './DealPrice.jsx';
import { AnnouncementBarView } from './SaleAnnouncementBar.jsx';
import { ArrowIcon } from '../TourBits.jsx';
import { campaignState, computeDeal } from '../../lib/campaign.js';
import { stamp } from '../../lib/format.js';

/*
 * Live storefront preview for the admin Campaign Manager: renders the SAME components
 * customers see (SaleHero, the announcement bar, DealPrice) from the unsaved form, so
 * what the admin sees is what will ship — there is no separate "preview style" to drift.
 *
 * Differences from the real thing, all deliberate:
 *   - The hero is drawn in its compact layout. The panel is narrow even on a desktop
 *     screen, so viewport breakpoints would show the wrong layout; compact is the
 *     phone layout. (The desktop hero adds the "Biggest savings" panel from real tours.)
 *   - With no banner image the live site falls back to a photo from the tour list;
 *     the preview shows the plain gradient instead.
 *   - The sample tour is a stand-in. Its price comes from the admin-editable field below.
 *   - Everything is inert: no links, no clicks.
 */

const TABS = [
  ['hero', 'Homepage hero'],
  ['card', 'Tour card'],
  ['bar', 'Announcement bar'],
];

function SampleCard({ campaign, deal }) {
  return (
    <article className="relative isolate aspect-[6/5] w-full max-w-md overflow-hidden rounded-3xl bg-ink-900 text-white shadow-md ring-1 ring-black/5 dark:ring-white/10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-ink-600 via-ink-800 to-ink-900"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/35"
      />

      {deal && (
        <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
          <span className="rounded-full bg-glow px-3 py-1 text-xs font-black tracking-wide text-ink-900 shadow-lg">
            {campaign.discountPercent}% OFF
          </span>
          <span className="max-w-[12rem] truncate rounded-full bg-black/35 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/90 backdrop-blur-md">
            {campaign.name}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Sample tour</p>
        <h3 className="mt-1.5 text-xl font-bold leading-tight">Heritage walk &amp; palace tour</h3>
        <p className="mt-2 line-clamp-1 text-sm text-white/80">Preview only — your real tours use their own photos.</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          {deal ? (
            <DealPrice deal={deal} />
          ) : (
            <p className="text-sm text-white/70">Enter a valid price and discount to preview the saving.</p>
          )}
          {deal && (
            <span className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-white pl-5 pr-4 text-sm font-bold text-ink-900 shadow-lg">
              Book now
              <ArrowIcon className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** One line telling the admin what will actually happen on the live site. */
function Outcome({ draft }) {
  const state = campaignState(draft);
  const tone = {
    live: 'notice-ok',
    scheduled: 'rounded-xl bg-sky-50 p-3 text-sm text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
    paused: 'rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    ended: 'notice-error',
  }[state];
  const text = {
    live: draft.endsAt
      ? `This would be live now and end ${stamp(draft.endsAt)}.`
      : 'This would be live now, with no end date.',
    scheduled: `This would switch on automatically ${stamp(draft.startsAt)}.`,
    paused: 'Saved as paused: nothing shows on the site until you set it live.',
    ended: 'The end time is in the past, so this would never go live.',
  }[state];
  return (
    <p className={tone} role="status">
      {text}
    </p>
  );
}

export default function CampaignPreview({ draft, samplePrice, onSamplePriceChange }) {
  const [tab, setTab] = useState('hero');

  const campaign = {
    name: draft.name || 'Your campaign name',
    discountPercent: draft.discountPercent,
    bannerUrl: draft.bannerUrl,
    endsAt: draft.endsAt,
  };
  const validPercent = campaign.discountPercent >= 1 && campaign.discountPercent <= 100;
  const deal = validPercent ? computeDeal(samplePrice, campaign.discountPercent) : null;

  return (
    <div className="space-y-3" aria-label="Storefront preview" role="group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Live storefront preview</h3>
        <div role="tablist" aria-label="Preview surface" className="flex gap-1 rounded-full bg-sand-100 p-1 dark:bg-ink-800">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                tab === key
                  ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-600 dark:text-sand-50'
                  : 'text-ink-700 hover:text-ink-900 dark:text-sand-300 dark:hover:text-sand-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* inert + pointer-events-none: it is a picture of the storefront, not the storefront. */}
      <div inert="" aria-hidden="true" className="pointer-events-none select-none">
        {tab === 'hero' && <SaleHero campaign={campaign} compact />}
        {tab === 'card' && <SampleCard campaign={campaign} deal={deal} />}
        {tab === 'bar' && (
          <div className="overflow-hidden rounded-2xl">
            <AnnouncementBarView campaign={campaign} onDismiss={() => {}} onExploreDeals={() => {}} />
          </div>
        )}
      </div>

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="faint">Sample tour price (₹)</span>
        <input
          type="number"
          min="1"
          step="100"
          className="field w-32"
          value={samplePrice}
          onChange={(e) => onSamplePriceChange(e.target.value)}
        />
        <span className="faint text-xs">only used for this preview</span>
      </label>

      <Outcome draft={draft} />
    </div>
  );
}
