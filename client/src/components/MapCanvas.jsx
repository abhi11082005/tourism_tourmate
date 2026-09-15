import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, Popup } from 'maplibre-gl';
import { useTheme } from '../context/ThemeContext.jsx';

/*
 * The one place MapLibre GL is touched.
 *
 * Why there is no react-map-gl here: that wrapper reaches inside the map and
 * assigns `map.painter.transform`, then clones `map.transform`. MapLibre v5
 * replaced the transform with a pluggable `ITransform` (globe/mercator), so
 * react-map-gl@7 + maplibre-gl@6 crashes on the first render. Driving the map
 * directly is ~60 lines more and removes the whole compatibility question.
 *
 * Also note maplibre-gl v6 ships named exports only — `import maplibregl from
 * 'maplibre-gl'` gives you `undefined`, which surfaces later as
 * "Cannot read properties of undefined (reading 'Map')".
 *
 * Main-thread rules this file follows, because "map must not freeze the UI" is
 * a hard requirement:
 *  - Attraction pins render as a GPU-drawn circle+glow layer fed by one GeoJSON
 *    source, not as hundreds of DOM markers. DOM markers are repositioned in JS
 *    on every frame of a pan; a layer is drawn by the GPU.
 *  - Pin updates go through `source.setData()`. The map instance is created
 *    once and never torn down for a data change.
 *  - Exactly one Popup element exists, reused across selections.
 *  - Bounds are read once on `moveend`, never per frame.
 *  - Route geometry arrives from OSRM already simplified; nothing is recomputed.
 */

const trimmed = (value, fallback) => (typeof value === 'string' && value.trim()) || fallback;

/*
 * OpenFreeMap: no API key, no signup, no rate limit, OpenStreetMap data under
 * ODbL. `positron` is the light grey basemap the indigo/orange pins were
 * designed against. Both URLs are overridable so a self-hosted tile server can
 * be dropped in without touching code.
 */
const STYLE_LIGHT = trimmed(
  import.meta.env.VITE_MAP_STYLE,
  'https://tiles.openfreemap.org/styles/positron'
);
const STYLE_DARK = trimmed(
  import.meta.env.VITE_MAP_STYLE_DARK,
  'https://tiles.openfreemap.org/styles/dark'
);

const CATEGORY_COLOR = {
  MUST_VISIT: '#3b5bdb',
  MUST_EAT: '#e8590c',
  FAMOUS_RIDE: '#0ca678',
};

// Data-driven styling: one expression covers every category, so the layer count
// stays at two no matter how many pins the city has.
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

/*
 * Declared in draw order — `addLayer` appends, so the route sits under the pins
 * and the solid core sits over its own glow.
 */
