import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, Popup } from 'maplibre-gl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useTheme } from '../context/ThemeContext.jsx';

/*
 * Visual pin manager for the admin console.
 *
 * The point of it: an operator should never type a latitude. They click the map
 * where the attraction is, a marker drops, they drag it to sit exactly right, fill
 * in a name + category + photo, and save. The coordinates come from the map.
 *
 * Built directly on maplibre-gl for the same reason MapCanvas is — react-map-gl@7
 * crashes against maplibre-gl@6's pluggable transform, and v6 is named-exports only.
 * Existing pins render as one GPU circle layer (not hundreds of DOM markers) so
 * panning never blocks the main thread, which is the standing map rule here.
 *
 * The "add" form is a real React panel layered over the canvas — a bottom sheet on
 * phones, a floating card on desktop — rather than HTML injected into a MapLibre
 * popup, so it gets the app's dark-mode styling and controlled inputs for free.
 */

const CATEGORY_COLOR = {
  MUST_VISIT: '#3b5bdb',
  MUST_EAT: '#e8590c',
  FAMOUS_RIDE: '#0ca678',
};

const CATEGORIES = [
  ['MUST_VISIT', 'Must visit'],
  ['MUST_EAT', 'Must eat'],
  ['FAMOUS_RIDE', 'Famous ride'],
];

const categoryColorExpression = [
  'match',
  ['get', 'category'],
  'MUST_VISIT',
  CATEGORY_COLOR.MUST_VISIT,
  'MUST_EAT',
  CATEGORY_COLOR.MUST_EAT,
  'FAMOUS_RIDE',
  CATEGORY_COLOR.FAMOUS_RIDE,
  '#868e96',
];

const PIN_LAYERS = ['pins-core', 'pins-glow'];
const EMPTY = { type: 'FeatureCollection', features: [] };

const trimmed = (value, fallback) => (typeof value === 'string' && value.trim()) || fallback;
const STYLE_LIGHT = trimmed(import.meta.env.VITE_MAP_STYLE, 'https://tiles.openfreemap.org/styles/positron');
const STYLE_DARK = trimmed(import.meta.env.VITE_MAP_STYLE_DARK, 'https://tiles.openfreemap.org/styles/dark');

const LAYERS = [
  {
    id: 'pins-glow',
    type: 'circle',
    source: 'pins',
    paint: {
      'circle-color': categoryColorExpression,
      'circle-blur': 1,
      'circle-opacity': 0.45,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 20, 17, 30],
    },
  },
  {
    id: 'pins-core',
    type: 'circle',
    source: 'pins',
    paint: {
      'circle-color': categoryColorExpression,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6, 17, 9],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  },
];

const round = (n) => Math.round(n * 1000) / 1000;

