import { memo, useEffect, useMemo, useRef } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { useTheme } from '../context/ThemeContext.jsx';
import { useGoogleMap } from '../hooks/useGoogleMap.js';
import { mapsErrorMessage } from '../lib/googleMaps.js';
import {
  createClusterContent,
  createDraftContent,
  createPinContent,
  createStopContent,
  createUserContent,
  setPinSelected,
  setStopSelected,
  styleFor,
} from '../lib/mapMarkers.js';

/*
 * The one place Google Maps is touched for display maps (Explore, tour itinerary,
 * admin pin manager).
 *
 * Marker strategy, because "map must not freeze the UI" is a standing requirement:
 *  - Attraction pins are AdvancedMarkerElements built from plain DOM nodes and fed to
 *    a MarkerClusterer, so a dense city collapses into a few cluster bubbles instead
 *    of hundreds of live DOM markers. Updates are diffed by id — only added or
 *    removed pins are touched — and selection only restyles the two affected nodes.
 *  - Numbered itinerary stops (a handful per tour) are plain AdvancedMarkers.
 *  - The map is created once. Props are read through `latest`, so inline callbacks
 *    from parents never rebuild it. (A light/dark switch does, by necessity:
 *    Google's colorScheme is fixed at construction. See useGoogleMap.)
 *  - Exactly one InfoWindow exists, reused across selections.
 *  - Bounds are read on `idle` (after a gesture settles), never per frame.
 *  - Route geometry arrives already simplified from OSRM / Google Routes.
 *
 * Props, in groups: the original ones used by TourDetail/Admin (pins, route, stops,
 * initialView, onMoveEnd, onPinSelect, selectedStop, onStopSelect, fitToStops,
 * className) are unchanged. Explore adds selectedId, userLocation, discovery,
 * focus, fitRoute, routeColor, popup=false and gestureHandling. The admin console
 * adds onMapClick, draft and onDraftChange.
 */

const coords = (item) => {
  const lng = Number(item?.lng);
  const lat = Number(item?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lat, lng } : null;
};

const lineToPath = (geometry) =>
  (geometry?.coordinates ?? [])
    .map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const latLngOf = (position) => ({
  lat: typeof position.lat === 'function' ? position.lat() : position.lat,
  lng: typeof position.lng === 'function' ? position.lng() : position.lng,
});

