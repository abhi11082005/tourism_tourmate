import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MAP_ID, onMapsAuthFailure } from '../lib/googleMaps.js';

/*
 * Creates one Google map inside `containerRef` and hands back the instance.
 *
 * Lifecycle rules, because "no map recreation on every render" is a hard requirement:
 *  - The map is built once per (mount, colour scheme). `options` is read through a
 *    ref and deliberately NOT a dependency: callers pass inline objects.
 *  - Google's `colorScheme` can only be set when a map is constructed, so a light/dark
 *    switch is the one legitimate reason to build a new map. The camera is carried
 *    across, and consumers re-attach their overlays because `map` changes identity.
 *  - There is no map.remove() in Google Maps. Teardown = drop every listener on the
 *    instance and empty the container. Overlays owned by consumers are removed by
 *    their own effect cleanups, which run before ours.
 */
export function useGoogleMap(containerRef, { initialView, isDark, options }) {
  const [state, setState] = useState({ map: null, g: null, error: null });
  const camera = useRef(null);
  const optionsRef = useRef(options);
  const viewRef = useRef(initialView);
  optionsRef.current = options;
  viewRef.current = initialView;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let created = null;
    let googleNs = null;

    const unsubscribe = onMapsAuthFailure((error) => {
      if (!cancelled) setState((s) => ({ ...s, error }));
    });

    loadGoogleMaps()
      .then((g) => {
        if (cancelled) return;
        googleNs = g;
        const start = camera.current ?? {
          center: { lat: Number(viewRef.current?.latitude) || 0, lng: Number(viewRef.current?.longitude) || 0 },
          zoom: Number(viewRef.current?.zoom) || 12,
        };

        container.replaceChildren(); // a previous (other-theme) map's DOM
        const map = new g.Map(container, {
          mapId: MAP_ID,
          colorScheme: isDark ? g.ColorScheme.DARK : g.ColorScheme.LIGHT,
          center: start.center,
          zoom: start.zoom,
          // Our own pins carry the interaction; Google's POI bubbles would fight them.
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          rotateControl: false,
          isFractionalZoomEnabled: true,
          ...optionsRef.current,
        });
        created = map;

        // Remember the camera so a theme switch does not throw the user's place away.
        map.addListener('idle', () => {
          const c = map.getCenter();
          const z = map.getZoom();
          if (c && z != null) camera.current = { center: c.toJSON(), zoom: z };
        });

        setState({ map, g, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ map: null, g: null, error });
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (created && googleNs) {
        // Free the map's own listeners. Consumers' effect cleanups ran first.
        window.google?.maps?.event?.clearInstanceListeners(created);
      }
      setState((s) => (s.map === created ? { map: null, g: s.g, error: s.error } : s));
    };
  }, [containerRef, isDark]);

  return state;
}
