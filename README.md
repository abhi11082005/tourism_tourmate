# Tour Mate

Small-group tour marketplace: browse and configure a package as a guest, sign in
only at the payment step, and hold your seats in Redis while you pay.

Node.js + Express for the API, PostgreSQL reached through **raw SQL over `pg`**
(no ORM anywhere — PostGIS, pgvector and JSONB are used directly), Redis for
atomic seat locks, OSRM + OpenStreetMap for mood routing, Google Maps Platform
(Maps JavaScript API, Places API New, Routes API) for the map, nearby discovery and
road distances, and React + Vite + Tailwind on the front end.

## Quick start

Condensed; **[RUNNING.md](RUNNING.md) is the step-by-step version** with
prerequisites, Windows commands, demo logins and a troubleshooting table.

```bash
cp .env.example server/.env          # then paste in a generated JWT_SECRET
cp client/.env.example client/.env   # add your Google keys, see "Google Maps setup"

docker compose up -d db cache        # Postgres+PostGIS+pgvector, Redis

cd server && npm install
npm run seed                         # schema, indexes, then the demo data
npm run dev                          # http://localhost:4000

cd ../client && npm install
npm run dev                          # http://localhost:5173
```

Routing and the AI assistant are optional and off by default — see RUNNING.md
section 6. `npm run rag:index` needs an embedding endpoint running first, so it
is not part of the minimal path.

`GET /api/health` reports Postgres and Redis status and returns 503 if either is
down, which is what a load balancer should poll.

### Migrations

There is no ORM and no migration framework. `server/scripts/migrate.js` runs
every `db/migrations/*.sql` file in order inside a transaction, records a
checksum per file, and refuses to continue if an already-applied file has been
edited.

```bash
npm run migrate                 # schema + indexes only
npm run migrate -- --dry-run    # show what would run
npm run seed                    # migrate + *_seed.sql
```

### Routing engine

OSRM needs a one-off preprocessing pass over an OSM extract; the commands are in
the header of `docker-compose.yml`. Then `docker compose --profile routing up -d
osrm` and point `OSRM_BASE_URL` at it. The public demo server works for
development but rate-limits and must not be used in production.

## How the interesting parts work

**Seats are counted across two ledgers.** Availability for a date is
`total_seats − CONFIRMED bookings (Postgres) − held seats (Redis)`. A PENDING
booking row reserves nothing on its own; the reservation *is* the Redis hold, so
a crashed process or a closed tab can never sell a seat twice or leak one
forever. Acquiring a hold runs as a single Lua script — it sweeps hash fields
whose TTL companion key has expired, recomputes availability, and either writes
the hold or returns the shortfall, all atomically. A background sweeper
(`workers/seatExpiry.worker.js`) only makes Postgres agree with Redis by flipping
stale PENDING rows; it is deliberately off the request path, because a slow sweep
must never delay a checkout.

**Moods are waypoint selection, not routing weights.** OSRM has three profiles
(foot, bike, car) and no notion of "scenic". So `POST /api/routing/route` scores
attractions inside the corridor between origin and destination with PostGIS —
`scenic_score`, inverted `noise_score`, `crowd_score` — picks the best few, and
asks OSRM for a route *through* them. The result is a real road geometry that
happens to be pretty or quiet. `fastest` skips the selection step entirely.
Guided Tour Mode replays a guide's saved line, or falls back to OSRM `/trip`,
which solves the stop ordering as a TSP.

**The assistant answers in under three seconds** by streaming. Retrieval is one
pgvector query (`<=>` against an HNSW index) over chunks derived from the tour's
own JSONB, and tokens go out over SSE as the model produces them. Two details
matter more than the model choice: `compression()` skips `text/event-stream`, or
the first token sits in a buffer; and the client accumulates tokens in a ref and
flushes once per `requestAnimationFrame`, because calling `setState` 200 times is
what makes a streaming answer stutter.

**The map never blocks the main thread.** Pins are AdvancedMarkerElements built from
plain DOM nodes and handed to a `MarkerClusterer`, so a dense city collapses into a
few cluster bubbles instead of hundreds of live markers. Updates are diffed by id
(only added or removed pins are touched), selection only restyles the two affected
nodes, there is exactly one map instance per mount (a light/dark switch is the only
reason to rebuild it — Google fixes `colorScheme` at construction), viewport queries
fire on `idle`, never during the gesture, and the Maps loader is a lazy chunk so the
tour list stays interactive.

**Explore keeps two kinds of place apart.** Curated TourMate attractions come from
PostGIS (`/attractions/nearby`, `/attractions/pins`). External discoveries come from
Google Places API (New) through the server (`/places/*`), only after the visitor
opts in (shares location, explores around a place, or asks), are never stored, and
are always badged "Google Places". Google results that duplicate a curated place
(close coordinates *and* matching name) are dropped in favour of ours. Two distances
are never mixed up: "450 m away" is a straight line (PostGIS / great-circle) and
"650 m · 9 min walk" exists only after Routes API computed it. A remembered or
fallback position is always labelled approximate; only a GPS fix this tab took is
ever called "your location", and it lives in component state only.

**Guest mode is the default, and login happens once.** `AuthContext` treats "no
token" as a normal state rather than an error, so browsing, configuring a
package and getting a quote all work anonymously. `RequireAuth` guards only
checkout, trips, saved tours and admin, and it carries the return destination in
router state so a configured cart survives the login wall.

