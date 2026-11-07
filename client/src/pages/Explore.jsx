import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronUp, Loader2, MapPin, Route as RouteIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { km, minutes } from '../lib/format.js';
import { SAMPLE_SPOTLIGHTS } from '../lib/sampleSpotlights.js';
import SpotlightModal from '../components/SpotlightModal';
import Enter from '../components/explore/Enter.jsx';
import ExploreDiscoveryPanel from '../components/explore/ExploreDiscoveryPanel.jsx';
import ExploreMapControls from '../components/explore/ExploreMapControls.jsx';
import ExploreModeSwitcher from '../components/explore/ExploreModeSwitcher.jsx';
import GuidedTourPlanner from '../components/explore/GuidedTourPlanner.jsx';
import MobileExploreSheet from '../components/explore/MobileExploreSheet.jsx';
import PersonalTourPlanner from '../components/explore/PersonalTourPlanner.jsx';
import SelectedAttractionCard from '../components/explore/SelectedAttractionCard.jsx';
import SpotlightSection from '../components/explore/SpotlightSection.jsx';
import { GLASS_PILL, straightLineKm } from '../components/explore/exploreConfig.js';

const MapCanvas = lazy(() => import('../components/MapCanvas.jsx'));

/*
 * Explore: attraction pins for the current viewport, plus the two route modes.
 *
 * Personal Tour Mode asks the server for a mood route. "Scenic", "quiet" and
 * "food" are not OSRM profiles — the server picks waypoints by PostGIS score and
 * then routes through them, which is how a mood becomes a real road path without
 * re-weighting the OSRM graph.
 *
 * Guided Tour Mode replays the guide's saved route for a departure, falling back
 * to an OSRM-optimised order of the tour's stops.
 *
 * This file owns ALL queries, mutations and state. Everything under
 * components/explore is presentational, so the desktop panel and the mobile sheet
 * are two frames around one planner that is mounted exactly once.
 */

// Placeholder content — see lib/sampleSpotlights.js. Swap for a query when a real
// spotlight endpoint exists and flip this flag.
const spotlights = SAMPLE_SPOTLIGHTS;
const SPOTLIGHTS_ARE_SAMPLE = true;

function MapSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-sand-100 dark:bg-ink-900">
      <span className="faint flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Preparing your map…
      </span>
    </div>
  );
}

const Hint = ({ children }) => (
  <p className="muted rounded-2xl border border-dashed border-sand-300 px-3 py-3 text-sm dark:border-ink-500">
    {children}
  </p>
);

// Collapsed-sheet summary once a route exists, so the result is visible with the map.
function RoutePeek({ route, onOpen }) {
  const hasStats = route.distanceMeters != null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-left dark:border-emerald-500/30 dark:bg-emerald-950/30"
    >
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
        <RouteIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
          Route ready
        </span>
        <span className="block truncate text-sm font-bold tabular-nums">
          {hasStats
            ? `${km(route.distanceMeters)} · ${minutes(route.durationSeconds)}`
            : route.guideName
              ? `${route.guideName}'s route`
              : "Your guide's route"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
        Details
        <ChevronUp className="h-4 w-4" aria-hidden />
      </span>
    </button>
  );
}

