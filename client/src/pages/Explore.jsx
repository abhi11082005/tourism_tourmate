import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Compass, Route as RouteIcon, Search, Timer, Undo2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { km, minutes, shortDate } from '../lib/format.js';
import {
  CHIPS,
  DEFAULT_RADIUS,
  RADII,
  curatedToPlace,
  googleToPlace,
  radiusLabel,
  resolveSelection,
  round,
  straightMeters,
} from '../lib/discovery.js';
import { LocationControl, LocationNotice, LocationToast } from '../components/explore/LocationControl.jsx';
import NavigationCard from '../components/explore/NavigationCard.jsx';
import PlaceCard, { PlaceCardSkeleton } from '../components/explore/PlaceCard.jsx';
import PlaceDetail from '../components/explore/PlaceDetail.jsx';
import PlacePreview from '../components/explore/PlacePreview.jsx';

// The Google Maps JS loader and clusterer stay out of the main bundle: they download
// only when this page (or the tour map / admin pin manager) actually mounts a map.
const MapCanvas = lazy(() => import('../components/MapCanvas.jsx'));

/*
 * Explore — a travel discovery map.
 *
 *  - Curated TourMate attractions come from our own PostGIS API (/attractions/nearby
 *    for the list, /attractions/pins for whatever is in the viewport).
 *  - External discoveries come from Google Places API (New) through our server
 *    (/places/nearby). They are only fetched once the visitor has opted in: by
 *    sharing their location, exploring around a place, or asking for them. They are
 *    never stored, and are always badged "Google Places" so they cannot be mistaken
 *    for a TourMate pick.
 *  - Two distances, never mixed: "450 m away" is a straight line (PostGIS or
 *    great-circle); "650 m · 9 min walk" exists only after Google Routes computed it.
 *  - Personal Tour Mode (mood routes over OSRM + PostGIS waypoints) and Guided Tour
 *    Mode are unchanged and live below the map. The Google road route is a separate,
 *    explicit "Directions" action; it never replaces a tour route's data, it is only
 *    drawn in its place until reset.
 */

const MOODS = [
  ['scenic', 'Scenic', 'Prettiest way round'],
  ['quiet', 'Quiet', 'Away from traffic'],
  ['food', 'Food', 'Past the good stuff'],
  ['fastest', 'Fastest', 'Straight there'],
];

const PROFILES = [
  ['foot', 'Walk'],
  ['bike', 'Cycle'],
  ['car', 'Drive'],
];

const MATRIX_BATCH = 10; // Route Matrix elements are billed each; keep the batch small.
const MAX_LIST = 60;

const isNotConfigured = (err) => err?.code === 'GOOGLE_NOT_CONFIGURED';

function ChipButton({ active, onClick, children, color }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`chip min-h-9 shrink-0 gap-1.5 text-xs ${
        active ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''
      }`}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