const toPinCollection = (pins) => ({
  type: 'FeatureCollection',
  features: (pins ?? []).reduce((acc, p) => {
    const lng = Number(p.lng);
    const lat = Number(p.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      acc.push({
        type: 'Feature',
        properties: { id: p.id, name: p.name, category: p.category },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
    }
    return acc;
  }, []),
});

const pushData = (map, id, data) => {
  const source = map?.getSource(id);
  if (!source) return;
  Promise.resolve(source.setData(data)).catch(() => {});
};

const BLANK_DRAFT_FORM = { name: '', category: 'MUST_VISIT', imageUrl: '', city: 'Jaipur', description: '' };

export default function MapPinManager({ initialView = { latitude: 26.9124, longitude: 75.7873, zoom: 12 } }) {
  const qc = useQueryClient();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const draftMarkerRef = useRef(null);
  const [failure, setFailure] = useState(null);

  const [bounds, setBounds] = useState(null);
  const [draft, setDraft] = useState(null); // { lng, lat } while placing a new pin
  const [fields, setFields] = useState(BLANK_DRAFT_FORM);

  const { isDark } = useTheme();
  const styleUrl = isDark ? STYLE_DARK : STYLE_LIGHT;
  const styleRef = useRef(styleUrl);

  // Existing pins in view. Rounded bounds in the key so a one-pixel pan doesn't refetch.
  const pinsQuery = useQuery({
    queryKey: ['pins', bounds && Object.values(bounds).map(round).join(',')],
    queryFn: ({ signal }) => api.pins(bounds, signal),
    enabled: Boolean(bounds),
    staleTime: 30_000,
  });

  const pinCollection = useMemo(() => toPinCollection(pinsQuery.data?.pins ?? pinsQuery.data ?? []), [pinsQuery.data]);

  const create = useMutation({
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

  // Map listeners read the freshest callbacks through this ref so the WebGL context
  // is built exactly once and never torn down on a parent re-render.
  const latest = useRef({});
  useEffect(() => {
    latest.current = { onBounds: setBounds, onDraft: setDraft };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const map = new MapLibreMap({
      container,
      style: styleRef.current,
      center: [Number(initialView.longitude), Number(initialView.latitude)],
      zoom: Number(initialView.zoom) || 12,
      dragRotate: false,
      refreshExpiredTiles: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    const install = () => {
      if (!map.isStyleLoaded()) return;
      if (!map.getSource('pins')) map.addSource('pins', { type: 'geojson', data: EMPTY });
      for (const layer of LAYERS) if (!map.getLayer(layer.id)) map.addLayer(layer);
      pushData(map, 'pins', latest.current.pinCollection ?? EMPTY);
    };

    const emitBounds = () => {
      const b = map.getBounds();
      latest.current.onBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };

    const handleLoad = () => {
      install();
      emitBounds();
    };

    const placeDraftMarker = (lng, lat) => {
      if (!draftMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'h-5 w-5 rounded-full border-2 border-white bg-glow shadow-lg';
        el.style.animation = 'pulseGlow 2.4s ease-in-out infinite';
        const marker = new Marker({ element: el, draggable: true }).setLngLat([lng, lat]).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          latest.current.onDraft({ lng: p.lng, lat: p.lat });
        });
        draftMarkerRef.current = marker;
      } else {
        draftMarkerRef.current.setLngLat([lng, lat]);
      }
    };

    const handleClick = (event) => {
      const live = PIN_LAYERS.filter((id) => map.getLayer(id));
      const hit = live.length ? map.queryRenderedFeatures(event.point, { layers: live })[0] : null;

      if (hit) {
        // Clicking an existing pin inspects it; it does not start a new one.
        const [lng, lat] = hit.geometry.coordinates;
        const body = document.createElement('div');
        const title = document.createElement('p');
        title.className = 'text-sm font-semibold';
        title.textContent = hit.properties.name ?? 'Attraction';
        const sub = document.createElement('p');
        sub.className = 'text-xs capitalize text-ink-700';
        sub.textContent = String(hit.properties.category ?? '').toLowerCase().replace(/_/g, ' ');
        body.append(title, sub);
        if (!popupRef.current) {
          popupRef.current = new Popup({ closeButton: true, closeOnClick: false, maxWidth: '220px', offset: 12 });
        }
        popupRef.current.setLngLat([lng, lat]).setDOMContent(body).addTo(map);
        return;
      }

      // Empty space → drop a draft pin at the click and open the form.
      const { lng, lat } = event.lngLat;
      placeDraftMarker(lng, lat);
      latest.current.onDraft({ lng, lat });
    };

    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const resetPointer = () => {
      map.getCanvas().style.cursor = '';
    };

    const handleError = (e) => {
      if (map.isStyleLoaded()) return;
      if (styleRef.current !== STYLE_LIGHT) {
        styleRef.current = STYLE_LIGHT;
        map.setStyle(STYLE_LIGHT);
        return;
      }
      setFailure(e?.error?.message ?? 'Could not reach the map tiles.');
    };

    map.on('load', handleLoad);
    map.on('styledata', install);
    map.on('moveend', emitBounds);
    map.on('click', handleClick);
    map.on('mouseenter', PIN_LAYERS, pointer);
    map.on('mouseleave', PIN_LAYERS, resetPointer);
    map.on('error', handleError);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: initialView is a starting camera and callbacks are read via `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a copy of the current pins on `latest` so `install()` can seed a freshly
  // swapped style, then push live updates to the running source.
  useEffect(() => {
    latest.current.pinCollection = pinCollection;
    pushData(mapRef.current, 'pins', pinCollection);
  }, [pinCollection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRef.current === styleUrl) return;
    styleRef.current = styleUrl;
    setFailure(null);
    map.setStyle(styleUrl);
  }, [styleUrl]);

  // Clearing the draft (cancel or successful save) removes its marker. Placement
  // and drag updates are handled imperatively in the click handler, so this effect
  // only ever needs to handle the teardown side.
  useEffect(() => {
    if (draft === null && draftMarkerRef.current) {
      draftMarkerRef.current.remove();
      draftMarkerRef.current = null;
    }
  }, [draft]);

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
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[value] }} />
            {label}
          </span>
        ))}
        {pinsQuery.isFetching && <span className="faint">updating…</span>}
      </div>

      <div className="relative mt-3 h-[55vh] w-full overflow-hidden rounded-2xl bg-sand-100 dark:bg-ink-900 md:h-[65vh]">
        <div ref={containerRef} className="absolute inset-0" />

        {failure && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <p className="max-w-sm text-sm text-ink-700 dark:text-sand-200">
              {failure} Check your connection, or point <code className="font-mono">VITE_MAP_STYLE</code> at another style.
            </p>
          </div>
        )}

        {pinsQuery.isError && !failure && (
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