const LAYERS = [
  {
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
  },
  {
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1d2135', 'line-width': 4 },
  },
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

const EMPTY = { type: 'FeatureCollection', features: [] };

const coords = (item) => {
  const lng = Number(item?.lng);
  const lat = Number(item?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
};

const toPinCollection = (pins) => ({
  type: 'FeatureCollection',
  // A single null lat/lng would otherwise make MapLibre reject the whole
  // collection and blank every pin on the map.
  features: pins.reduce((acc, p) => {
    const position = coords(p);
    if (position) {
      acc.push({
        type: 'Feature',
        // Keep the payload tiny: anything the popup needs, nothing more.
        properties: { id: p.id, name: p.name, category: p.category, imageUrl: p.imageUrl ?? null },
        geometry: { type: 'Point', coordinates: position },
      });
    }
    return acc;
  }, []),
});

const toRouteFeature = (route) =>
  route ? { type: 'Feature', properties: {}, geometry: route } : EMPTY;

// setData resolves a promise in v6; a source removed mid-flight (style swap,
// unmount) would otherwise surface as an unhandled rejection in the console.
const pushData = (map, id, data) => {
  const source = map?.getSource(id);
  if (!source) return;
  Promise.resolve(source.setData(data)).catch(() => {});
};

function MapCanvas({
  pins = [],
  route = null,
  stops = [],
  initialView = { latitude: 26.9124, longitude: 75.7873, zoom: 12 },
  onMoveEnd,
  onPinSelect,
  className = 'h-[60vh] w-full',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const originRef = useRef(null);
  const [failure, setFailure] = useState(null);

  const { isDark } = useTheme();
  const styleUrl = isDark ? STYLE_DARK : STYLE_LIGHT;
  const styleRef = useRef(styleUrl);

  const pinCollection = useMemo(() => toPinCollection(pins), [pins]);
  const routeFeature = useMemo(() => toRouteFeature(route), [route]);

  /*
   * Everything the map's own listeners need lives behind a ref. Parent pages
   * pass inline object and arrow literals, so a dependency array would tear the
   * WebGL context down and rebuild it on every keystroke in a filter input.
   * This effect is declared first, so on mount it runs before the one below.
   */
  const latest = useRef({});
  useEffect(() => {
    latest.current = { pinCollection, routeFeature, onMoveEnd, onPinSelect };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    /*
     * attributionControl is deliberately left at its default: MapLibre then
     * renders a responsive OSM/OpenFreeMap credit, expanded where it fits and
     * collapsed under 640px. ODbL requires that credit to stay visible.
     */
    const map = new MapLibreMap({
      container,
      style: styleRef.current,
      center: [Number(initialView.longitude), Number(initialView.latitude)],
      zoom: Number(initialView.zoom) || 12,
      // Tour maps are read top-down. Dropping rotation also removes the
      // two-finger drag ambiguity that makes phone panning feel sticky.
      dragRotate: false,
      // Tiles here are static city geometry, not live data. Not re-fetching on
      // Cache-Control expiry saves a round of requests on a long session.
      refreshExpiredTiles: false,
    });
    mapRef.current = map;
    originRef.current = [Number(initialView.longitude), Number(initialView.latitude)];

    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    /*
     * Sources and layers are re-added on `styledata`, not just once on `load`:
     * `setStyle()` (the dark-mode switch) throws the old style away entirely,
     * and everything we added with it. The getLayer/getSource guards make this
     * idempotent, which matters because styledata fires several times per style.
     */
    const install = () => {
      if (!map.isStyleLoaded()) return;
      if (!map.getSource('pins')) {
        map.addSource('pins', { type: 'geojson', data: latest.current.pinCollection ?? EMPTY });
      }
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: latest.current.routeFeature ?? EMPTY });
      }
      for (const layer of LAYERS) {
        if (!map.getLayer(layer.id)) map.addLayer(layer);
      }
    };

    const emitBounds = () => {
      const b = map.getBounds();
      latest.current.onMoveEnd?.({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };

    const handleLoad = () => {
      install();
      // `moveend` never fires for the initial camera, so a parent that only
      // fetches pins for the visible box would sit empty until the first pan.
      emitBounds();
    };

    const closePopup = () => {
      popupRef.current?.remove();
    };

    const handleClick = (event) => {
      // One general click listener rather than a per-layer one: a pin sitting
      // in both the glow and the core would otherwise fire the callback twice.
      const live = PIN_LAYERS.filter((id) => map.getLayer(id));
      if (!live.length) return;
      const hit = map.queryRenderedFeatures(event.point, { layers: live })[0];
      if (!hit) {
        closePopup();
        return;
      }

      const [lng, lat] = hit.geometry.coordinates;
      // Anchor to the pin, not to the click point — the glow is up to 30px
      // wide, and Personal Tour Mode routes to exactly these numbers.
      const picked = { ...hit.properties, lng, lat };

      const body = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'text-sm font-semibold';
      // textContent, not innerHTML: attraction names are user-facing data.
      title.textContent = picked.name ?? 'Attraction';
      const sub = document.createElement('p');
      sub.className = 'text-xs capitalize text-ink-700';
      sub.textContent = String(picked.category ?? '').toLowerCase().replace(/_/g, ' ');
      body.append(title, sub);

      if (!popupRef.current) {
        popupRef.current = new Popup({
          closeButton: true,
          closeOnClick: false,
          maxWidth: '220px',
          offset: 12,
        });
      }
      popupRef.current.setLngLat([lng, lat]).setDOMContent(body).addTo(map);

      latest.current.onPinSelect?.(picked);
    };

    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const resetPointer = () => {
      map.getCanvas().style.cursor = '';
    };

    const handleError = (event) => {
      // A single 404'd tile is not worth an overlay; a style that never loaded
      // is, otherwise the user just sees an empty grey box.
      if (map.isStyleLoaded()) return;

      // One retry on the light style first. A bad VITE_MAP_STYLE, or a dark
      // style the tile host has since renamed, should degrade to "light
      // basemap under a dark UI" rather than to nothing at all.
      if (styleRef.current !== STYLE_LIGHT) {
        styleRef.current = STYLE_LIGHT;
        map.setStyle(STYLE_LIGHT);
        return;
      }
      setFailure(event?.error?.message ?? 'Could not reach the map tiles.');
    };

    map.on('load', handleLoad);
    map.on('styledata', install);
    map.on('moveend', emitBounds);
    map.on('click', handleClick);
    map.on('mouseenter', PIN_LAYERS, pointer);
    map.on('mouseleave', PIN_LAYERS, resetPointer);
    map.on('error', handleError);

    // MapLibre only listens for *window* resize. This container is `h-[55vh]
    // md:h-[65vh]` and also mounts inside a tab panel, so both the breakpoint
    // flip and the tab switch need an explicit resize or the canvas stays
    // stretched at its old size.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      // StrictMode mounts effects twice in dev; without remove() the first
      // map leaks a live WebGL context and the browser starts dropping them.
      map.remove();
      mapRef.current = null;
    };
    // Deliberately mount-only. initialView is a starting camera, and every
    // callback is read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRef.current === styleUrl) return;
    styleRef.current = styleUrl;
    setFailure(null);
    // `styledata` re-runs install(), which re-adds the sources and layers.
    map.setStyle(styleUrl);
  }, [styleUrl]);

  useEffect(() => {
    pushData(mapRef.current, 'pins', pinCollection);
  }, [pinCollection]);

  useEffect(() => {
    pushData(mapRef.current, 'route', routeFeature);
  }, [routeFeature]);

  /*
   * Follow a genuinely new origin — "use my location" resolving, or a different
   * tour being opened. Compared by value because parents pass an inline object
   * literal, so identity changes on every render and would otherwise yank the
   * camera back from wherever the traveller has panned to.
   */
  const { latitude, longitude, zoom } = initialView;
  useEffect(() => {
    const map = mapRef.current;
    const lng = Number(longitude);
    const lat = Number(latitude);
    if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const previous = originRef.current;
    if (previous && Math.abs(previous[0] - lng) < 1e-4 && Math.abs(previous[1] - lat) < 1e-4) {
      return;
    }
    originRef.current = [lng, lat];
    map.easeTo({ center: [lng, lat], zoom: Number(zoom) || map.getZoom(), duration: 600 });
  }, [latitude, longitude, zoom]);

  /*
   * A day's itinerary is a handful of stops, so DOM markers are fine here — and
   * they give us free numbering without a symbol layer or a sprite sheet.
   *
   * Keyed on the coordinates rather than the array: `stops` defaults to a fresh
   * `[]` and arrives from an inline expression, so its identity changes on every
   * render and the markers would be destroyed and rebuilt each time.
   */
  const stopPositions = useMemo(
    () => stops.map(coords).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stops.map((s) => `${s?.lng},${s?.lat}`).join('|')]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const markers = stopPositions.map((position, i) => {
      const el = document.createElement('span');
      el.className =
        'grid h-7 w-7 place-items-center rounded-full bg-ink-800 text-xs font-bold text-white shadow-lg';
      el.textContent = String(i + 1);
      return new Marker({ element: el }).setLngLat(position).addTo(map);
    });

    return () => markers.forEach((m) => m.remove());
  }, [stopPositions]);

  return (
    <div className={`${className} relative overflow-hidden rounded-2xl bg-sand-100 dark:bg-ink-900`}>
      {/* Absolute fill: the height comes from `className` on the parent, and a
          map container with no measured height renders nothing at all. */}
      <div ref={containerRef} className="absolute inset-0" />

      {failure && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-sm text-ink-700 dark:text-sand-200">
            {failure} Check your connection, or point{' '}
            <code className="font-mono">VITE_MAP_STYLE</code> at another style.
          </p>
        </div>
      )}
    </div>
  );
}

// Parent pages re-render on every keystroke in their filter inputs; the map
// should not follow them down.
export default memo(MapCanvas);