export default function Explore() {
  const geo = useGeolocation();
  const { isGuest } = useAuth();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // --- discovery state -----------------------------------------------------
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [chips, setChips] = useState([]); // selected chip ids; empty = everything
  const [anchor, setAnchor] = useState(null); // a place we are exploring around, or null = me
  const [selected, setSelected] = useState(null);
  const [detailPlace, setDetailPlace] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [focus, setFocus] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile bottom sheet
  const [optedIn, setOptedIn] = useState(false); // asked for external places at an approximate centre
  const [matrixWanted, setMatrixWanted] = useState(null);

  // --- search ----------------------------------------------------------------
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // --- navigation (Google Routes) -------------------------------------------
  const [navDest, setNavDest] = useState(null);
  const [navMode, setNavMode] = useState('walk');

  // --- tour modes (OSRM) -------------------------------------------------------
  const [mood, setMood] = useState('scenic');
  const [profile, setProfile] = useState('foot');
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [slotId, setSlotId] = useState('');

  const moveCamera = useCallback((to) => setFocus((prev) => ({ ...to, token: (prev?.token ?? 0) + 1 })), []);

  /*
   * The discovery centre. A real GPS fix, or a place the traveller chose to explore
   * around, are both "exact". Anything else is the fallback hierarchy (last known →
   * home city → Jaipur) and is labelled approximate everywhere it is shown.
   */
  const center = useMemo(() => {
    if (anchor) return { lat: anchor.lat, lng: anchor.lng, kind: 'place', label: anchor.name, approximate: false };
    if (geo.isPrecise) return { lat: geo.coords.lat, lng: geo.coords.lng, kind: 'me', label: 'your location', approximate: false };
    return { lat: geo.coords.lat, lng: geo.coords.lng, kind: 'fallback', label: geo.fallbackLabel, approximate: true };
  }, [anchor, geo.isPrecise, geo.coords.lat, geo.coords.lng, geo.fallbackLabel]);

  // Rounded to ~110 m so GPS jitter never becomes a new query key (or a new Google call).
  const cLat = round(center.lat);
  const cLng = round(center.lng);

  const googleEnabled = optedIn || geo.isPrecise || Boolean(anchor);
  const { groups, curated: curatedFilter, truncated } = useMemo(() => resolveSelection(chips), [chips]);

  /* ---------------------------------------------------------------- queries */

  const curatedQuery = useQuery({
    queryKey: ['explore', 'curated', cLat, cLng, radius],
    queryFn: ({ signal }) => api.nearby({ lat: cLat, lng: cLng, radius, limit: 100 }, signal),
    staleTime: 5 * 60_000,
  });

  const googleQuery = useQuery({
    queryKey: ['explore', 'google', cLat, cLng, radius, groups.join(',')],
    queryFn: ({ signal }) => api.placesNearby({ lat: cLat, lng: cLng, radius, groups }, signal),
    enabled: googleEnabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: (count, err) => !isNotConfigured(err) && (err?.status ?? 500) >= 500 && count < 1,
  });

  // Viewport pins: waits for the pan to settle, and a one-pixel nudge is not a new key.
  const settled = useDebouncedValue(bounds, 500);
  const box = useMemo(
    () =>
      settled
        ? { west: round(settled.west), south: round(settled.south), east: round(settled.east), north: round(settled.north) }
        : null,
    [settled]
  );
  const boxValid = Boolean(box) && box.east > box.west && box.north > box.south;
  const pinsQuery = useQuery({
    queryKey: ['pins', box && Object.values(box).join(',')],
    queryFn: ({ signal }) => api.pins(box, signal),
    enabled: boxValid,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const searchQuery = useQuery({
    queryKey: ['explore', 'search', term.toLowerCase(), round(center.lat, 2), round(center.lng, 2)],
    queryFn: ({ signal }) => api.placesSearch({ q: term, lat: cLat, lng: cLng }, signal),
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });

  /* ----------------------------------------------------------------- places */

  const curatedNearby = useMemo(() => (curatedQuery.data?.items ?? []).map(curatedToPlace), [curatedQuery.data]);

  const viewportCurated = useMemo(
    () =>
      (pinsQuery.data?.features ?? []).map((f) =>
        curatedToPlace({
          id: f.properties.id,
          name: f.properties.name,
          category: f.properties.category,
          imageUrl: f.properties.imageUrl,
          visitMinutes: f.properties.visitMinutes,
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        })
      ),
    [pinsQuery.data]
  );

  const googlePlaces = useMemo(
    () => (googleEnabled ? (googleQuery.data?.items ?? []).map(googleToPlace) : []),
    [googleEnabled, googleQuery.data]
  );

  const allowed = useCallback((p) => !curatedFilter || curatedFilter.has(p.category), [curatedFilter]);

  // What the list shows: everything within the chosen radius, nearest first.
  const listPlaces = useMemo(() => {
    const curated = curatedNearby.filter(allowed);
    return [...curated, ...googlePlaces]
      .filter((p) => p.straightLineMeters != null)
      .sort((a, b) => a.straightLineMeters - b.straightLineMeters);
  }, [curatedNearby, googlePlaces, allowed]);

  // What the map shows: the list plus any curated pin in view (those carry no distance
  // from PostGIS, so a straight line to the centre is worked out here).
  const mapPlaces = useMemo(() => {
    const byId = new Map();
    for (const p of listPlaces) byId.set(p.id, p);
    for (const p of viewportCurated) {
      if (byId.has(p.id) || !allowed(p)) continue;
      byId.set(p.id, { ...p, straightLineMeters: straightMeters(center, p) });
    }
    return byId;
  }, [listPlaces, viewportCurated, allowed, center]);

  // The selected / anchor place stays on the map even when a filter would hide it.
  const mapPins = useMemo(() => {
    const out = [...mapPlaces.values()];
    for (const extra of [selected, anchor]) {
      if (extra && !mapPlaces.has(extra.id)) out.push(extra);
    }
    return out;
  }, [mapPlaces, selected, anchor]);

  const searchPlaces = useMemo(() => (searchQuery.data?.items ?? []).map(googleToPlace), [searchQuery.data]);
  const localMatches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (needle.length < 2) return [];
    return [...mapPlaces.values()].filter((p) => p.name?.toLowerCase().includes(needle)).slice(0, 5);
  }, [text, mapPlaces]);

  /* -------------------------------------------------------------- distances */

  const matrixPlaces = useMemo(() => listPlaces.slice(0, MATRIX_BATCH), [listPlaces]);
  const matrixKey = `${navMode}|${cLat},${cLng}|${matrixPlaces.map((p) => p.id).join(',')}`;
  const matrixQuery = useQuery({
    queryKey: ['explore', 'matrix', matrixKey],
    queryFn: ({ signal }) =>
      api.placesDistances(
        {
          origin: { lat: cLat, lng: cLng },
          destinations: matrixPlaces.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })),
          mode: navMode,
        },
        signal
      ),
    // Billed per element, so it runs only when the traveller asks for it.
    enabled: matrixWanted === matrixKey && matrixPlaces.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const navOrigin = useMemo(
    () => ({ lat: geo.coords.lat, lng: geo.coords.lng, approximate: !geo.isPrecise, label: geo.fallbackLabel }),
    [geo.coords.lat, geo.coords.lng, geo.isPrecise, geo.fallbackLabel]
  );

  const navRoute = useQuery({
    queryKey: [
      'explore',
      'route',
      navMode,
      round(navOrigin.lat, 4),
      round(navOrigin.lng, 4),
      navDest && round(navDest.lat, 5),
      navDest && round(navDest.lng, 5),
    ],
    queryFn: ({ signal }) =>
      api.googleRoute(
        { from: { lat: navOrigin.lat, lng: navOrigin.lng }, to: { lat: navDest.lat, lng: navDest.lng }, mode: navMode },
        signal
      ),
    enabled: Boolean(navDest),
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Real road distance + time per place id, for the current mode only.
  const travelById = useMemo(() => {
    const map = new Map();
    for (const item of matrixQuery.data?.items ?? []) {
      if (item.distanceMeters != null && item.durationSeconds != null) map.set(item.id, item);
    }
    if (navDest && navRoute.data?.provider === 'google' && navRoute.data.mode === navMode) {
      map.set(navDest.id, navRoute.data);
    }
    return map;
  }, [matrixQuery.data, navDest, navRoute.data, navMode]);

  /* ---------------------------------------------------------------- actions */

  const goToMyLocation = useCallback(async () => {
    const fix = geo.isPrecise ? geo.precise : await geo.request();
    if (!fix) return; // the reason is in geo.state and shown to the traveller
    setAnchor(null);
    moveCamera({ lat: fix.lat, lng: fix.lng, fitRadius: radius });
  }, [geo.isPrecise, geo.precise, geo.request, moveCamera, radius]);

  const refreshLocation = useCallback(async () => {
    const fix = await geo.request({ fresh: true, highAccuracy: true });
    if (fix && !anchor) moveCamera({ lat: fix.lat, lng: fix.lng, fitRadius: radius });
  }, [geo.request, anchor, moveCamera, radius]);

  const changeRadius = (next) => {
    setRadius(next);
    moveCamera({ lat: center.lat, lng: center.lng, fitRadius: next });
  };

  const toggleChip = (id) => setChips((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const selectPlace = useCallback(
    (place) => {
      setSelected(place);
      setSearchOpen(false);
      if (!isDesktop) setSheetOpen(false); // get the list out of the way of the map
      moveCamera({ lat: place.lat, lng: place.lng, zoom: 15 });
    },
    [isDesktop, moveCamera]
  );

  const exploreAround = useCallback(
    (place) => {
      setAnchor(place);
      setSelected(place);
      setDetailPlace(null);
      setSearchOpen(false);
      setMatrixWanted(null);
      moveCamera({ lat: place.lat, lng: place.lng, fitRadius: radius });
    },
    [moveCamera, radius]
  );

  const backToMe = useCallback(() => {
    setAnchor(null);
    setSelected(null);
    setMatrixWanted(null);
    moveCamera({ lat: geo.coords.lat, lng: geo.coords.lng, fitRadius: radius });
  }, [geo.coords.lat, geo.coords.lng, moveCamera, radius]);

  const startDirections = useCallback((place) => {
    setNavDest(place);
    setSelected(place);
    setDetailPlace(null);
  }, []);

  const resetNavigation = useCallback(() => {
    setNavDest(null);
  }, []);

  const placeIndex = mapPlaces;
  const onPinSelect = useCallback(
    (picked) => {
      const place = placeIndex.get(String(picked.id)) ?? null;
      if (place) {
        setSelected(place);
        setSearchOpen(false);
        if (!isDesktop) setSheetOpen(false);
      }
    },
    [placeIndex, isDesktop]
  );

  const submitSearch = (event) => {
    event.preventDefault();
    const next = text.trim();
    if (next.length < 2) return;
    setTerm(next);
    setSearchOpen(true);
  };

  const clearSearch = () => {
    setText('');
    setTerm('');
    setSearchOpen(false);
  };

  // A different fallback arriving after sign-in (last known position / home city)
  // moves the camera there — but never once a real fix or an anchor is in charge.
  const fallbackKey = `${geo.coords.lat},${geo.coords.lng}`;
  const firstFallback = useRef(true);
  useEffect(() => {
    if (firstFallback.current) {
      firstFallback.current = false;
      return;
    }
    if (!geo.isPrecise && !anchor) moveCamera({ lat: geo.coords.lat, lng: geo.coords.lng, fitRadius: radius });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackKey]);

  // The camera the map is built with. Held constant so props can never rebuild it.
  const [initialView] = useState(() => ({ latitude: geo.coords.lat, longitude: geo.coords.lng, zoom: 12.5 }));

  /* ------------------------------------------------------------------ routes */

  const buildRoute = useMutation({
    mutationFn: () =>
      api.route({
        from: { lat: geo.coords.lat, lng: geo.coords.lng },
        to: { lat: destination.lat, lng: destination.lng },
        mood,
        profile,
      }),
    onSuccess: setRoute,
  });

  // Guided Tour Mode only makes sense for a departure you are actually on, so the
  // departure list comes from the traveller's own confirmed bookings.
  const departures = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    enabled: !isGuest,
    staleTime: 60_000,
    select: (data) => (data?.items ?? []).filter((b) => b.status === 'CONFIRMED' && b.slotId),
  });

  const guided = useMutation({
    mutationFn: () => api.guidedRoute(slotId),
    onSuccess: (data) =>
      setRoute({
        geometry: data.geometry,
        // A guide's saved line has no waypoint list; an optimised trip does.
        waypoints: data.stops ?? [],
        distanceMeters: data.distanceMeters ?? null,
        durationSeconds: data.durationSeconds ?? null,
        source: data.source,
        guideName: data.guideName,
      }),
  });

  const showingNav = Boolean(navDest);
  const drawnRoute = showingNav ? (navRoute.data?.geometry ?? null) : (route?.geometry ?? null);
  const drawnStops = showingNav ? [] : (route?.waypoints ?? []);

  /* ------------------------------------------------------------------ status */

  const loadingList = curatedQuery.isPending || (googleEnabled && googleQuery.isPending);
  const googleOff = isNotConfigured(googleQuery.error) || isNotConfigured(searchQuery.error);
  const googleFailed = googleQuery.isError && !googleOff;
  const curatedCount = listPlaces.filter((p) => p.source === 'tourmate').length;
  const aroundLabel = anchor ? anchor.name : geo.isPrecise ? 'you' : `${geo.fallbackLabel} (approximate)`;
  const modeWord = { walk: 'walking', bicycle: 'cycling', drive: 'driving' }[navMode] ?? 'travel';

  /* ------------------------------------------------------------------- panel */

  const panel = (
    <div className="space-y-3 p-4" aria-label="Discovery panel">
      {isDesktop && (
        <div>
          <h2 className="text-lg font-black leading-tight tracking-tight">
            {anchor ? `Around ${anchor.name}` : geo.isPrecise ? 'Around you' : `Around ${geo.fallbackLabel}`}
          </h2>
          <p className="faint text-xs">
            {loadingList
              ? 'Looking around…'
              : `${listPlaces.length} place${listPlaces.length === 1 ? '' : 's'} within ${radiusLabel(radius)}${
                  curatedCount ? ` · ${curatedCount} TourMate pick${curatedCount === 1 ? '' : 's'}` : ''
                }`}
          </p>
        </div>
      )}

      {anchor ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-glow/10 px-3 py-2 text-xs">
          <span className="min-w-0 truncate">
            Exploring around <span className="font-bold">{anchor.name}</span>
          </span>
          <button type="button" className="btn-ghost min-h-9 shrink-0 px-3 text-xs" onClick={backToMe}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {geo.isPrecise ? 'Back to my location' : `Back to ${geo.fallbackLabel}`}
          </button>
        </div>
      ) : (
        <>
          <LocationNotice geo={geo} />
          {!geo.isPrecise && (
            <button type="button" className="btn-primary w-full" onClick={goToMyLocation} disabled={geo.state === 'locating'}>
              {geo.state === 'locating' ? 'Finding you…' : 'Use my location'}
            </button>
          )}
        </>
      )}

      <div role="group" aria-label="Search radius" className="flex gap-1.5">
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={radius === r}
            onClick={() => changeRadius(r)}
            className={`chip min-h-9 flex-1 justify-center px-2 text-xs ${
              radius === r ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''
            }`}
          >
            {radiusLabel(r)}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Categories" className="flex flex-wrap gap-1.5">
        <ChipButton active={chips.length === 0} onClick={() => setChips([])}>
          All
        </ChipButton>
        {CHIPS.map((c) => (
          <ChipButton key={c.id} active={chips.includes(c.id)} color={c.color} onClick={() => toggleChip(c.id)}>
            {c.label}
          </ChipButton>
        ))}
      </div>
      {truncated && <p className="faint text-[11px]">Showing the first {groups.length} kinds of place to keep results fast.</p>}

      {!googleEnabled && (
        <div className="rounded-xl border border-dashed border-sand-300 p-3 text-xs dark:border-ink-600">
          <p className="muted">
            Showing TourMate&apos;s curated picks. Share your location — or look around here — to also see nearby
            restaurants, cafes and attractions from Google Maps.
          </p>
          <button type="button" className="btn-ghost mt-2 min-h-9 w-full text-xs" onClick={() => setOptedIn(true)}>
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Discover near {geo.fallbackLabel}
          </button>
        </div>
      )}

      {googleOff && (
        <p className="notice-error" role="status">
          Google Places isn&apos;t configured on this server, so only TourMate picks are shown.
        </p>
      )}
      {googleFailed && (
        <p className="notice-error" role="alert">
          Couldn&apos;t load places from Google just now.{' '}
          <button type="button" className="font-semibold underline" onClick={() => googleQuery.refetch()}>
            Try again
          </button>
        </p>
      )}
      {googleQuery.data?.failedGroups?.length > 0 && (
        <p className="faint text-[11px]">Some categories couldn&apos;t be loaded; the rest are shown.</p>
      )}
      {curatedQuery.isError && (
        <p className="notice-error" role="alert">
          Couldn&apos;t load TourMate picks.{' '}
          <button type="button" className="font-semibold underline" onClick={() => curatedQuery.refetch()}>
            Try again
          </button>
        </p>
      )}

      {googleEnabled && !googleOff && matrixPlaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost min-h-9 text-xs"
            disabled={matrixQuery.isFetching}
            onClick={() => setMatrixWanted(matrixKey)}
          >
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {matrixQuery.isFetching ? 'Working it out…' : `Show ${modeWord} times for the nearest ${matrixPlaces.length}`}
          </button>
          {matrixWanted === matrixKey && matrixQuery.isSuccess && (
            <span className="faint text-[11px]">Road times from {aroundLabel}.</span>
          )}
          {matrixQuery.isError && <span className="text-[11px] text-red-700 dark:text-red-300">Couldn&apos;t get travel times.</span>}
        </div>
      )}

      <ul className="space-y-2" aria-busy={loadingList}>
        {loadingList && Array.from({ length: 4 }, (_, i) => <PlaceCardSkeleton key={i} />)}
        {!loadingList &&
          listPlaces.slice(0, MAX_LIST).map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              travel={travelById.get(place.id)}
              mode={navMode}
              selected={selected?.id === place.id}
              onSelect={selectPlace}
              onDetails={setDetailPlace}
              onDirections={startDirections}
            />
          ))}
      </ul>

      {!loadingList && listPlaces.length === 0 && !curatedQuery.isError && (
        <div className="rounded-2xl bg-sand-100 p-4 text-center text-sm dark:bg-ink-800">
          <p className="font-semibold">Nothing within {radiusLabel(radius)}</p>
          <p className="faint mt-1 text-xs">Try a wider radius or fewer category filters.</p>
          {radius < RADII[RADII.length - 1] && (
            <button
              type="button"
              className="btn-ghost mt-3 min-h-9 text-xs"
              onClick={() => changeRadius(RADII[RADII.indexOf(radius) + 1])}
            >
              Search {radiusLabel(RADII[RADII.indexOf(radius) + 1])}
            </button>
          )}
        </div>
      )}

      {googleEnabled && !googleOff && <p className="faint text-center text-[10px]">External places and photos from Google Maps.</p>}
    </div>
  );

  /* ------------------------------------------------------------------ render */

  const floatingBottom = isDesktop ? 'bottom-3' : 'bottom-[8.25rem]';
  const showFloating = isDesktop || !sheetOpen;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 space-y-4 p-3 md:p-8">
        <header>
          <h1 className="text-xl font-black">Explore</h1>
          <p className="muted text-sm">
            Famous sights, great food and local rides — around you, or around any place you pick.
          </p>
        </header>

        <div className="relative flex h-[calc(100dvh-19.5rem)] min-h-[30rem] overflow-hidden md:h-[calc(100dvh-13rem)] md:min-h-[34rem] rounded-3xl border border-sand-200 bg-white dark:border-ink-600 dark:bg-ink-900">
          {isDesktop && (
            <aside className="w-[26rem] shrink-0 overflow-y-auto border-r border-sand-200 dark:border-ink-600">{panel}</aside>
          )}

          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-0">
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-sand-100 dark:bg-ink-800" />}>
                <MapCanvas
                  className="h-full w-full"
                  pins={mapPins}
                  selectedId={selected?.id ?? null}
                  userLocation={geo.precise}
                  discovery={{ lat: center.lat, lng: center.lng, radius }}
                  focus={focus}
                  route={drawnRoute}
                  stops={drawnStops}
                  fitRoute={Boolean(drawnRoute)}
                  initialView={initialView}
                  onMoveEnd={setBounds}
                  onPinSelect={onPinSelect}
                  popup={false}
                  gestureHandling="greedy"
                />
              </Suspense>
            </div>

            {/* Floating controls. The wrapper ignores the pointer so the map stays draggable. */}
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="pointer-events-auto absolute left-3 right-16 top-3 max-w-md">
                <form onSubmit={submitSearch} role="search" className="relative">
                  <label htmlFor="explore-search" className="sr-only">
                    Search places
                  </label>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-500" aria-hidden />
                  <input
                    id="explore-search"
                    type="search"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setSearchOpen(false);
                    }}
                    placeholder="Search a place, e.g. Amber Fort"
                    autoComplete="off"
                    enterKeyHint="search"
                    className="field h-12 w-full rounded-full border-0 pl-10 pr-10 shadow-lg [&::-webkit-search-cancel-button]:appearance-none"
                  />
                  {text && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full hover:bg-sand-100 dark:hover:bg-ink-700"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </form>

                {searchOpen && text.trim().length >= 2 && (
                  <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-sand-200 bg-white p-1.5 shadow-xl dark:border-ink-600 dark:bg-ink-900">
                    {localMatches.length > 0 && (
                      <ul aria-label="Places on the map">
                        {localMatches.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => selectPlace(p)}
                              className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-sand-100 dark:hover:bg-ink-800"
                            >
                              <span className="text-sm font-semibold">{p.name}</span>
                              <span className="faint text-xs">{p.source === 'tourmate' ? 'TourMate pick' : 'Google Places'} · {p.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {term === text.trim() && term.length >= 2 ? (
                      searchQuery.isFetching ? (
                        <p className="faint animate-pulse px-3 py-2 text-xs">Searching…</p>
                      ) : searchQuery.isError ? (
                        <p className="px-3 py-2 text-xs text-red-700 dark:text-red-300">
                          {isNotConfigured(searchQuery.error)
                            ? 'Place search isn’t configured on this server.'
                            : 'Search failed. Try again.'}
                        </p>
                      ) : searchPlaces.length > 0 ? (
                        <ul aria-label="Search results from Google Places">
                          {searchPlaces.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => selectPlace(p)}
                                className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-sand-100 dark:hover:bg-ink-800"
                              >
                                <span className="text-sm font-semibold">{p.name}</span>
                                <span className="faint truncate text-xs">{p.address ?? 'Google Places'}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        localMatches.length === 0 && <p className="faint px-3 py-2 text-xs">No places found for “{term}”.</p>
                      )
                    ) : (
                      <p className="faint px-3 py-2 text-xs">Press Enter to search Google Places near here.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="pointer-events-auto absolute right-3 top-3">
                <LocationControl geo={geo} onUse={goToMyLocation} onRefresh={refreshLocation} />
              </div>

              <div className="pointer-events-auto absolute left-3 top-[4.75rem]">
                <LocationToast geo={geo} />
              </div>

              {showFloating && (navDest || selected) && (
                <div
                  className={`pointer-events-auto absolute left-3 ${floatingBottom} flex max-h-[62%] w-[min(22rem,calc(100%-1.5rem))] flex-col gap-2 overflow-y-auto`}
                >
                  {navDest && (
                    <NavigationCard
                      destination={navDest}
                      origin={navOrigin}
                      mode={navMode}
                      onMode={setNavMode}
                      route={navRoute.data}
                      pending={navRoute.isFetching}
                      error={navRoute.isError ? navRoute.error.message : null}
                      onReset={resetNavigation}
                      onUseLocation={goToMyLocation}
                    />
                  )}
                  {selected && selected.id !== navDest?.id && (
                    <PlacePreview
                      place={selected}
                      travel={travelById.get(selected.id)}
                      mode={navMode}
                      onClose={() => setSelected(null)}
                      onDetails={setDetailPlace}
                      onDirections={startDirections}
                      onExploreNearby={exploreAround}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Phone: the discovery panel is a bottom sheet over the map. */}
            {!isDesktop && (
              <div
                className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl border-t border-sand-200 bg-white shadow-2xl transition-[height] duration-300 dark:border-ink-600 dark:bg-ink-900 ${
                  sheetOpen ? 'h-[72%]' : 'h-[7.5rem]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSheetOpen((v) => !v)}
                  aria-expanded={sheetOpen}
                  className="flex w-full shrink-0 flex-col items-center gap-1 px-4 pb-2 pt-2 text-left"
                >
                  <span className="h-1 w-10 rounded-full bg-sand-300 dark:bg-ink-600" aria-hidden />
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black">
                        {anchor ? `Around ${anchor.name}` : geo.isPrecise ? 'Around you' : `Around ${geo.fallbackLabel}`}
                      </span>
                      <span className="faint block text-xs">
                        {loadingList ? 'Looking around…' : `${listPlaces.length} places within ${radiusLabel(radius)}`}
                      </span>
                    </span>
                    {sheetOpen ? <ChevronDown className="h-5 w-5 shrink-0" aria-hidden /> : <ChevronUp className="h-5 w-5 shrink-0" aria-hidden />}
                    <span className="sr-only">{sheetOpen ? 'Collapse results' : 'Expand results'}</span>
                  </span>
                </button>
                {sheetOpen ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
                ) : (
                  <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {CHIPS.slice(0, 3).map((c) => (
                      <ChipButton key={c.id} active={chips.includes(c.id)} color={c.color} onClick={() => toggleChip(c.id)}>
                        {c.label}
                      </ChipButton>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tour modes: unchanged behaviour, below the map. */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Personal Tour Mode */}
          <section className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Personal tour mode</h2>
              <button type="button" className="btn-ghost" onClick={geo.isPrecise ? refreshLocation : goToMyLocation}>
                {geo.isPrecise ? 'Update my location' : 'Use my location'}
              </button>
            </div>

            {/* A route drawn from a remembered position is still a real route, so say
                where it starts rather than blocking on a permission prompt. */}
            {!geo.isPrecise && geo.fallbackLabel && (
              <p className="faint mt-1 text-xs">Starting from {geo.fallbackLabel} (approximate).</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {MOODS.map(([value, label, blurb]) => (
                <button
                  key={value}
                  type="button"
                  title={blurb}
                  aria-pressed={mood === value}
                  onClick={() => setMood(value)}
                  className={`chip min-h-11 ${mood === value ? 'border-ink-800 bg-ink-800 text-sand-50' : 'bg-blue'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {PROFILES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={profile === value}
                  onClick={() => setProfile(value)}
                  className={`chip min-h-11 ${profile === value ? 'border-ink-800 bg-ink-800 text-sand-50' : 'bg-blue'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-3 text-sm text-ink-700 dark:text-sand-200">
              {destination ? (
                <>
                  Heading to <span className="font-semibold">{destination.name}</span>
                </>
              ) : (
                'Pick a place on the map, then choose “Use in tour route”.'
              )}
            </p>

            <button
              type="button"
              className="btn-primary mt-3 w-full"
              disabled={!destination || buildRoute.isPending}
              onClick={() => buildRoute.mutate()}
            >
              <RouteIcon className="h-4 w-4" aria-hidden />
              {buildRoute.isPending ? 'Plotting…' : `Build my ${mood} route`}
            </button>
            {buildRoute.isError && <p className="mt-2 text-sm text-red-700">{buildRoute.error.message}</p>}
            {showingNav && route && (
              <p className="faint mt-2 text-xs">
                A Google route is showing on the map. Reset it to see this tour route again.
              </p>
            )}

            {route && (
              <div className="mt-3 rounded-xl bg-sand-50 p-3 text-sm dark:bg-ink-800">
                {route.distanceMeters != null ? (
                  <p className="font-semibold">
                    {km(route.distanceMeters)} · {minutes(route.durationSeconds)}
                  </p>
                ) : (
                  <p className="font-semibold">{route.guideName ? `${route.guideName}'s route` : "Your guide's route"}</p>
                )}
                {route.waypoints?.length > 0 && (
                  <ol className="mt-2 space-y-1 text-xs text-ink-700 dark:text-sand-200">
                    {route.waypoints.map((w, i) => (
                      <li key={w.id ?? `${w.name}-${i}`}>
                        {i + 1}. {w.name}
                        {w.detourMeters ? ` (+${km(w.detourMeters)} detour)` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>

          {/* Guided Tour Mode */}
          <section className="card p-4">
            <h2 className="text-sm font-semibold">Guided tour mode</h2>
            <p className="mt-1 text-sm text-ink-700 dark:text-sand-200">
              Follow the exact line your guide will walk on the day. If they haven&apos;t drawn one, we&apos;ll order the
              tour&apos;s stops the shortest way round.
            </p>

            {isGuest ? (
              <p className="mt-3 text-sm">
                <Link to="/login" className="font-semibold underline">
                  Sign in
                </Link>{' '}
                to see the route for a departure you&apos;ve booked.
              </p>
            ) : departures.data?.length ? (
              <>
                <label className="mt-3 block text-sm">
                  Departure
                  <select className="field mt-1 w-full" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                    <option value="">Choose a booked departure…</option>
                    {departures.data.map((b) => (
                      <option key={b.id} value={b.slotId}>
                        {b.tourTitle} — {shortDate(b.bookingDate)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="btn-ghost mt-3 w-full"
                  disabled={!slotId || guided.isPending}
                  onClick={() => guided.mutate()}
                >
                  {guided.isPending ? 'Loading the route…' : 'Show the guided route'}
                </button>

                {guided.isError && <p className="mt-2 text-sm text-red-700">{guided.error.message}</p>}
                {guided.isSuccess && guided.data.source === 'optimised' && (
                  <p className="mt-2 text-xs text-sand-500">
                    No curated line for this departure yet — this is the shortest order through the stops.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-sand-500">
                {departures.isPending ? 'Checking your trips…' : 'Once a booking is confirmed, its guided route shows up here.'}
              </p>
            )}
          </section>
        </div>
      </div>

      <PlaceDetail
        place={detailPlace}
        travel={detailPlace ? travelById.get(detailPlace.id) : undefined}
        mode={navMode}
        origin={navOrigin}
        onClose={() => setDetailPlace(null)}
        onDirections={startDirections}
        onSetDestination={(place) => {
          setDestination(place);
          setDetailPlace(null);
        }}
        onExploreNearby={exploreAround}
      />
    </div>
  );
}