export default function Explore() {
  // --- MAP & ROUTING STATE ---
  const geo = useGeolocation();
  const { isGuest } = useAuth();
  const [bounds, setBounds] = useState(null);
  const [mood, setMood] = useState('scenic');
  const [profile, setProfile] = useState('foot');
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [slotId, setSlotId] = useState('');

  // --- PRESENTATION STATE ---
  const [mode, setMode] = useState('personal');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // --- SPOTLIGHTS STATE ---
  const [selectedSpotlightId, setSelectedSpotlightId] = useState(null);

  // --- MAP & ROUTING QUERIES/MUTATIONS ---
  const pins = useQuery({
    queryKey: ['pins', bounds],
    queryFn: ({ signal }) => api.pins(bounds, signal),
    enabled: Boolean(bounds),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // The API returns a GeoJSON FeatureCollection; flatten it once for the map.
  const pinList = useMemo(
    () =>
      (pins.data?.features ?? []).map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        category: f.properties.category,
        imageUrl: f.properties.imageUrl ?? f.properties.image_url ?? null,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })),
    [pins.data]
  );

  const buildRoute = useMutation({
    mutationFn: () =>
      api.route({
        from: { lat: geo.coords?.lat, lng: geo.coords?.lng },
        to: { lat: destination.lat, lng: destination.lng },
        mood,
        profile,
      }),
    onSuccess: setRoute,
  });

  const onPinSelect = useCallback((pin) => {
    setDestination(pin);
    setRoute(null);
  }, []);

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

  // --- PRESENTATION HANDLERS ---
  const changeMode = useCallback((next) => {
    setMode(next);
    // Both modes draw into the same map layer, so a route never outlives its mode.
    setRoute(null);
  }, []);

  const clearDestination = useCallback(() => {
    setDestination(null);
    // The personal route belongs to its destination; a guided route does not.
    if (mode === 'personal') setRoute(null);
  }, [mode]);

  // On phones, a finished route collapses the sheet so the line is what you see.
  useEffect(() => {
    if (route && !isDesktop) setSheetExpanded(false);
  }, [route, isDesktop]);

  const straightKm = useMemo(
    () => (destination ? straightLineKm(geo.coords, destination) : null),
    [destination, geo.coords]
  );

  const placesLabel = pins.isError
    ? "Couldn't load places"
    : !bounds || (pins.isPending && !pins.data)
      ? 'Loading places…'
      : pins.isFetching
        ? 'Updating places…'
        : `${pinList.length} ${pinList.length === 1 ? 'place' : 'places'} in view`;

  const planner =
    mode === 'personal' ? (
      <PersonalTourPlanner
        geo={geo}
        destination={destination}
        onClearDestination={clearDestination}
        mood={mood}
        onMoodChange={setMood}
        profile={profile}
        onProfileChange={setProfile}
        onBuild={() => buildRoute.mutate()}
        building={buildRoute.isPending}
        buildError={buildRoute.isError ? buildRoute.error : null}
        route={route}
      />
    ) : (
      <GuidedTourPlanner
        isGuest={isGuest}
        departures={departures}
        slotId={slotId}
        onSlotChange={setSlotId}
        onShow={() => guided.mutate()}
        guided={guided}
        route={route}
      />
    );

  const openSpotlight = (
    <SpotlightSection
      spotlights={spotlights}
      isSample={SPOTLIGHTS_ARE_SAMPLE}
      onSelect={setSelectedSpotlightId}
      layout={isDesktop ? 'rail' : 'inline'}
    />
  );

  // Collapsed-sheet preview: route result > chosen destination > a hint.
  const peekPreview = route ? (
    <RoutePeek route={route} onOpen={() => setSheetExpanded(true)} />
  ) : mode === 'personal' && destination ? (
    <SelectedAttractionCard
      variant="compact"
      attraction={destination}
      onClear={clearDestination}
      onPlan={() => setSheetExpanded(true)}
    />
  ) : (
    <Hint>
      {mode === 'personal'
        ? "Tap a pin on the map to choose where you're going."
        : isGuest
          ? "Sign in to see your guide's route."
          : 'Pick a booked departure to see your guide’s route.'}
    </Hint>
  );

  return (
    <div className="absolute inset-x-0 top-0 bottom-16 overflow-hidden md:bottom-0">
      {/* ── The map is the canvas ───────────────────────────────────────────── */}
      <div className="absolute inset-0">
        <Suspense fallback={<MapSkeleton />}>
          <MapCanvas
            pins={pinList}
            route={route?.geometry ?? null}
            stops={route?.waypoints ?? []}
            initialView={{
              latitude: geo.coords?.lat ?? 0, // safe fallback if geo not ready
              longitude: geo.coords?.lng ?? 0,
              zoom: 12.5,
            }}
            onMoveEnd={setBounds}
            onPinSelect={onPinSelect}
            className="h-full w-full !rounded-none"
          />
        </Suspense>
      </div>

      {(isDesktop || !sheetExpanded) && (
        <ExploreMapControls geo={geo} hasRoute={Boolean(route)} onClearRoute={() => setRoute(null)} />
      )}

      {isDesktop ? (
        <>
          <ExploreDiscoveryPanel mode={mode} onModeChange={changeMode} placesLabel={placesLabel}>
            {planner}
          </ExploreDiscoveryPanel>

          {destination ? (
            <Enter
              key={destination.id ?? destination.name}
              as="aside"
              aria-label="Selected attraction"
              className="absolute right-[4.25rem] top-4 z-10 max-h-[calc(100%-2rem)] w-[20rem] overflow-y-auto xl:w-[22rem]"
            >
              <SelectedAttractionCard
                attraction={destination}
                straightKm={straightKm}
                startLabel={geo.isPrecise ? 'you' : geo.fallbackLabel}
                onClear={clearDestination}
                onPlan={mode === 'guided' ? () => changeMode('personal') : undefined}
              />
            </Enter>
          ) : (
            <div className="pointer-events-none absolute bottom-10 left-[calc(24rem+2rem)] z-10 max-w-[46rem] xl:left-[calc(26rem+2rem)]">
              <div className="pointer-events-auto">{openSpotlight}</div>
            </div>
          )}
        </>
      ) : (
        <>
          <h1 className="sr-only">Explore beyond the ordinary</h1>

          <div className="pointer-events-none absolute left-3 right-14 top-3 z-10 flex items-center gap-2">
            <span className={`pointer-events-auto flex items-center gap-2 rounded-full px-3 py-2 text-sm font-black ${GLASS_PILL}`}>
              <MapPin className="h-4 w-4" aria-hidden />
              <span>
                Tour<span className="text-glow">Mate</span>
              </span>
            </span>
            <span
              className={`pointer-events-auto truncate rounded-full px-3 py-2 text-xs font-semibold ${GLASS_PILL}`}
              aria-live="polite"
            >
              {placesLabel}
            </span>
          </div>

          <MobileExploreSheet
            expanded={sheetExpanded}
            onExpandedChange={setSheetExpanded}
            switcher={<ExploreModeSwitcher mode={mode} onChange={changeMode} />}
            preview={peekPreview}
          >
            <div id="explore-mode-panel" role="tabpanel" aria-labelledby={`explore-tab-${mode}`}>
              {planner}
            </div>
            <div className="mt-7">{openSpotlight}</div>
          </MobileExploreSheet>
        </>
      )}

      {isDesktop && (
        <div className="pointer-events-none absolute left-[calc(24rem+2rem)] top-4 z-10 xl:left-[calc(26rem+2rem)]">
          <p
            className={`pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold ${GLASS_PILL}`}
            aria-live="polite"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {destination ? `Destination · ${destination.name}` : 'Select a pin to begin'}
          </p>
        </div>
      )}

      {/* Renders the modal only when a card is clicked */}
      {selectedSpotlightId && (
        <SpotlightModal spotlightId={selectedSpotlightId} onClose={() => setSelectedSpotlightId(null)} />
      )}
    </div>
  );
}