**Card data never reaches this code, and neither does the price.** The gateway's
own SDK collects card details in its own window and they go straight to Razorpay;
the server stores gateway identifiers, never a PAN. The amount is computed from
the booking row, never accepted from the browser, which is why
`POST /api/bookings/:id/order` takes no body at all. Confirming a payment needs
three things to line up: the callback HMAC must verify in constant time, the order
must have been created *for that booking*, and the amount on the order must equal
the booking's current total. The HMAC alone is not enough — it covers
`order|payment` and says nothing about which booking the money was for, so a
genuine signature from a cheap booking would otherwise confirm an expensive one.
Passwords are bcrypt-hashed at 12 rounds. That keeps the deployment in SAQ-A
scope for PCI-DSS.

## Layout

```
db/migrations/        raw SQL: 0001_init, 0002_indexes, 0003_seed
server/src/
  app.js index.js     assembly, health check, graceful shutdown
  config/ db/         env validation; pg pool + Redis (with the Lua hold script)
  middleware/         asyncHandler, zod validate, auth, error mapping
  routes/             auth tours attractions bookings social routing places assistant admin
  services/           booking, pricing, tours, attractions, social, osrm, google, places, rag
  workers/            seat-expiry reconciliation
server/scripts/       migrate.js, buildEmbeddings.js
client/src/
  pages/              Home TourDetail Explore Checkout Login MyBookings Wishlist Admin
  components/         MapCanvas (Google map, shared) explore/* SeatCalendar PriceConfigurator ...
  context/ hooks/ lib/  auth state, geolocation, useGoogleMap, googleMaps loader, mapMarkers, discovery, api client
```

## Google Maps setup

Google Maps Platform is a **paid, usage-billed** service (with a monthly free
allowance). Without keys the app still runs: the map area shows a clear "not
configured" message, curated pins and lists still load, and `/api/places/*` answers
`503 GOOGLE_NOT_CONFIGURED`.

Enable these APIs in one Google Cloud project, with billing on:

| API | Used for | Key |
| --- | --- | --- |
| Maps JavaScript API | the map itself | **browser** key |
| Places API (New) | nearby discovery, search, details, photos | **server** key |
| Routes API (includes Route Matrix) | road distance / time, route line | **server** key |

Create **two** keys:

- **Browser key** → `VITE_GOOGLE_MAPS_API_KEY` in `client/.env`. It is public by
  design, so restrict it: *HTTP referrers* (`http://localhost:5173/*`, your
  production domain) and *API restriction* = Maps JavaScript API only.
- **Server key** → `GOOGLE_MAPS_SERVER_API_KEY` in `server/.env` (or the repo-root
  `.env`). Never put it in `client/`. Restrict it to Places API (New) + Routes API,
  and to your server's egress IPs where your host has stable ones.

Optionally set `VITE_GOOGLE_MAPS_MAP_ID` to your own **Vector** Map ID (Cloud
Console → Map Management); otherwise Google's `DEMO_MAP_ID` is used, which is fine
for development.

Cost controls built in: explicit field masks (no reviews/phone/website on list
calls), a ~110 m cache grid and a short server cache (`PLACES_CACHE_TTL_SECONDS`),
React Query stale times, debounced viewport queries, per-IP rate limits, aborted
requests are cancelled upstream, ≤ 12 results per category, and Route Matrix only
runs when the traveller asks for travel times (≤ 10 destinations).

Google content is not stored in the database. Only TourMate's own attractions are.

### Deploying

- **Vercel (client).** Add `VITE_GOOGLE_MAPS_API_KEY` (and optionally
  `VITE_GOOGLE_MAPS_MAP_ID`) under Project → Settings → Environment Variables, then
  redeploy — Vite bakes `VITE_*` values in at build time. Add the Vercel domain(s)
  to the browser key's referrer list, including preview URLs if you use them. Set
  `VITE_API_BASE_URL` to the Railway API URL.
- **Railway (API).** Add `GOOGLE_MAPS_SERVER_API_KEY` (and, if you like,
  `PLACES_CACHE_TTL_SECONDS`) to the service's Variables. Set `CORS_ORIGIN` to the
  Vercel origin. Railway egress IPs are not stable on the default plan, so an IP
  restriction may not be possible there; rely on the API restriction, keep the key
  server-only and set a quota/budget alert in Google Cloud.

## Free-tier choices

Maps, Places and Routes are Google services and are billed by usage — set a budget
alert and per-API quotas in Cloud Console. Everything else stays on free or
self-hosted tiers: the LLM is a free-tier Groq or Google AI Studio key,
Postgres/Redis/OSRM are self-hosted (OSRM still powers Personal and Guided Tour
Mode), and user media goes to a Cloudinary or S3 free tier with only the URL stored
in the database.

## Verification

What was run here:

```bash
cd server && npm run check      # parses every src/ and scripts/ file
cd server && npm test           # pricing + Google Places/Routes tests (Google mocked)
cd client && npm run check      # brackets, JSX tag balance, import graph, api surface
```

`client/scripts/checkClient.mjs` exists because this environment has no npm
registry access, so `vite build` could not be run: it parses every `.js`/`.jsx`
file, checks bracket and JSX tag balance, confirms every relative import resolves
and every named import is actually exported, and verifies every `api.x()` call
exists on the client's API object. Run `npm install && npm run build` in `client/`
on a machine with registry access — that is the one check still outstanding.
The migrations are likewise unverified against a live Postgres, since no server
was reachable from here.

## Not built yet

Notifications and invoices (email/WhatsApp, PDF itinerary), the server-side
Google OAuth 2.0 callback that the login page links to, and admin media upload to
Cloudinary/S3 — the pin and package forms currently take an image URL.