function MapCanvas({
  pins = [],
  route = null,
  stops = [],
  initialView = { latitude: 26.9124, longitude: 75.7873, zoom: 12 },
  onMoveEnd,
  onPinSelect,
  selectedStop = null,
  onStopSelect,
  fitToStops = false,
  className = 'h-[60vh] w-full',
  // --- Explore -------------------------------------------------------------
  selectedId = null,
  userLocation = null, // { lat, lng, accuracy } — a real GPS fix only, never a fallback
  discovery = null, // { lat, lng, radius } — ring showing the search area
  focus = null, // { lat, lng, zoom?, fitRadius?, padding?, token } — move the camera
  fitRoute = false,
  routeColor = null,
  popup = true,
  gestureHandling = 'auto',
  // --- Admin pin manager ---------------------------------------------------
  onMapClick,
  draft = null, // { lat, lng } — a draggable marker
  onDraftChange,
}) {
  const containerRef = useRef(null);
  const { isDark } = useTheme();
  const { map, g, error } = useGoogleMap(containerRef, {
    initialView,
    isDark,
    options: { gestureHandling },
  });

  // Everything long-lived listeners need sits behind a ref (see header comment).
  const latest = useRef({});
  latest.current = {
    onMoveEnd,
    onPinSelect,
    onStopSelect,
    onMapClick,
    onDraftChange,
    selectedStop,
    selectedId,
    popup,
    stopItems: null,
  };

  const pinStore = useRef({ clusterer: null, markers: new Map(), info: null });

  /* ---------------------------------------------------------- bounds + clicks */
  useEffect(() => {
    if (!map) return undefined;

    const emitBounds = () => {
      const b = map.getBounds();
      if (!b) return;
      const { north, south, east, west } = b.toJSON();
      latest.current.onMoveEnd?.({ west, south, east, north });
    };
    // `idle` also fires once after the first render, which is what a parent that
    // fetches pins for the visible box needs — moveend never fires for the initial camera.
    const idle = map.addListener('idle', emitBounds);
    const click = map.addListener('click', (event) => {
      pinStore.current.info?.close();
      if (event.latLng) latest.current.onMapClick?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });

    return () => {
      idle.remove();
      click.remove();
    };
  }, [map]);

  /* ------------------------------------------------------------------- pins */
  // Clusterer + InfoWindow live as long as the map instance does.
  useEffect(() => {
    if (!map || !g) return undefined;
    const store = pinStore.current;
    store.info = new g.InfoWindow({ maxWidth: 240 });
    store.clusterer = new MarkerClusterer({
      map,
      markers: [],
      renderer: {
        render: ({ count, position }) =>
          new g.AdvancedMarkerElement({ position, content: createClusterContent(count), zIndex: 1000 + count }),
      },
    });

    return () => {
      store.info?.close();
      store.info = null;
      store.clusterer?.clearMarkers();
      store.clusterer?.setMap(null);
      store.clusterer = null;
      store.markers.forEach((entry) => {
        entry.marker.map = null;
      });
      store.markers.clear();
    };
  }, [map, g]);

  useEffect(() => {
    const store = pinStore.current;
    if (!map || !g || !store.clusterer) return;

    const next = new Map();
    for (const pin of pins) {
      const position = coords(pin);
      if (position && pin.id != null) next.set(String(pin.id), { pin, position });
    }

    const removed = [];
    store.markers.forEach((entry, id) => {
      const incoming = next.get(id);
      const rebuilt = incoming && (incoming.pin.kind ?? incoming.pin.category) !== (entry.pin.kind ?? entry.pin.category);
      if (!incoming || rebuilt) {
        removed.push(entry.marker);
        store.markers.delete(id);
      }
    });
    if (removed.length) store.clusterer.removeMarkers(removed, true);

    const added = [];
    next.forEach(({ pin, position }, id) => {
      const existing = store.markers.get(id);
      if (existing) {
        existing.pin = pin; // keep click payload fresh (distance, rating, ...)
        const p = existing.marker.position && latLngOf(existing.marker.position);
        if (!p || p.lat !== position.lat || p.lng !== position.lng) existing.marker.position = position;
        return;
      }

      const content = createPinContent(pin);
      const marker = new g.AdvancedMarkerElement({
        position,
        content,
        title: `${pin.name ?? 'Place'} — ${styleFor(pin).label}`,
        gmpClickable: true,
        zIndex: 1,
      });
      const entry = { marker, pin, content };
      marker.addEventListener('gmp-click', () => {
        const picked = { ...entry.pin, lat: position.lat, lng: position.lng };
        if (latest.current.popup && store.info) {
          const body = document.createElement('div');
          const title = document.createElement('p');
          title.style.cssText = 'margin:0;font:600 14px system-ui;color:#12141f';
          title.textContent = picked.name ?? 'Attraction';
          const sub = document.createElement('p');
          sub.style.cssText = 'margin:2px 0 0;font:12px system-ui;color:#4b5478;text-transform:capitalize';
          sub.textContent = styleFor(picked).label;
          body.append(title, sub);
          store.info.setContent(body);
          store.info.open({ map, anchor: marker });
        }
        latest.current.onPinSelect?.(picked);
      });
      store.markers.set(id, entry);
      added.push(marker);
    });
    if (added.length) store.clusterer.addMarkers(added, true);
    store.clusterer.render();

    // Newly created pins pick up the current selection straight away.
    store.markers.forEach((entry, id) => setPinSelected(entry.content, id === String(latest.current.selectedId)));
  }, [map, g, pins]);

  // Selection only restyles; it never rebuilds a marker.
  useEffect(() => {
    pinStore.current.markers.forEach((entry, id) => {
      const on = selectedId != null && id === String(selectedId);
      setPinSelected(entry.content, on);
      entry.marker.zIndex = on ? 999 : 1;
    });
  }, [selectedId, map]);

  /* ------------------------------------------------------------------ route */
  useEffect(() => {
    if (!map || !g) return undefined;
    const path = lineToPath(route);
    if (path.length < 2) return undefined;

    const main = routeColor ?? (isDark ? '#8ea2ff' : '#3b5bdb');
    const casing = new g.Polyline({
      map,
      path,
      strokeColor: isDark ? '#12141f' : '#ffffff',
      strokeOpacity: 0.95,
      strokeWeight: 9,
      zIndex: 10,
      clickable: false,
      geodesic: false,
    });
    const line = new g.Polyline({
      map,
      path,
      strokeColor: main,
      strokeOpacity: 1,
      strokeWeight: 5,
      zIndex: 11,
      clickable: false,
    });

    if (fitRoute) {
      const bounds = new g.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, { top: 90, bottom: 90, left: 60, right: 60 });
    }

    return () => {
      casing.setMap(null);
      line.setMap(null);
    };
  }, [map, g, route, isDark, routeColor, fitRoute]);

  /* ------------------------------------------------------- numbered stops */
  const stopsKey = stops.map((s) => `${s?.lng},${s?.lat},${s?.name ?? ''}`).join('|');
  const stopItems = useMemo(
    () => stops.map((s) => ({ position: coords(s), name: s?.name ?? '' })).filter((item) => item.position),
    // `stops` arrives as a fresh array each render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopsKey]
  );
  latest.current.stopItems = stopItems;

  const stopMarkers = useRef([]);
  const fitted = useRef('');

  useEffect(() => {
    if (!map || !g) return undefined;

    const markers = stopItems.map((item, i) => {
      const content = createStopContent(i + 1, item.name);
      setStopSelected(content, latest.current.selectedStop === i);
      const marker = new g.AdvancedMarkerElement({
        map,
        position: item.position,
        content,
        title: `Stop ${i + 1}${item.name ? `: ${item.name}` : ''}`,
        gmpClickable: true,
        zIndex: 500 + i,
      });
      marker.addEventListener('gmp-click', () => latest.current.onStopSelect?.(i));
      return { marker, content };
    });
    stopMarkers.current = markers;

    // Frame every stop once per distinct set of stops.
    if (fitToStops && stopItems.length > 1 && fitted.current !== stopsKey) {
      fitted.current = stopsKey;
      const bounds = new g.LatLngBounds();
      stopItems.forEach((item) => bounds.extend(item.position));
      map.fitBounds(bounds, { top: 70, bottom: 70, left: 50, right: 50 });
      // fitBounds can zoom in tightly for two nearby stops; keep some context.
      const once = map.addListener('idle', () => {
        once.remove();
        if ((map.getZoom() ?? 0) > 14) map.setZoom(14);
      });
    }

    return () => {
      markers.forEach(({ marker }) => {
        marker.map = null;
      });
      stopMarkers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, g, stopItems]);

  useEffect(() => {
    stopMarkers.current.forEach(({ content, marker }, i) => {
      setStopSelected(content, i === selectedStop);
      marker.zIndex = i === selectedStop ? 900 : 500 + i;
    });
    const item = selectedStop == null ? null : latest.current.stopItems?.[selectedStop];
    if (!map || !item) return;
    if (reducedMotion()) map.moveCamera({ center: item.position, zoom: Math.max(map.getZoom() ?? 0, 13.5) });
    else {
      map.panTo(item.position);
      if ((map.getZoom() ?? 0) < 13.5) map.setZoom(13.5);
    }
  }, [selectedStop, map]);

  /* ------------------------------------------------ current location (GPS) */
  const userStore = useRef({ marker: null, circle: null });
  const userLat = userLocation?.lat;
  const userLng = userLocation?.lng;
  const userAcc = userLocation?.accuracy;

  useEffect(() => {
    const store = userStore.current;
    if (!map || !g || !Number.isFinite(userLat) || !Number.isFinite(userLng)) return undefined;
    const position = { lat: userLat, lng: userLng };

    if (!store.marker) {
      store.marker = new g.AdvancedMarkerElement({
        map,
        position,
        content: createUserContent(),
        title: 'Your current location',
        zIndex: 2000,
      });
    } else store.marker.position = position;

    // Accuracy ring only when it is meaningful: a 20 km "accuracy" is not a position.
    const radius = Number.isFinite(userAcc) && userAcc >= 15 && userAcc <= 3000 ? userAcc : 0;
    if (radius) {
      if (!store.circle) {
        store.circle = new g.Circle({
          map,
          center: position,
          radius,
          strokeColor: '#4285f4',
          strokeOpacity: 0.35,
          strokeWeight: 1,
          fillColor: '#4285f4',
          fillOpacity: 0.1,
          clickable: false,
          zIndex: 5,
        });
      } else {
        store.circle.setCenter(position);
        store.circle.setRadius(radius);
      }
    } else if (store.circle) {
      store.circle.setMap(null);
      store.circle = null;
    }
    return undefined;
  }, [map, g, userLat, userLng, userAcc]);

  // Removed when the fix goes away, or when the map instance changes.
  useEffect(() => {
    const store = userStore.current;
    return () => {
      if (store.marker) store.marker.map = null;
      store.circle?.setMap(null);
      store.marker = null;
      store.circle = null;
    };
  }, [map, userLat == null || userLng == null]);

  /* ---------------------------------------------- discovery radius ring */
  const dLat = discovery?.lat;
  const dLng = discovery?.lng;
  const dRadius = discovery?.radius;
  useEffect(() => {
    if (!map || !g || !Number.isFinite(dLat) || !Number.isFinite(dLng) || !dRadius) return undefined;
    const ring = new g.Circle({
      map,
      center: { lat: dLat, lng: dLng },
      radius: dRadius,
      strokeColor: '#ff7a45',
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: '#ff7a45',
      fillOpacity: 0.05,
      clickable: false,
      zIndex: 4,
    });
    return () => ring.setMap(null);
  }, [map, g, dLat, dLng, dRadius]);

  /* ---------------------------------------------------------- camera moves */
  useEffect(() => {
    if (!map || !g || !focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) return;
    if (focus.fitRadius) {
      // ~1° latitude = 111.32 km; longitude shrinks with cos(latitude).
      const dLatDeg = focus.fitRadius / 111_320;
      const dLngDeg = focus.fitRadius / (111_320 * Math.max(0.2, Math.cos((focus.lat * Math.PI) / 180)));
      const bounds = new g.LatLngBounds(
        { lat: focus.lat - dLatDeg, lng: focus.lng - dLngDeg },
        { lat: focus.lat + dLatDeg, lng: focus.lng + dLngDeg }
      );
      map.fitBounds(bounds, focus.padding ?? 48);
    } else if (reducedMotion()) {
      map.moveCamera({ center: { lat: focus.lat, lng: focus.lng }, zoom: focus.zoom ?? map.getZoom() });
    } else {
      map.panTo({ lat: focus.lat, lng: focus.lng });
      if (focus.zoom) map.setZoom(focus.zoom);
    }
    // Only a new token moves the camera; the other fields are its payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, g, focus?.token]);

  /*
   * Follow a genuinely new starting point — a different tour being opened. Compared
   * by value because parents pass an inline object literal whose identity changes
   * every render and would otherwise yank the camera back from wherever the
   * traveller has panned to.
   */
  const originRef = useRef(null);
  const { latitude, longitude, zoom } = initialView;
  useEffect(() => {
    const lng = Number(longitude);
    const lat = Number(latitude);
    if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const previous = originRef.current;
    originRef.current = [lng, lat];
    if (!previous) return; // first value is the camera the map was built with
    if (Math.abs(previous[0] - lng) < 1e-4 && Math.abs(previous[1] - lat) < 1e-4) return;
    map.panTo({ lat, lng });
    if (zoom) map.setZoom(Number(zoom));
  }, [map, latitude, longitude, zoom]);

  /* ------------------------------------------------------ admin draft pin */
  const draftRef = useRef(null);
  const draftLat = draft?.lat;
  const draftLng = draft?.lng;
  useEffect(() => {
    if (!map || !g) return;
    if (!Number.isFinite(draftLat) || !Number.isFinite(draftLng)) {
      if (draftRef.current) {
        draftRef.current.map = null;
        draftRef.current = null;
      }
      return;
    }
    const position = { lat: draftLat, lng: draftLng };
    if (!draftRef.current) {
      const marker = new g.AdvancedMarkerElement({
        map,
        position,
        content: createDraftContent(),
        title: 'New pin — drag to adjust',
        gmpDraggable: true,
        zIndex: 3000,
      });
      marker.addListener('dragend', () => {
        if (marker.position) latest.current.onDraftChange?.(latLngOf(marker.position));
      });
      draftRef.current = marker;
    } else {
      draftRef.current.position = position;
    }
  }, [map, g, draftLat, draftLng]);

  useEffect(
    () => () => {
      if (draftRef.current) draftRef.current.map = null;
      draftRef.current = null;
    },
    [map]
  );

  return (
    <div className={`${className} relative overflow-hidden rounded-2xl bg-sand-100 dark:bg-ink-900`}>
      {/* Absolute fill: the height comes from `className` on the parent, and a map
          container with no measured height renders nothing at all. Google watches
          the container's size itself, so tab switches and breakpoint flips resize
          the map without an explicit observer. */}
      <div ref={containerRef} className="absolute inset-0" />

      {!map && !error && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-sand-100 dark:bg-ink-800" aria-hidden />
      )}

      {error && (
        <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-sm text-ink-700 dark:text-sand-200">{mapsErrorMessage(error)}</p>
        </div>
      )}
    </div>
  );
}

// Parent pages re-render on every keystroke in their filter inputs; the map should
// not follow them down.
export default memo(MapCanvas);
