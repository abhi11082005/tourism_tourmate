import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import MapCanvas from './MapCanvas.jsx';
import { CATEGORY_STYLE } from '../lib/mapMarkers.js';

/*
 * Visual pin manager for the admin console.
 *
 * The point of it: an operator should never type a latitude. They click the map
 * where the attraction is, a marker drops, they drag it to sit exactly right, fill
 * in a name + category + photo, and save. The coordinates come from the map.
 *
 * The map itself is the shared MapCanvas (Google Maps, AdvancedMarkers, clustered
 * existing pins). This file owns only the form and the save request, so the admin
 * map and the public maps can never drift apart.
 *
 * The "add" form is a real React panel layered over the canvas — a bottom sheet on
 * phones, a floating card on desktop — so it gets the app's dark-mode styling and
 * controlled inputs for free.
 */

const CATEGORIES = [
  ['MUST_VISIT', 'Must visit'],
  ['MUST_EAT', 'Must eat'],
  ['FAMOUS_RIDE', 'Famous ride'],
];

const round = (n) => Math.round(n * 1000) / 1000;

const BLANK_DRAFT_FORM = { name: '', category: 'MUST_VISIT', imageUrl: '', city: 'Jaipur', description: '' };

export default function MapPinManager({ initialView = { latitude: 26.9124, longitude: 75.7873, zoom: 12 } }) {
  const qc = useQueryClient();

  const [bounds, setBounds] = useState(null);
  const [draft, setDraft] = useState(null); // { lng, lat } while placing a new pin
  const [fields, setFields] = useState(BLANK_DRAFT_FORM);

  // Existing pins in view. Rounded bounds in the key so a one-pixel pan doesn't refetch.
  const pinsQuery = useQuery({
    queryKey: ['pins', bounds && Object.values(bounds).map(round).join(',')],
    queryFn: ({ signal }) => api.pins(bounds, signal),
    enabled: Boolean(bounds),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  /*
   * GET /attractions/pins answers a GeoJSON FeatureCollection. This component used to
   * read `data.pins ?? data`, which is never an array for that shape — so no existing
   * pin ever drew in the admin map. Read the actual shape.
   */
  const pins = useMemo(
    () =>
      (pinsQuery.data?.features ?? []).map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        category: f.properties.category,
        imageUrl: f.properties.imageUrl ?? null,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })),
    [pinsQuery.data]
  );

  const create = useMutation({
    // Same request body the admin endpoint has always taken (POST /admin/attractions).
    mutationFn: () =>
      api.createAttraction({
        name: fields.name.trim(),
        category: fields.category,
        description: fields.description.trim(),
        lat: Number(draft.lat),
        lng: Number(draft.lng),
        imageUrl: fields.imageUrl.trim() || undefined,
        city: fields.city.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pins'] });
      qc.invalidateQueries({ queryKey: ['spotlight'] });
      cancelDraft();
    },
  });

  const cancelDraft = () => {
    setDraft(null);
    setFields(BLANK_DRAFT_FORM);
    create.reset();
  };

  const onMapClick = useCallback((point) => setDraft(point), []);
  const onDraftChange = useCallback((point) => setDraft(point), []);

  const setF = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Map pins</h2>
      <p className="faint text-xs">
        Click the map where an attraction is, drag the glowing pin to fine-tune, then name it. No latitudes to type.
      </p>

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {CATEGORIES.map(([value, label]) => (
          <span key={value} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CATEGORY_STYLE[value].color }} />
            {label}
          </span>
        ))}
        {pinsQuery.isFetching && <span className="faint">updating…</span>}
      </div>

      <div className="relative mt-3">
        <MapCanvas
          pins={pins}
          initialView={initialView}
          onMoveEnd={setBounds}
          onMapClick={onMapClick}
          draft={draft}
          onDraftChange={onDraftChange}
          gestureHandling="greedy"
          className="h-[55vh] w-full md:h-[65vh]"
        />

        {pinsQuery.isError && (
          <p className="notice-error absolute left-3 top-3 max-w-xs">Could not load existing pins.</p>
        )}

        {/* Add-pin form: bottom sheet on phones, floating card on desktop. */}
        {draft && (
          <div className="absolute inset-x-0 bottom-0 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:w-80">
            <form
              className="rounded-t-2xl border border-sand-200 bg-white p-4 shadow-lg dark:border-ink-600 dark:bg-ink-900 sm:rounded-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                if (fields.name.trim().length >= 2) create.mutate();
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">New pin</h3>
                <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={cancelDraft} aria-label="Discard new pin">
                  ✕
                </button>
              </div>

              <p className="faint mt-1 font-mono text-[11px]">
                {Number(draft.lat).toFixed(5)}, {Number(draft.lng).toFixed(5)}
              </p>

              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Name
                  <input className="field mt-1" required autoFocus value={fields.name} onChange={setF('name')} placeholder="Hawa Mahal" />
                </label>
                <label className="block text-sm">
                  Category
                  <select className="field mt-1" value={fields.category} onChange={setF('category')}>
                    {CATEGORIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Description
                  <textarea
                    className="field mt-1 min-h-20 py-2"
                    maxLength={4000}
                    value={fields.description}
                    onChange={setF('description')}
                    placeholder="A line or two for the spotlight card"
                  />
                </label>
                <label className="block text-sm">
                  Image URL
                  <input className="field mt-1" type="url" value={fields.imageUrl} onChange={setF('imageUrl')} placeholder="https://…" />
                </label>
                <label className="block text-sm">
                  City
                  <input className="field mt-1" value={fields.city} onChange={setF('city')} />
                </label>
                {fields.imageUrl.trim() && (
                  <img src={fields.imageUrl} alt="" className="h-24 w-full rounded-xl object-cover" loading="lazy" />
                )}
              </div>

              {create.isError && <p className="notice-error mt-3" role="alert">{create.error.message}</p>}

              <div className="mt-3 flex gap-2">
                <button type="submit" className="btn-primary flex-1" disabled={create.isPending || fields.name.trim().length < 2}>
                  {create.isPending ? 'Saving…' : 'Add pin'}
                </button>
                <button type="button" className="btn-ghost" onClick={cancelDraft}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
