import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { km, minutes, shortDate } from '../lib/format.js';

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

export default function Explore() {
  const geo = useGeolocation();
  const { isGuest } = useAuth();
  const [bounds, setBounds] = useState(null);
  const [mood, setMood] = useState('scenic');
  const [profile, setProfile] = useState('foot');
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [slotId, setSlotId] = useState('');

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
        from: { lat: geo.coords.lat, lng: geo.coords.lng },
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black">Explore the city</h1>
        <p className="text-sm text-ink-700">
          Tap a pin to set a destination, then pick how you want to get there.
        </p>
      </header>

      <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-2xl bg-sand-100" />}>
        <MapCanvas
          pins={pinList}
          route={route?.geometry ?? null}
          stops={route?.waypoints ?? []}
          initialView={{ latitude: geo.coords.lat, longitude: geo.coords.lng, zoom: 12.5 }}
          onMoveEnd={setBounds}
          onPinSelect={onPinSelect}
          className="h-[55vh] w-full md:h-[65vh]"
        />
      </Suspense>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Personal tour mode</h2>
          <button type="button" className="btn-ghost" onClick={geo.request}>
            {geo.isPrecise ? 'Update my location' : 'Use my location'}
          </button>
        </div>

        {/* A route drawn from a remembered position is still a real route, so say
            where it starts rather than blocking on a permission prompt. */}
        {!geo.isPrecise && (
          <p className="faint mt-1 text-xs">Starting from {geo.fallbackLabel}.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {MOODS.map(([value, label, blurb]) => (
            <button
              key={value}
              type="button"
              title={blurb}
              aria-pressed={mood === value}
              onClick={() => setMood(value)}
              className={`chip min-h-11 ${
                mood === value ? 'border-ink-800 bg-ink-800 text-sand-50' : 'bg-blue'
              }`}
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
              className={`chip min-h-11 ${
                profile === value ? 'border-ink-800 bg-ink-800 text-sand-50' : 'bg-blue'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-sm text-ink-700">
          {destination ? (
            <>
              Heading to <span className="font-semibold">{destination.name}</span>
            </>
          ) : (
            'Pick a pin on the map to choose where you are going.'
          )}
        </p>

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={!destination || buildRoute.isPending}
          onClick={() => buildRoute.mutate()}
        >
          {buildRoute.isPending ? 'Plotting…' : `Build my ${mood} route`}
        </button>

        {buildRoute.isError && (
          <p className="mt-2 text-sm text-red-700">{buildRoute.error.message}</p>
        )}

        {route && (
          <div className="mt-3 rounded-xl bg-sand-50 p-3 text-sm">
            {route.distanceMeters != null ? (
              <p className="font-semibold">
                {km(route.distanceMeters)} · {minutes(route.durationSeconds)}
              </p>
            ) : (
              <p className="font-semibold">
                {route.guideName ? `${route.guideName}'s route` : "Your guide's route"}
              </p>
            )}
            {route.waypoints?.length > 0 && (
              <ol className="mt-2 space-y-1 text-xs text-ink-700">
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

      <section className="card p-4">
        <h2 className="text-sm font-semibold">Guided tour mode</h2>
        <p className="mt-1 text-sm text-ink-700">
          Follow the exact line your guide will walk on the day. If they haven&apos;t drawn one,
          we&apos;ll order the tour&apos;s stops the shortest way round.
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
              <select
                className="field mt-1"
                value={slotId}
                onChange={(e) => setSlotId(e.target.value)}
              >
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

            {guided.isError && (
              <p className="mt-2 text-sm text-red-700">{guided.error.message}</p>
            )}
            {guided.isSuccess && guided.data.source === 'optimised' && (
              <p className="mt-2 text-xs text-sand-500">
                No curated line for this departure yet — this is the shortest order through the
                stops.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-sand-500">
            {departures.isPending
              ? 'Checking your trips…'
              : 'Once a booking is confirmed, its guided route shows up here.'}
          </p>
        )}
      </section>
    </div>
  );
}
