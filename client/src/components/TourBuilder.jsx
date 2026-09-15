import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr, shortDate, toIsoDate } from '../lib/format.js';

/*
 * Unified Tour & Seat builder — one wizard for both "create" and "edit".
 *
 * It replaces the old raw-JSON PackageBuilder and the standalone SeatManager: an
 * operator opening this once can name the package, lay out its itinerary, and open
 * a month of departures without ever hand-editing JSON or copying a tour id between
 * two forms.
 *
 * Three steps, and the split is deliberate:
 *   1. Basics & media   — the fields a listing card and detail header need.
 *   2. Itinerary & details — the day-by-day plan (reorderable), plus inclusions,
 *      exclusions, the pricing `options` block and the refund ladder.
 *   3. Dates & seats    — a calendar range → a batch of slots. In edit mode this
 *      step also shows the live departures so capacity can be nudged in place.
 *
 * `initialData` is what makes edit reuse work: pass a tour row (snake_case from the
 * API is fine — it's normalised below) and every field pre-fills; pass nothing and
 * it's a blank create. Money is never computed here; prices are echoed for review
 * and the server re-derives every total at quote and checkout time.
 */

const TOUR_TYPES = ['HERITAGE', 'ADVENTURE', 'CULINARY', 'NATURE', 'SPIRITUAL', 'NIGHTLIFE'];

const BLANK_FORM = {
  title: '',
  slug: '',
  overview: '',
  tourType: 'HERITAGE',
  basePrice: 2500,
  durationDays: 1,
  durationNights: 0,
  inclusions: 'Guide\nEntry tickets',
  exclusions: 'Meals',
  isPublished: false,
};

const SAMPLE_OPTIONS = `{
  "transport": { "type": "enum", "default": "shared",
    "choices": [
      { "value": "shared", "label": "Shared van", "pricePerSeat": 0 },
      { "value": "private", "label": "Private car", "pricePerSeat": 900 }
    ] },
  "photographer": { "type": "boolean", "pricePerSeat": 400 }
}`;

const slugify = (v) => v.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const splitLines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const splitCsv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const asArray = (v) => (Array.isArray(v) ? v : []);

/** Snake_case tour row (or an already-camel one) → the wizard's flat form + blocks. */
function fromInitial(d) {
  if (!d) {
    return {
      form: { ...BLANK_FORM },
      gallery: [{ url: '', alt: '' }],
      itinerary: [{ title: '', summary: '', stops: '' }],
      refundPolicy: [],
      optionsText: SAMPLE_OPTIONS,
    };
  }
  const itin = asArray(d.itinerary).map((it) => ({
    title: it.title ?? '',
    summary: it.summary ?? '',
    stops: asArray(it.stops)
      .map((s) => (typeof s === 'string' ? s : s?.name ?? s?.title ?? ''))
      .filter(Boolean)
      .join(', '),
  }));
  const gallery = asArray(d.gallery).map((g) => ({ url: g.url ?? '', alt: g.alt ?? '' }));
  const options = d.options ?? {};
  return {
    form: {
      title: d.title ?? '',
      slug: d.slug ?? '',
      overview: d.overview ?? '',
      tourType: d.tour_type ?? d.tourType ?? 'HERITAGE',
      basePrice: d.base_price ?? d.basePrice ?? 0,
      durationDays: d.duration_days ?? d.durationDays ?? 1,
      durationNights: d.duration_nights ?? d.durationNights ?? 0,
      inclusions: asArray(d.inclusions).join('\n'),
      exclusions: asArray(d.exclusions).join('\n'),
      isPublished: Boolean(d.is_published ?? d.isPublished ?? false),
    },
    gallery: gallery.length ? gallery : [{ url: '', alt: '' }],
    itinerary: itin.length ? itin : [{ title: '', summary: '', stops: '' }],
    refundPolicy: asArray(d.refund_policy ?? d.refundPolicy).map((r) => ({
      daysBefore: String(r.daysBefore ?? ''),
      refundPercent: String(r.refundPercent ?? ''),
    })),
    optionsText: Object.keys(options).length ? JSON.stringify(options, null, 2) : SAMPLE_OPTIONS,
  };
}

