import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { km, minutes, shortDate } from '../lib/format.js';

const MapCanvas = lazy(() => import('../components/MapCanvas.jsx'));

const MOODS = [
  { value: 'scenic', label: 'Scenic', description: 'Prettiest way round', icon: '✳' },
  { value: 'quiet', label: 'Quiet', description: 'Away from traffic', icon: '◌' },
  { value: 'food', label: 'Food', description: 'Past the good stuff', icon: '⌁' },
  { value: 'fastest', label: 'Fastest', description: 'Straight there', icon: '↗' },
];

const PROFILES = [
  { value: 'foot', label: 'Walk', icon: '♙' },
  { value: 'bike', label: 'Cycle', icon: '⌁' },
  { value: 'car', label: 'Drive', icon: '▰' },
];

function PinIcon() {
  return <span aria-hidden="true" className="explore-brand-mark">T</span>;
}

function RouteSummary({ route }) {
  if (!route) return null;
  return (
    <div className="explore-route-result">
      <div className="explore-route-result-head">
        <span className="explore-eyebrow">YOUR ROUTE IS READY</span>
        <span className="explore-route-ready">● Ready</span>
      </div>
      {route.distanceMeters != null ? (
        <div className="explore-route-stats">
          <div><strong>{km(route.distanceMeters)}</strong><span>Distance</span></div>
          <div><strong>{minutes(route.durationSeconds)}</strong><span>Estimated time</span></div>
        </div>
      ) : (
        <p className="explore-route-guide">{route.guideName ? `${route.guideName}'s route` : "Your guide's route"}</p>
      )}
      {route.waypoints?.length > 0 && (
        <ol className="explore-waypoints">
          {route.waypoints.map((waypoint, index) => (
            <li key={waypoint.id ?? `${waypoint.name}-${index}`}>
              <span className="explore-waypoint-number">{index + 1}</span>
              <span>{waypoint.name}{waypoint.detourMeters ? <small> · +{km(waypoint.detourMeters)} detour</small> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Explore() {
  const geo = useGeolocation();
  const { isGuest } = useAuth();
  const [bounds, setBounds] = useState(null);
  const [mood, setMood] = useState('scenic');
  const [profile, setProfile] = useState('foot');
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [slotId, setSlotId] = useState('');
  const [mode, setMode] = useState('personal');
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const pins = useQuery({
    queryKey: ['pins', bounds],
    queryFn: ({ signal }) => api.pins(bounds, signal),
    enabled: Boolean(bounds),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const pinList = useMemo(
    () => (pins.data?.features ?? []).map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      category: feature.properties.category,
      imageUrl: feature.properties.imageUrl ?? feature.properties.image_url ?? null,
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
    })),
    [pins.data]
  );

  const buildRoute = useMutation({
    mutationFn: () => api.route({
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
    setSheetExpanded(true);
  }, []);

  const departures = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    enabled: !isGuest,
    staleTime: 60_000,
    select: (data) => (data?.items ?? []).filter((booking) => booking.status === 'CONFIRMED' && booking.slotId),
  });

  const guided = useMutation({
    mutationFn: () => api.guidedRoute(slotId),
    onSuccess: (data) => setRoute({
      geometry: data.geometry,
      waypoints: data.stops ?? [],
      distanceMeters: data.distanceMeters ?? null,
      durationSeconds: data.durationSeconds ?? null,
      source: data.source,
      guideName: data.guideName,
    }),
  });

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setRoute(null);
  };

  return (
    <main className="explore-page">
      <div className="explore-map-shell">
        <Suspense fallback={<div className="explore-map-loading"><span className="explore-loader" />Preparing your map…</div>}>
          <MapCanvas
            pins={pinList}
            route={route?.geometry ?? null}
            stops={route?.waypoints ?? []}
            initialView={{ latitude: geo.coords.lat, longitude: geo.coords.lng, zoom: 12.5 }}
            onMoveEnd={setBounds}
            onPinSelect={onPinSelect}
            className="explore-map"
          />
        </Suspense>

        <div className="explore-map-topbar">
          <div className="explore-map-brand">
            <PinIcon />
            <span>TOURMATE <small>DISCOVER YOUR WAY</small></span>
          </div>
          <div className="explore-map-status"><span /> {pins.isFetching ? 'Updating places' : `${pinList.length} places on map`}</div>
          <button type="button" className="explore-location-button" onClick={geo.request} disabled={geo.state === 'locating'}>
            <span aria-hidden="true">◎</span>{geo.state === 'locating' ? 'Locating…' : 'My location'}
          </button>
        </div>

        <div className="explore-map-caption">
          <span className="explore-caption-dot" />
          <span>{destination ? `Destination selected · ${destination.name}` : 'Explore the map · Select a place to begin'}</span>
        </div>
      </div>

      <aside className={`explore-discovery-panel ${sheetExpanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          className="explore-sheet-handle"
          aria-label={sheetExpanded ? 'Collapse discovery panel' : 'Expand discovery panel'}
          onClick={() => setSheetExpanded((value) => !value)}
        ><span /></button>

        <div className="explore-panel-scroll">
          <div className="explore-kicker"><span /> MAKE THE CITY YOURS</div>
          <div className="explore-heading-row">
            <div>
              <h1>Explore beyond<br /><em>the ordinary.</em></h1>
              <p className="explore-intro">Every turn has a story. Find the one that feels like yours.</p>
            </div>
            <div className="explore-compass" aria-hidden="true">✳</div>
          </div>

          <div className="explore-mode-switch" role="tablist" aria-label="Tour mode">
            <button type="button" role="tab" aria-selected={mode === 'personal'} className={mode === 'personal' ? 'active' : ''} onClick={() => changeMode('personal')}>
              <span aria-hidden="true">⌖</span> Personal tour
            </button>
            <button type="button" role="tab" aria-selected={mode === 'guided'} className={mode === 'guided' ? 'active' : ''} onClick={() => changeMode('guided')}>
              <span aria-hidden="true">✧</span> Guided tour
            </button>
          </div>

          {mode === 'personal' ? (
            <section className="explore-planner" aria-label="Personal tour planner">
              <div className="explore-section-heading">
                <div><span className="explore-step">01</span><h2>Set your mood</h2></div>
                <span className="explore-section-note">THE VIBE</span>
              </div>
              <div className="explore-mood-grid">
                {MOODS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={mood === item.value}
                    onClick={() => { setMood(item.value); setRoute(null); }}
                    className={`explore-mood-card ${mood === item.value ? 'selected' : ''}`}
                  >
                    <span className="explore-mood-icon">{item.icon}</span>
                    <span className="explore-mood-label">{item.label}</span>
                    <span className="explore-mood-description">{item.description}</span>
                    {mood === item.value && <span className="explore-selected-check">✓</span>}
                  </button>
                ))}
              </div>

              <div className="explore-section-heading explore-transport-heading">
                <div><span className="explore-step">02</span><h2>How will you wander?</h2></div>
              </div>
              <div className="explore-transport-control" role="group" aria-label="Transport profile">
                {PROFILES.map((item) => (
                  <button key={item.value} type="button" aria-pressed={profile === item.value} className={profile === item.value ? 'selected' : ''} onClick={() => { setProfile(item.value); setRoute(null); }}>
                    <span aria-hidden="true">{item.icon}</span>{item.label}
                  </button>
                ))}
              </div>

              <div className="explore-section-heading explore-destination-heading">
                <div><span className="explore-step">03</span><h2>Your destination</h2></div>
                <span className="explore-section-note">FROM THE MAP</span>
              </div>
              <div className="explore-destination-box">
                <span className="explore-destination-icon">⌖</span>
                <div className="explore-destination-copy">
                  <small>GOING TO</small>
                  <strong>{destination?.name ?? 'Choose a place on the map'}</strong>
                  <span>{destination ? String(destination.category ?? 'Attraction').toLowerCase().replace(/_/g, ' ') : 'Tap any attraction marker to set your destination.'}</span>
                </div>
                {destination && <button type="button" className="explore-clear-destination" onClick={() => { setDestination(null); setRoute(null); }}>Clear</button>}
              </div>
              <div className="explore-origin-row">
                <span className="explore-origin-dot" />
                <span>Starting from <strong>{geo.isPrecise ? 'your current location' : geo.fallbackLabel}</strong></span>
                <button type="button" onClick={geo.request}>{geo.isPrecise ? 'Refresh' : 'Update'}</button>
              </div>
              {geo.error && <p className="explore-inline-hint">{geo.error}</p>}

              <button type="button" className="explore-create-route" disabled={!destination || buildRoute.isPending} onClick={() => buildRoute.mutate()}>
                {buildRoute.isPending ? <><span className="explore-button-spinner" /> Finding your way…</> : <>Create my route <span aria-hidden="true">↗</span></>}
              </button>
              {buildRoute.isError && <p className="explore-error" role="alert">{buildRoute.error.message}</p>}
              <RouteSummary route={route} />
            </section>
          ) : (
            <section className="explore-planner" aria-label="Guided tour planner">
              <div className="explore-guided-intro">
                <span className="explore-guided-symbol">✧</span>
                <div><h2>Follow a local story.</h2><p>Explore a guide's saved path, with every stop in its intended order.</p></div>
              </div>
              {isGuest ? (
                <div className="explore-signin-card">
                  <div className="explore-signin-icon">↗</div>
                  <h3>Your next adventure is waiting.</h3>
                  <p>Sign in to see routes for the departures you've booked.</p>
                  <Link to="/login" className="explore-create-route">Sign in to continue <span>↗</span></Link>
                </div>
              ) : departures.data?.length ? (
                <>
                  <div className="explore-section-heading"><div><span className="explore-step">01</span><h2>Choose your departure</h2></div></div>
                  <label className="explore-select-wrap">
                    <span className="explore-select-label">CONFIRMED BOOKINGS</span>
                    <select value={slotId} onChange={(event) => { setSlotId(event.target.value); setRoute(null); }}>
                      <option value="">Select a booked departure…</option>
                      {departures.data.map((booking) => <option key={booking.id} value={booking.slotId}>{booking.tourTitle} — {shortDate(booking.bookingDate)}</option>)}
                    </select>
                    <span className="explore-select-chevron">⌄</span>
                  </label>
                  <button type="button" className="explore-create-route" disabled={!slotId || guided.isPending} onClick={() => guided.mutate()}>
                    {guided.isPending ? <><span className="explore-button-spinner" /> Loading your route…</> : <>Show the guided route <span>↗</span></>}
                  </button>
                  {guided.isError && <p className="explore-error" role="alert">{guided.error.message}</p>}
                  {guided.isSuccess && guided.data.source === 'optimised' && <p className="explore-inline-hint">No curated line for this departure yet — showing the optimised order through the stops.</p>}
                  <RouteSummary route={route} />
                </>
              ) : (
                <div className="explore-empty-bookings">{departures.isPending ? 'Checking your confirmed trips…' : 'Your confirmed departures will appear here.'}</div>
              )}
            </section>
          )}

          {destination?.imageUrl && (
            <div className="explore-attraction-preview">
              <img src={destination.imageUrl} alt="" />
              <div><span>SELECTED PLACE</span><strong>{destination.name}</strong><small>{String(destination.category ?? '').toLowerCase().replace(/_/g, ' ')}</small></div>
              <span className="explore-preview-pin">⌖</span>
            </div>
          )}
          <p className="explore-panel-footer">GO SOMEWHERE YOU'LL REMEMBER <span>✳</span></p>
        </div>
      </aside>
      <style>{STYLES}</style>
    </main>
  );
}

const STYLES = `
.explore-page{--exp-ink:#202b2b;--exp-muted:#71807a;--exp-paper:#fbfaf6;--exp-line:#e9e8df;--exp-accent:#b6c99b;--exp-deep:#263a35;position:relative;min-height:calc(100vh - 5.5rem);padding:0 0 1.25rem;background:var(--exp-paper);color:var(--exp-ink);overflow:hidden}
.explore-map-shell{position:relative;height:min(74vh,780px);min-height:520px;margin:0 1.1rem;border-radius:25px;overflow:hidden;background:#e8ebe4;box-shadow:0 18px 50px #283a3014}
.explore-map{position:absolute!important;inset:0;width:100%;height:100%;border-radius:0!important}
.explore-map .maplibregl-ctrl-top-right{top:82px;right:15px}
.explore-map .maplibregl-ctrl-group{border:0;border-radius:13px;overflow:hidden;box-shadow:0 5px 18px #233b3020}
.explore-map .maplibregl-ctrl-group button{width:34px;height:34px}
.explore-map-topbar{position:absolute;z-index:3;top:17px;left:18px;right:18px;display:flex;align-items:center;gap:14px;max-width:760px;padding:10px 12px;border:1px solid #ffffffb8;border-radius:17px;background:#fffdf4eF;box-shadow:0 8px 30px #24382b12;backdrop-filter:blur(18px)}
.explore-map-brand{display:flex;align-items:center;gap:9px;min-width:150px;font-size:11px;font-weight:900;letter-spacing:.13em}
.explore-map-brand small{display:block;margin-top:3px;color:#87918a;font-size:7px;letter-spacing:.17em}
.explore-brand-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:11px;background:var(--exp-deep);color:#e8efdc;font-family:Georgia,serif;font-size:19px}
.explore-map-status{display:flex;align-items:center;gap:7px;margin-left:auto;color:#78847b;font-size:11px}
.explore-map-status>span,.explore-kicker>span{width:7px;height:7px;border-radius:50%;background:#8fa978}
.explore-location-button{display:flex;align-items:center;gap:7px;min-height:37px;padding:0 12px;border:1px solid #e7e7dc;border-radius:11px;background:white;color:#30423a;font-size:11px;font-weight:700;transition:.2s}
.explore-location-button:hover{background:#f0f3e9}
.explore-location-button:disabled{opacity:.6}
.explore-location-button>span{font-size:17px}
.explore-map-caption{position:absolute;bottom:16px;left:16px;z-index:2;display:flex;align-items:center;gap:8px;padding:10px 13px;border:1px solid #ffffffb5;border-radius:12px;background:#fffdf0df;color:#526158;font-size:11px;box-shadow:0 5px 18px #24382b12;backdrop-filter:blur(12px)}
.explore-caption-dot{width:7px;height:7px;border-radius:50%;background:#c38a52}
.explore-map-loading{display:flex;height:100%;min-height:520px;align-items:center;justify-content:center;gap:10px;border-radius:25px;background:#e9eee6;color:#607067;font-size:13px}
.explore-loader,.explore-button-spinner{width:16px;height:16px;border:2px solid #b6c99b;border-top-color:#405c4b;border-radius:50%;animation:exp-spin .8s linear infinite}
@keyframes exp-spin{to{transform:rotate(360deg)}}
.explore-discovery-panel{position:relative;z-index:4;width:min(470px,calc(100% - 2.2rem));max-height:min(730px,calc(100vh - 8rem));margin:-58px 0 0 2rem;border:1px solid #e9e9df;border-radius:23px;background:#fffefa;box-shadow:0 20px 55px #20372c20;overflow:hidden}
.explore-panel-scroll{max-height:inherit;overflow-y:auto;padding:25px 25px 17px;scrollbar-width:thin;scrollbar-color:#d8decf transparent}
.explore-kicker{display:flex;align-items:center;gap:8px;color:#87927e;font-size:9px;font-weight:800;letter-spacing:.16em}
.explore-heading-row{display:flex;align-items:flex-start;justify-content:space-between;margin:13px 0 21px}
.explore-heading-row h1{margin:0;color:#263732;font-family:Georgia,'Times New Roman',serif;font-size:35px;font-weight:500;line-height:1.04;letter-spacing:-.045em}
.explore-heading-row h1 em{color:#8b9d77;font-weight:500}
.explore-intro{max-width:315px;margin:10px 0 0;color:#818b80;font-size:12px;line-height:1.55}
.explore-compass{display:grid;width:43px;height:43px;place-items:center;border:1px solid #e7eadf;border-radius:50%;color:#90a47c;font-size:24px;transform:rotate(-15deg)}
.explore-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;border:1px solid #ecece3;border-radius:14px;background:#f5f5ef}
.explore-mode-switch button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:42px;border:0;border-radius:10px;background:transparent;color:#879087;font-size:11px;font-weight:700;transition:.2s}
.explore-mode-switch button.active{background:#fffefa;color:#2e4138;box-shadow:0 3px 12px #24382b12}
.explore-mode-switch button.active span{color:#81996c}
.explore-planner{padding-top:22px}
.explore-section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.explore-section-heading>div{display:flex;align-items:center;gap:9px}
.explore-section-heading h2{margin:0;color:#34443c;font-size:13px;font-weight:750;letter-spacing:-.01em}
.explore-step{display:grid;width:25px;height:25px;place-items:center;border-radius:8px;background:#eff2e9;color:#7d916d;font-size:9px;font-weight:800}
.explore-section-note{color:#a3aa9e;font-size:8px;font-weight:800;letter-spacing:.13em}
.explore-mood-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.explore-mood-card{position:relative;display:grid;grid-template-columns:30px 1fr;grid-template-rows:auto auto;align-items:center;min-height:67px;padding:10px;border:1px solid #eaece4;border-radius:13px;background:#fffefa;text-align:left;transition:border-color .2s,background .2s,transform .2s,box-shadow .2s}
.explore-mood-card:hover{transform:translateY(-2px);border-color:#c6d2b9}
.explore-mood-card.selected{border-color:#a9bc96;background:#f4f6ee;box-shadow:inset 0 0 0 1px #a9bc9640}
.explore-mood-icon{grid-row:1/3;display:grid;width:27px;height:27px;place-items:center;border-radius:9px;background:#f1f2e9;color:#839875;font-size:17px}
.explore-mood-label{color:#35443b;font-size:11px;font-weight:800}
.explore-mood-description{margin-top:3px;color:#939b90;font-size:9px}
.explore-selected-check{position:absolute;top:7px;right:8px;color:#82986e;font-size:10px}
.explore-transport-heading{margin-top:22px}
.explore-transport-control{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.explore-transport-control button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:39px;border:1px solid #e8eae2;border-radius:11px;background:#fffefa;color:#7e897f;font-size:10px;font-weight:700;transition:.2s}
.explore-transport-control button>span{font-size:15px}
.explore-transport-control button.selected{border-color:#b7c6a8;background:#f1f4eb;color:#34483a}
.explore-destination-heading{margin-top:22px}
.explore-destination-box{display:flex;align-items:center;gap:11px;padding:12px;border:1px solid #e8eae2;border-radius:13px;background:#fbfbf7}
.explore-destination-icon{display:grid;flex:none;width:34px;height:34px;place-items:center;border-radius:10px;background:#edf1e7;color:#778f67;font-size:20px}
.explore-destination-copy{display:grid;min-width:0;gap:3px}
.explore-destination-copy small,.explore-attraction-preview>div>span{color:#a1a99d;font-size:8px;font-weight:800;letter-spacing:.12em}
.explore-destination-copy strong{overflow:hidden;color:#39483f;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.explore-destination-copy>span{overflow:hidden;color:#919a90;font-size:9px;text-overflow:ellipsis;white-space:nowrap}
.explore-clear-destination{margin-left:auto;border:0;background:transparent;color:#8d9b80;font-size:10px;font-weight:700}
.explore-origin-row{display:flex;align-items:center;gap:8px;margin:12px 1px;color:#8a9489;font-size:10px}
.explore-origin-dot{width:7px;height:7px;border:2px solid #a2b58f;border-radius:50%;box-shadow:0 0 0 3px #edf2e8}
.explore-origin-row strong{color:#5c6c5e;font-weight:700}
.explore-origin-row button{margin-left:auto;border:0;background:none;color:#81946f;font-size:10px;font-weight:800}
.explore-inline-hint{margin:8px 0;color:#899286;font-size:10px;line-height:1.5}
.explore-create-route{display:flex;width:100%;min-height:47px;align-items:center;justify-content:center;gap:10px;margin-top:13px;padding:0 16px;border:0;border-radius:12px;background:#2e4439;color:#f7f7ee;font-size:11px;font-weight:800;text-decoration:none;transition:transform .2s,background .2s,box-shadow .2s}
.explore-create-route:hover:not(:disabled){transform:translateY(-1px);background:#3a5546;box-shadow:0 8px 20px #2e443927}
.explore-create-route:disabled{cursor:not-allowed;opacity:.48}
.explore-create-route>span:not(.explore-button-spinner){font-size:16px}
.explore-button-spinner{width:13px;height:13px;border-color:#ffffff55;border-top-color:white}
.explore-error{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#fff0ed;color:#a13d2e;font-size:11px}
.explore-route-result{margin-top:13px;padding:14px;border:1px solid #e1e8d9;border-radius:14px;background:#f5f7f0;animation:exp-rise .3s ease both}
@keyframes exp-rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
.explore-route-result-head{display:flex;align-items:center;justify-content:space-between}
.explore-eyebrow{color:#8e9a86;font-size:8px;font-weight:800;letter-spacing:.13em}
.explore-route-ready{color:#6d9066;font-size:9px;font-weight:700}
.explore-route-stats{display:flex;gap:35px;margin-top:12px}
.explore-route-stats>div{display:grid;gap:3px}
.explore-route-stats strong{color:#34463a;font-family:Georgia,serif;font-size:21px;font-weight:500}
.explore-route-stats span{color:#909b8c;font-size:9px}
.explore-route-guide{margin:11px 0 0;color:#34463a;font-size:13px;font-weight:750}
.explore-waypoints{display:grid;gap:8px;margin:12px 0 0;padding:12px 0 0;border-top:1px solid #e3e9dc;list-style:none}
.explore-waypoints li{display:flex;align-items:center;gap:9px;color:#647266;font-size:10px}
.explore-waypoints small{color:#9aa396}
.explore-waypoint-number{display:grid;width:20px;height:20px;flex:none;place-items:center;border-radius:50%;background:#e4eadc;color:#66815e;font-size:9px;font-weight:800}
.explore-guided-intro{display:flex;gap:12px;padding:14px;border:1px solid #e9ecdf;border-radius:14px;background:#f8f8f2}
.explore-guided-symbol{display:grid;width:35px;height:35px;flex:none;place-items:center;border-radius:11px;background:#e9eee1;color:#81976d;font-size:20px}
.explore-guided-intro h2{margin:0;color:#35443b;font-family:Georgia,serif;font-size:17px;font-weight:500}
.explore-guided-intro p{margin:5px 0 0;color:#879187;font-size:10px;line-height:1.5}
.explore-signin-card{margin-top:15px;padding:19px;border:1px solid #e7eadd;border-radius:14px;background:#fbfcf8;text-align:center}
.explore-signin-icon{display:grid;width:38px;height:38px;place-items:center;margin:0 auto 10px;border-radius:50%;background:#edf2e8;color:#829974;font-size:18px}
.explore-signin-card h3{margin:0;color:#34463b;font-family:Georgia,serif;font-size:17px;font-weight:500}
.explore-signin-card p{margin:6px 0 0;color:#8b958b;font-size:10px}
.explore-select-wrap{position:relative;display:grid;gap:8px;margin-top:18px}
.explore-select-label{color:#9aa497;font-size:8px;font-weight:800;letter-spacing:.12em}
.explore-select-wrap select{width:100%;min-height:46px;appearance:none;padding:0 38px 0 12px;border:1px solid #e6e9df;border-radius:11px;background:#fffefa;color:#4c5d50;font-size:11px;outline:none}
.explore-select-wrap select:focus{border-color:#9caf88}
.explore-select-chevron{position:absolute;right:14px;bottom:12px;color:#8b9984;pointer-events:none}
.explore-empty-bookings{margin-top:15px;padding:16px;border-radius:12px;background:#f6f7f1;color:#879187;font-size:11px;line-height:1.5}
.explore-attraction-preview{display:flex;align-items:center;gap:11px;margin-top:17px;padding:9px;border:1px solid #e8eae2;border-radius:13px;background:#fff}
.explore-attraction-preview img{width:55px;height:49px;flex:none;border-radius:9px;object-fit:cover}
.explore-attraction-preview>div{display:grid;min-width:0;gap:4px}
.explore-attraction-preview>div strong{overflow:hidden;color:#3c4b40;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.explore-attraction-preview>div small{color:#919b90;font-size:9px;text-transform:capitalize}
.explore-preview-pin{margin-left:auto;color:#829673;font-size:19px}
.explore-panel-footer{display:flex;align-items:center;justify-content:space-between;margin:20px 0 0;padding-top:12px;border-top:1px solid #eff0e9;color:#a4aa9e;font-size:8px;font-weight:800;letter-spacing:.13em}
.explore-panel-footer span{color:#9aac88;font-size:15px}
.explore-sheet-handle{display:none}
@media(min-width:900px){
 .explore-discovery-panel{position:absolute;top:88px;bottom:28px;left:1.1rem;margin:0;max-height:none}
 .explore-panel-scroll{height:100%;max-height:none}
}
@media(max-width:899px){
 .explore-page{min-height:calc(100svh - 4.5rem);padding-bottom:0}
 .explore-map-shell{height:calc(100svh - 6rem);min-height:530px;margin:0;border-radius:0}
 .explore-map-caption{bottom:24px;left:12px}
 .explore-map-topbar{top:10px;left:10px;right:10px;padding:8px 9px}
 .explore-map-brand{min-width:unset;font-size:10px}
 .explore-brand-mark{width:31px;height:31px}
 .explore-map-status{font-size:9px}
 .explore-location-button{min-height:34px;padding:0 9px;font-size:10px}
 .explore-map .maplibregl-ctrl-top-right{top:63px;right:9px}
 .explore-discovery-panel{position:absolute;right:0;bottom:0;left:0;width:100%;max-height:min(76svh,690px);margin:0;border-right:0;border-bottom:0;border-left:0;border-radius:22px 22px 0 0;box-shadow:0 -10px 38px #20372c20;transition:max-height .3s ease}
 .explore-discovery-panel:not(.is-expanded){max-height: min(390px,65svh)}
 .explore-panel-scroll{max-height:calc(min(76svh,690px) - 20px);padding:13px 20px max(22px,env(safe-area-inset-bottom))}
 .explore-sheet-handle{display:grid;width:100%;height:17px;place-items:center;border:0;background:transparent}
 .explore-sheet-handle span{width:37px;height:4px;border-radius:9px;background:#d7dcd1}
 .explore-discovery-panel:not(.is-expanded) .explore-panel-scroll{max-height:calc(min(390px,65svh) - 18px)}
 .explore-heading-row{margin:10px 0 15px}
 .explore-heading-row h1{font-size:29px}
 .explore-intro{font-size:11px}
 .explore-planner{padding-top:17px}
}
@media(max-width:480px){
 .explore-map-shell{height:100svh;min-height:560px}
 .explore-map-status{display:none}
 .explore-map-brand{margin-right:auto}
 .explore-discovery-panel{max-height:78svh}
 .explore-discovery-panel:not(.is-expanded){max-height: min(400px,66svh)}
 .explore-panel-scroll{padding-right:16px;padding-left:16px;max-height:calc(78svh - 18px)}
 .explore-heading-row h1{font-size:27px}
 .explore-compass{width:37px;height:37px;font-size:20px}
 .explore-mood-card{min-height:62px;padding:8px}
 .explore-map .maplibregl-ctrl-top-right{top:58px}
}
@media(prefers-reduced-motion:reduce){.explore-discovery-panel,.explore-mood-card,.explore-create-route{transition:none}.explore-route-result{animation:none}}
`;