const STEPS = ['Basics & media', 'Itinerary & details', 'Dates & seats'];

export default function TourBuilder({ initialData = null, onSaved }) {
  const qc = useQueryClient();
  const isEdit = Boolean(initialData?.id);
  const tourId = initialData?.id ?? null;

  const seed = useMemo(() => fromInitial(initialData), [initialData]);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(seed.form);
  const [gallery, setGallery] = useState(seed.gallery);
  const [itinerary, setItinerary] = useState(seed.itinerary);
  const [refundPolicy, setRefundPolicy] = useState(seed.refundPolicy);
  const [optionsText, setOptionsText] = useState(seed.optionsText);
  const [slugTouched, setSlugTouched] = useState(isEdit);

  // Step 3 — date range + seat batch.
  const [range, setRange] = useState({ start: null, end: null });
  const [seats, setSeats] = useState(initialData?.total_seats ?? initialData?.totalSeats ?? 20);
  const [priceModifier, setPriceModifier] = useState(0);
  const [weekendsOnly, setWeekendsOnly] = useState(false);

  const [formError, setFormError] = useState(null);

  // Re-seed when the parent hands over a different tour to edit.
  useEffect(() => {
    setForm(seed.form);
    setGallery(seed.gallery);
    setItinerary(seed.itinerary);
    setRefundPolicy(seed.refundPolicy);
    setOptionsText(seed.optionsText);
    setSlugTouched(Boolean(initialData?.id));
    setStep(0);
    setRange({ start: null, end: null });
    setFormError(null);
  }, [seed, initialData]);

  const setField = (key, cast = (v) => v) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: cast(e.target.type === 'checkbox' ? e.target.checked : e.target.value),
    }));

  // Expand the picked range into the concrete dates the slots endpoint wants.
  const slotDates = useMemo(() => {
    if (!range.start || !range.end) return [];
    const out = [];
    for (let d = new Date(`${range.start}T00:00:00`); toIsoDate(d) <= range.end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (weekendsOnly && day !== 0 && day !== 6) continue;
      out.push(toIsoDate(d));
      if (out.length >= 180) break;
    }
    return out;
  }, [range, weekendsOnly]);

  function buildBody() {
    const options = JSON.parse(optionsText || '{}');
    return {
      title: form.title.trim(),
      slug: (form.slug || slugify(form.title)).trim(),
      overview: form.overview.trim(),
      tourType: (form.tourType || 'HERITAGE').trim(),
      basePrice: Number(form.basePrice),
      totalSeats: Number(seats) || 1,
      durationDays: Number(form.durationDays),
      durationNights: Number(form.durationNights),
      isPublished: Boolean(form.isPublished),
      itinerary: itinerary
        .filter((it) => it.title.trim())
        .map((it, i) => ({
          day: i + 1,
          title: it.title.trim(),
          summary: it.summary.trim(),
          stops: splitCsv(it.stops),
        })),
      inclusions: splitLines(form.inclusions),
      exclusions: splitLines(form.exclusions),
      options,
      gallery: gallery
        .filter((g) => g.url.trim())
        .map((g) => ({ url: g.url.trim(), ...(g.alt.trim() ? { alt: g.alt.trim() } : {}) })),
      refundPolicy: refundPolicy
        .filter((r) => r.daysBefore !== '' && r.refundPercent !== '')
        .map((r) => ({ daysBefore: Number(r.daysBefore), refundPercent: Number(r.refundPercent) })),
    };
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = buildBody(); // may throw on bad options JSON — caught below
      let tour;
      if (isEdit) {
        await api.updateTourAdmin(tourId, body);
        tour = { id: tourId, ...body };
      } else {
        const res = await api.createTourAdmin(body);
        tour = res.tour;
      }
      if (slotDates.length && tour?.id) {
        await api.createSlots(tour.id, {
          dates: slotDates,
          totalSeats: Number(seats) || 1,
          priceModifier: Number(priceModifier) || 0,
        });
      }
      return tour;
    },
    onSuccess: (tour) => {
      qc.invalidateQueries({ queryKey: ['admin-tours'] });
      qc.invalidateQueries({ queryKey: ['tours'] });
      if (tour?.id) qc.invalidateQueries({ queryKey: ['calendar', tour.id] });
      onSaved?.(tour);
    },
  });

  function submit() {
    setFormError(null);
    // Cheap client checks that mirror the server's zod bounds, so the operator
    // gets an inline nudge instead of a round-trip 400.
    if (form.title.trim().length < 3) return fail(0, 'Give the package a title (3+ characters).');
    if (!slugify(form.slug || form.title)) return fail(0, 'A URL slug is required.');
    if (form.overview.trim().length < 10) return fail(0, 'Write a short overview (10+ characters).');
    try {
      JSON.parse(optionsText || '{}');
    } catch (err) {
      return fail(1, `Pricing options must be valid JSON: ${err.message}`);
    }
    save.mutate();
  }

  function fail(atStep, message) {
    setStep(atStep);
    setFormError(message);
  }

  return (
    <section className="card p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{isEdit ? 'Edit package' : 'New package'}</h2>
          <p className="faint text-xs">
            {isEdit ? 'Update details, then open more dates below.' : 'Three steps to a bookable tour.'}
          </p>
        </div>
        {isEdit && (
          <span className="chip bg-sand-100 dark:bg-ink-800">
            editing <span className="ml-1 font-mono">{form.slug || tourId?.slice(0, 8)}</span>
          </span>
        )}
      </header>

      <StepNav step={step} onJump={setStep} />

      <div className="mt-4">
        {step === 0 && (
          <BasicsStep
            form={form}
            setField={setField}
            setForm={setForm}
            slugTouched={slugTouched}
            setSlugTouched={setSlugTouched}
            gallery={gallery}
            setGallery={setGallery}
          />
        )}
        {step === 1 && (
          <ItineraryStep
            itinerary={itinerary}
            setItinerary={setItinerary}
            form={form}
            setField={setField}
            optionsText={optionsText}
            setOptionsText={setOptionsText}
            refundPolicy={refundPolicy}
            setRefundPolicy={setRefundPolicy}
          />
        )}
        {step === 2 && (
          <DatesStep
            range={range}
            setRange={setRange}
            seats={seats}
            setSeats={setSeats}
            priceModifier={priceModifier}
            setPriceModifier={setPriceModifier}
            weekendsOnly={weekendsOnly}
            setWeekendsOnly={setWeekendsOnly}
            slotDates={slotDates}
            isEdit={isEdit}
            tourId={tourId}
          />
        )}
      </div>

      {formError && <p className="notice-error mt-4">{formError}</p>}
      {save.isError && <p className="notice-error mt-4" role="alert">{save.error.message}</p>}
      {save.isSuccess && (
        <p className="notice-ok mt-4">
          Saved{slotDates.length ? ` and opened ${slotDates.length} departure${slotDates.length === 1 ? '' : 's'}` : ''}.
          {!isEdit && (
            <> Run <code className="font-mono">npm run rag:index</code> so the assistant can answer questions about it.</>
          )}
        </p>
      )}

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ‹ Back
        </button>

        <div className="flex items-center gap-2">
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Next ›
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={save.isPending} onClick={submit}>
              {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create package'}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

/* --------------------------------------------------------------- stepper header */

function StepNav({ step, onJump }) {
  return (
    <ol className="mt-4 flex items-center gap-1.5 sm:gap-2" aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i === step ? 'active' : i < step ? 'done' : 'todo';
        return (
          <li key={label} className="flex flex-1 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-current={state === 'active' ? 'step' : undefined}
              className={[
                'flex min-h-11 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition sm:text-sm',
                state === 'active'
                  ? 'bg-ink-800 text-sand-50 dark:bg-sand-200 dark:text-ink-900'
                  : state === 'done'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                    : 'bg-sand-100 text-ink-700 dark:bg-ink-800 dark:text-sand-300',
              ].join(' ')}
            >
              <span
                className={[
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px]',
                  state === 'active'
                    ? 'bg-sand-50 text-ink-900 dark:bg-ink-900 dark:text-sand-50'
                    : state === 'done'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-sand-300 text-ink-800 dark:bg-ink-700 dark:text-sand-200',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className="hidden truncate sm:inline">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ step 1 */

function BasicsStep({ form, setField, setForm, slugTouched, setSlugTouched, gallery, setGallery }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Title"
          required
          value={form.title}
          onChange={(e) => {
            const title = e.target.value;
            // Auto-fill the slug from the title until the operator edits it by hand.
            setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
          }}
        />
        <Field
          label="URL slug"
          required
          hint="lowercase-with-hyphens"
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }));
          }}
        />
        <label className="block text-sm">
          Type
          <select className="field mt-1" value={form.tourType} onChange={setField('tourType')}>
            {TOUR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <Field label="Base price / seat" type="number" min="0" value={form.basePrice} onChange={setField('basePrice')} hint="₹, before options" />
        <Field label="Days" type="number" min="1" value={form.durationDays} onChange={setField('durationDays')} />
        <Field label="Nights" type="number" min="0" value={form.durationNights} onChange={setField('durationNights')} />
      </div>

      <label className="block text-sm">
        Overview
        <textarea className="field mt-1 h-24 py-2" required value={form.overview} onChange={setField('overview')} />
      </label>

      <GalleryEditor gallery={gallery} setGallery={setGallery} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-ink-800 dark:accent-sand-300" checked={form.isPublished} onChange={setField('isPublished')} />
        Publish immediately
      </label>
    </div>
  );
}

function GalleryEditor({ gallery, setGallery }) {
  const update = (i, key, value) => setGallery((g) => g.map((row, j) => (j === i ? { ...row, [key]: value } : row)));
  const add = () => setGallery((g) => [...g, { url: '', alt: '' }]);
  const remove = (i) => setGallery((g) => (g.length > 1 ? g.filter((_, j) => j !== i) : g));

  return (
    <fieldset>
      <legend className="text-sm font-semibold">Gallery</legend>
      <p className="faint text-xs">First image is the cover. URLs only — files live on Cloudinary or S3.</p>
      <ul className="mt-2 space-y-2">
        {gallery.map((row, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl border border-sand-200 p-2 dark:border-ink-700 sm:flex-row sm:items-center">
            <span className="chip shrink-0 bg-sand-100 dark:bg-ink-800">{i === 0 ? 'Cover' : `#${i + 1}`}</span>
            {row.url ? (
              <img src={row.url} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
            ) : (
              <span className="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-sand-100 text-[10px] text-sand-500 dark:bg-ink-800 dark:text-sand-400">no img</span>
            )}
            <input className="field" placeholder="https://…" value={row.url} onChange={(e) => update(i, 'url', e.target.value)} aria-label={`Image ${i + 1} URL`} />
            <input className="field sm:max-w-[40%]" placeholder="alt text" value={row.alt} onChange={(e) => update(i, 'alt', e.target.value)} aria-label={`Image ${i + 1} alt text`} />
            <button type="button" className="btn-ghost shrink-0 px-3" onClick={() => remove(i)} aria-label={`Remove image ${i + 1}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={add}>
        + Add image
      </button>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ step 2 */

function ItineraryStep({ itinerary, setItinerary, form, setField, optionsText, setOptionsText, refundPolicy, setRefundPolicy }) {
  return (
    <div className="space-y-5">
      <ItineraryEditor itinerary={itinerary} setItinerary={setItinerary} />

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          Inclusions
          <span className="faint"> — one per line</span>
          <textarea className="field mt-1 h-24 py-2" value={form.inclusions} onChange={setField('inclusions')} />
        </label>
        <label className="block text-sm">
          Exclusions
          <span className="faint"> — one per line</span>
          <textarea className="field mt-1 h-24 py-2" value={form.exclusions} onChange={setField('exclusions')} />
        </label>
      </div>

      <RefundPolicyEditor refundPolicy={refundPolicy} setRefundPolicy={setRefundPolicy} />

      <label className="block text-sm">
        <span className="font-semibold">Pricing options</span>
        <span className="faint"> — advanced, JSON. The quote engine reads this verbatim.</span>
        <textarea
          className="field mt-1 h-40 py-2 font-mono text-xs"
          spellCheck={false}
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
        />
      </label>
    </div>
  );
}

function ItineraryEditor({ itinerary, setItinerary }) {
  const dragFrom = useRef(null);

  const update = (i, key, value) => setItinerary((list) => list.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const add = () => setItinerary((list) => [...list, { title: '', summary: '', stops: '' }]);
  const remove = (i) => setItinerary((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : list));

  const move = (from, to) => {
    if (from == null || to == null || from === to || to < 0) return;
    setItinerary((list) => {
      if (to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <fieldset>
      <legend className="text-sm font-semibold">Itinerary</legend>
      <p className="faint text-xs">Drag the handle to reorder, or use the arrows on touch. Day numbers renumber themselves.</p>
      <ol className="mt-2 space-y-2">
        {itinerary.map((it, i) => (
          <li
            key={i}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              move(dragFrom.current, i);
              dragFrom.current = null;
            }}
            className="rounded-xl border border-sand-200 bg-sand-50 p-3 dark:border-ink-700 dark:bg-ink-800"
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-1 cursor-grab select-none text-sand-500 active:cursor-grabbing dark:text-sand-400"
                aria-hidden="true"
                title="Drag to reorder"
              >
                ⠿
              </span>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-800 text-xs font-bold text-sand-50 dark:bg-sand-300 dark:text-ink-900">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <input className="field" placeholder="Day title (e.g. Old city walk)" value={it.title} onChange={(e) => update(i, 'title', e.target.value)} aria-label={`Day ${i + 1} title`} />
                <textarea className="field h-16 py-2" placeholder="What happens this day…" value={it.summary} onChange={(e) => update(i, 'summary', e.target.value)} aria-label={`Day ${i + 1} summary`} />
                <input className="field" placeholder="Stops, comma separated" value={it.stops} onChange={(e) => update(i, 'stops', e.target.value)} aria-label={`Day ${i + 1} stops`} />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move day ${i + 1} up`}>
                  ↑
                </button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={i === itinerary.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move day ${i + 1} down`}>
                  ↓
                </button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => remove(i)} aria-label={`Remove day ${i + 1}`}>
                  ✕
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={add}>
        + Add day
      </button>
    </fieldset>
  );
}

function RefundPolicyEditor({ refundPolicy, setRefundPolicy }) {
  const update = (i, key, value) => setRefundPolicy((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const add = () => setRefundPolicy((rows) => [...rows, { daysBefore: '', refundPercent: '' }]);
  const remove = (i) => setRefundPolicy((rows) => rows.filter((_, j) => j !== i));

  return (
    <fieldset>
      <legend className="text-sm font-semibold">Refund ladder</legend>
      <p className="faint text-xs">Optional. Refund percent by how many days before departure a booking is cancelled.</p>
      <ul className="mt-2 space-y-2">
        {refundPolicy.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="number" min="0" className="field w-20 py-1" value={r.daysBefore} onChange={(e) => update(i, 'daysBefore', e.target.value)} aria-label={`Rule ${i + 1} days before`} />
              <span className="faint">days →</span>
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="number" min="0" max="100" className="field w-20 py-1" value={r.refundPercent} onChange={(e) => update(i, 'refundPercent', e.target.value)} aria-label={`Rule ${i + 1} refund percent`} />
              <span className="faint">% back</span>
            </label>
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => remove(i)} aria-label={`Remove rule ${i + 1}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={add}>
        + Add rule
      </button>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ step 3 */

function DatesStep({ range, setRange, seats, setSeats, priceModifier, setPriceModifier, weekendsOnly, setWeekendsOnly, slotDates, isEdit, tourId }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <RangeCalendar range={range} onChange={setRange} />

        <div className="space-y-3">
          <Field label="Seats per departure" type="number" min="1" value={seats} onChange={(e) => setSeats(e.target.value)} />
          <Field label="Price modifier" type="number" value={priceModifier} onChange={(e) => setPriceModifier(e.target.value)} hint="± per seat on these dates" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-ink-800 dark:accent-sand-300" checked={weekendsOnly} onChange={(e) => setWeekendsOnly(e.target.checked)} />
            Weekends only
          </label>

          <div className="rounded-xl bg-sand-50 p-3 text-sm dark:bg-ink-800">
            {range.start && range.end ? (
              <p>
                <span className="font-semibold">{slotDates.length}</span> departure{slotDates.length === 1 ? '' : 's'} from{' '}
                <span className="font-semibold">{shortDate(range.start)}</span> to{' '}
                <span className="font-semibold">{shortDate(range.end)}</span>
                {Number(priceModifier) !== 0 && <> · {inr(priceModifier)}/seat</>}
              </p>
            ) : (
              <p className="faint">Pick a start and end date on the calendar to open a batch of departures.</p>
            )}
          </div>
        </div>
      </div>

      {isEdit && tourId && <DepartureManager tourId={tourId} />}
    </div>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Lightweight two-tap range picker. No server query — it only chooses dates. */
function RangeCalendar({ range, onChange }) {
  const [cursor, setCursor] = useState(() => new Date());
  const today = toIsoDate(new Date());

  const { first, last } = useMemo(() => {
    const f = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const l = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return { first: f, last: l };
  }, [cursor]);

  const cells = useMemo(() => {
    const out = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= last.getDate(); d += 1) {
      out.push(toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
    }
    return out;
  }, [cursor, first, last]);

  const pick = (iso) => {
    if (!range.start || (range.start && range.end)) return onChange({ start: iso, end: null });
    if (iso < range.start) return onChange({ start: iso, end: null });
    onChange({ start: range.start, end: iso });
  };

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-2xl border border-sand-200 p-3 dark:border-ink-700">
      <header className="mb-2 flex items-center justify-between">
        <button type="button" className="btn-ghost px-3" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">
          ‹
        </button>
        <h3 className="text-sm font-semibold" aria-live="polite">{monthLabel}</h3>
        <button type="button" className="btn-ghost px-3" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">
          ›
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-sand-500 dark:text-sand-400">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`blank-${i}`} />;
          const past = iso < today;
          const isStart = iso === range.start;
          const isEnd = iso === range.end;
          const inRange = range.start && range.end && iso > range.start && iso < range.end;
          const edge = isStart || isEnd;
          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              onClick={() => pick(iso)}
              aria-pressed={edge}
              aria-label={shortDate(iso)}
              className={[
                'min-h-11 rounded-lg text-xs transition',
                past ? 'cursor-not-allowed text-sand-300 dark:text-ink-600' : '',
                edge ? 'bg-ink-800 font-bold text-sand-50 dark:bg-sand-300 dark:text-ink-900' : '',
                inRange ? 'bg-sand-200 text-ink-900 dark:bg-ink-700 dark:text-sand-100' : '',
                !past && !edge && !inRange ? 'text-ink-800 hover:bg-sand-100 dark:text-sand-200 dark:hover:bg-ink-800' : '',
              ].join(' ')}
            >
              {Number(iso.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/*
 * Edit-mode only: the live departures for this tour so capacity can be nudged and a
 * date opened or closed without leaving the wizard. Mirrors the old SeatManager
 * table but scoped to the next ~4 months and folded into step 3.
 */
function DepartureManager({ tourId }) {
  const qc = useQueryClient();
  const from = toIsoDate(new Date());
  const to = toIsoDate(new Date(Date.now() + 120 * 864e5));

  const calendar = useQuery({
    queryKey: ['calendar', tourId, from, to],
    queryFn: ({ signal }) => api.calendar(tourId, { from, to }, signal),
    enabled: Boolean(tourId),
    staleTime: 0,
  });

  const patchSlot = useMutation({
    mutationFn: ({ slotId, body }) => api.updateSlot(slotId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', tourId] }),
  });

  const rows = calendar.data?.dates ?? [];

  return (
    <div className="rounded-2xl border border-sand-200 p-3 dark:border-ink-700">
      <h3 className="text-sm font-semibold">Upcoming departures</h3>
      <p className="faint text-xs">Next 120 days. Capacity cannot drop below seats already sold.</p>

      {patchSlot.isError && <p className="notice-error mt-2" role="alert">{patchSlot.error.message}</p>}

      {/* Table on sm+, stacked cards on phones. */}
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-sand-500 dark:text-sand-400">
            <tr>
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2">Capacity</th>
              <th scope="col" className="py-2">Free</th>
              <th scope="col" className="py-2">Held</th>
              <th scope="col" className="py-2">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.slotId} className="border-t border-sand-100 dark:border-ink-700">
                <td className="py-2">{shortDate(d.date)}</td>
                <td className="py-2">
                  <CapacityInput slot={d} onCommit={(next) => patchSlot.mutate({ slotId: d.slotId, body: { totalSeats: next } })} />
                </td>
                <td className="py-2 tabular-nums">{d.availableSeats}</td>
                <td className="py-2 tabular-nums text-sand-500 dark:text-sand-400">{d.heldSeats}</td>
                <td className="py-2">
                  <button type="button" className="chip" aria-pressed={d.isOpen} onClick={() => patchSlot.mutate({ slotId: d.slotId, body: { isOpen: !d.isOpen } })}>
                    {d.isOpen ? 'Open' : 'Closed'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 space-y-2 sm:hidden">
        {rows.map((d) => (
          <li key={d.slotId} className="rounded-xl border border-sand-200 p-3 dark:border-ink-700">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{shortDate(d.date)}</p>
              <button type="button" className="chip" aria-pressed={d.isOpen} onClick={() => patchSlot.mutate({ slotId: d.slotId, body: { isOpen: !d.isOpen } })}>
                {d.isOpen ? 'Open' : 'Closed'}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <span className="faint">Cap</span>
                <CapacityInput slot={d} onCommit={(next) => patchSlot.mutate({ slotId: d.slotId, body: { totalSeats: next } })} />
              </label>
              <span className="tabular-nums">{d.availableSeats} free</span>
              <span className="tabular-nums text-sand-500 dark:text-sand-400">{d.heldSeats} held</span>
            </div>
          </li>
        ))}
      </ul>

      {calendar.isSuccess && rows.length === 0 && (
        <p className="faint mt-3 text-sm">No departures yet — open some above.</p>
      )}
    </div>
  );
}

function CapacityInput({ slot, onCommit }) {
  return (
    <input
      type="number"
      min="1"
      className="field w-20 py-1"
      defaultValue={slot.totalSeats}
      aria-label={`Capacity for ${slot.date}`}
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (next && next !== slot.totalSeats) onCommit(next);
      }}
    />
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
