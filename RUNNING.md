# Running Tour Mate locally

Four things have to be up: **Postgres** (with PostGIS + pgvector), **Redis**, the  
**Express API**, and the **Vite dev server**. Routing and the AI assistant are  
optional extras — the app runs without them, those two features just report that  
they are unavailable.

Total time on a machine that already has Docker and Node: about ten minutes,  
most of it `npm install`.

---

## 0\. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 20 or newer (22 tested) | `node --watch`, built-in test runner |
| Docker Desktop | any current | Postgres+PostGIS+pgvector and Redis |
| Git | any | cloning |

Check both:

```
node -v      # v20.x or higher
docker -v
```

No Docker? You need a local Postgres 14+ with the `postgis`, `vector`,  
`pgcrypto`, `citext`, `pg_trgm` and `btree_gin` extensions available, plus a  
local Redis. Docker is far less work — the compose file pins an image that  
already contains PostGIS and pgvector.

---

## 1\. Start Postgres and Redis

From the repo root:

```
docker compose up -d db cache
docker compose ps          # both should say "healthy" after ~10s
```

Redis runs with persistence deliberately switched off. A seat hold is  
recoverable state — losing one frees seats slightly early, which is safe, and  
skipping the disk write keeps the lock path fast.

---

## 2\. Configure the API

```
# macOS / Linux
cp .env.example server/.env

# Windows PowerShell
Copy-Item .env.example server\.env
```

Then generate a real `JWT_SECRET` and paste it in:

```
openssl rand -base64 48
# PowerShell alternative:
# [Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))
```

The defaults in that file are already correct for the Docker services above, so  
`JWT_SECRET` is the only value you have to touch to boot. `LLM_PROVIDER=none`  
and the OSRM demo URL are intentional starting points — section 6 upgrades them.

The server reads `server/.env` first and the repo-root `.env` as a fallback, and  
real environment variables always beat both. Config is validated by zod at  
startup: a missing or malformed value stops the process with a list of what's  
wrong rather than booting half-configured and double-selling seats.

---

## 3\. Create the schema and demo data

```
cd server
npm install

npm run migrate -- --dry-run     # list what would run, touch nothing
npm run seed                     # schema + indexes + demo data
```

There is no ORM and no migration framework. `scripts/migrate.js` runs each  
`db/migrations/*.sql` file once, inside a transaction, and records a checksum. If  
you edit a file that has already been applied it refuses to continue rather than  
leaving the schema in a state nobody can reproduce. To start over:

```
docker compose down -v && docker compose up -d db cache   # wipes the volume
cd server && npm run seed
```

The seed opens departures for `CURRENT_DATE + 2` through `+31`, so the calendar  
is never empty no matter when you run it. Weekend dates cost ₹750 more per seat  
and get a guide assigned — that is the `price_modifier` the quote endpoint  
applies on top of the base fare.

Demo logins (both `TourMate#2026`):

| Email | Role | Gets you |
| --- | --- | --- |
| `admin@tourmate.dev` | ADMIN | `/admin` — analytics, package builder, seat manager, pin creator |
| `meera.guide@tourmate.dev` | GUIDE | assigned to weekend departures |

Or register a fresh traveller account from the login page; bcrypt at 12 rounds  
hashes it. The seeded hashes come from pgcrypto's `crypt(..., gen_salt('bf',12))`,  
which is the same bcrypt format `bcrypt.compare` expects.

---

## 4\. Start the API

```
cd server
npm run dev          # http://localhost:4000
```

Confirm both stores are actually reachable:

```
curl http://localhost:4000/api/health
# {"status":"ok","checks":{"postgres":"up","redis":"up"},"env":"development","uptimeSeconds":3}
```

That endpoint returns 503 if either store is down, which is what a load balancer  
should poll. If it says `ok`, the backend is fully wired.

---

## 5\. Start the front end

In a second terminal:

```
cd client
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Leave `VITE_API_BASE_URL` commented out in development. Vite proxies `/api` to  
port 4000, which keeps the app same-origin and avoids a CORS preflight on every  
seat-availability poll.

Nothing in this file needs a map key. MapLibre GL draws OpenFreeMap's  
OpenStreetMap tiles, which need no signup and have no load limit, so the map  
works the moment the dev server starts. Set `VITE_MAP_STYLE` (and  
`VITE_MAP_STYLE_DARK`) only if you want a different basemap — any  
MapLibre-compatible style JSON URL will do, including one you host yourself.

### Walk through it

1.  `/` — browse published packages as a guest. No login, no prompt.
2.  Open **Pink City Heritage Trail**. Pick a date in the calendar; seat counts  
    are live, refetched on an interval rather than cached.
3.  Configure the package (AC coach, hotel tier, meal plan, photo walk). The  
    price shown is display-only — the server recomputes every total from the  
    tour's JSONB `options`, in integer paise, and the gateway signs _that_ figure.
4.  Press checkout. **This** is where login appears, and the return destination  
    travels in router state so your configuration survives the wall.
5.  A 10-minute countdown starts. That is a real Redis hold: availability is  
    `total_seats − CONFIRMED bookings − held seats`, so nobody else can take  
    those seats, and if you walk away they come back automatically.
6.  `/explore` — Personal Tour Mode. Pick a mood and a travel profile.
7.  `/admin` as the admin account — open a departure and change its capacity.

---

## 6\. Optional: real routing and the AI assistant

Both are off by default and fail politely. Turn them on when you want them.

### Routing (OSRM)

`.env.example` points at the public OSRM demo server, which is enough to see a  
real road geometry immediately. It is rate-limited, must not be used in  
production, and answers with car data whatever profile you ask for — hence  
`OSRM_PROFILE=car` alongside it.

Walking and cycling routes need your own instance. The preprocessing pass is a  
one-off and the commands are in the header of `docker-compose.yml`; it downloads  
a regional OSM extract and builds the graph, which takes a while and several GB:

```
# after the extract/partition/customize steps in docker-compose.yml
docker compose --profile routing up -d osrm
# then in server/.env
OSRM_BASE_URL=http://localhost:5000
OSRM_PROFILE=foot
```

Moods are not OSRM weights — OSRM cannot re-weight edges per request. PostGIS  
scores attractions inside the corridor between origin and destination on  
`scenic_score`, inverted `noise_score` and `crowd_score`, and the winners become  
waypoints. So a scenic route is a genuine road route that happens to detour past  
pretty things. `fastest` sends no waypoints at all.

### Assistant ("Ask the Expert")

Two independent pieces: embeddings for retrieval, and an LLM for the answer.

```
# 1. embeddings — free, local, no key
ollama pull nomic-embed-text          # serves on :11434

# 2. answer generation — free tier key from console.groq.com
#    in server/.env:
#      LLM_PROVIDER=groq
#      LLM_API_KEY=gsk_...

# 3. build the index (seeded chunks have NULL embeddings until this runs)
cd server && npm run rag:index -- --all
```

`EMBEDDING_DIM` must equal the `vector(N)` width in `0001_init.sql`. Both are 768  
because that is what `nomic-embed-text` returns. If you switch to a 1536-dim  
provider, change the migration and the env var together and re-index — pgvector  
rejects a mismatched width, and the error surfaces at index time.

Without a key the assistant returns `503 LLM_NOT_CONFIGURED` and the panel says  
so. Nothing else degrades.

### Payments (Razorpay)

Optional, and the app boots without it — checkout just reports that payments are  
not configured instead of opening a gateway window.

```
# server/.env — test-mode keys from dashboard.razorpay.com → Settings → API Keys
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
PAYMENT_CURRENCY=INR
```

Both halves are needed; if either is missing, `POST /api/bookings/:id/order`  
returns `503 PAYMENTS_DISABLED`. Test keys (`rzp_test_`) move no real money and  
the server refuses to start in production while one is set, so a booking can  
never look paid when nothing settled.

The key **id** is publishable and is handed to the browser at order time. The  
**secret** never leaves the server: it signs and verifies the callback HMAC. Do  
not add a `VITE_RAZORPAY_*` variable — the server is the only place the keys live.

How a payment is proven, in order. The server creates the Razorpay order and  
calculates the amount from the booking row, never from the browser (which is why  
`/order` accepts no body). It records that order against the booking in `payments`  
before the traveller pays. When the gateway calls back, the server checks the  
signature *and* that the order belongs to that booking, at that amount — the HMAC  
alone only proves Razorpay signed an order/payment pair, so without the second  
check a genuine callback from a cheap booking could confirm an expensive one.

Card details are typed inside Razorpay's own window. They never touch this server,  
which is what keeps the deployment in PCI-DSS SAQ-A scope.

Test cards are at dashboard.razorpay.com → Docs. Use the `success@razorpay`  
UPI/VPA handle for a passing payment and `failure@razorpay` to exercise the  
failure path.

---

## 7\. Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| `503 PAYMENTS_DISABLED` on Pay | keys absent or only one set | set both `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `server/.env`, restart the API |
| Pay button says the gateway is unreachable | `checkout.razorpay.com` blocked | an ad/script blocker or a captive-portal network; allow the domain |
| `400 SIGNATURE_INVALID` after paying | secret mismatch between server and dashboard | re-copy `RAZORPAY_KEY_SECRET`; it is shown only once at generation |
| `409 The amount on this order no longer matches` | the booking total changed after the order was created | retry — a fresh order is minted at the current price |
| `Refusing to boot in production with a Razorpay test key` | `rzp_test_` key with `NODE_ENV=production` | swap in live keys before deploying |
| `Invalid environment configuration: JWT_SECRET must be at least 24 chars` | placeholder still in place | paste a generated secret into `server/.env` |
| `Invalid environment configuration: DATABASE_URL ...` | no env file found | the file must be `server/.env` or `./.env`; check you copied it, not renamed the example in place |
| `ECONNREFUSED 127.0.0.1:5432` / `:6379` | containers not up | `docker compose ps`, then `docker compose up -d db cache` |
| `type "geometry" does not exist` | wrong Postgres image | must be `postgis/postgis:16-3.4` (plain `postgres` has neither PostGIS nor pgvector) |
| `Checksum mismatch for 0001_init.sql` | an applied migration was edited | `docker compose down -v`, bring the services back, `npm run seed` |
| `/api/health` returns 503 | one store is down | the `checks` object names which one |
| Map is blank with a "could not reach the map tiles" note | no internet, or a bad `VITE_MAP_STYLE` | clear the override to fall back to OpenFreeMap's default style |
| `Cannot read properties of undefined (reading 'Map')` | a default import of `maplibre-gl` | v6 is named exports only: `import { Map as MapLibreMap } from 'maplibre-gl'` |
| `502 OSRM_ERROR` / `504 OSRM_TIMEOUT` | routing engine unreachable or slow | check `OSRM_BASE_URL`; the demo server rate-limits |
| `503 EMBEDDING_UNAVAILABLE` | Ollama not running | `ollama serve`, or leave the assistant off |
| `503 LLM_NOT_CONFIGURED` | no LLM key | expected default; set `LLM_PROVIDER` + `LLM_API_KEY` |
| `409 Only N seat(s) left on this date` | genuinely sold out, or another session is holding them | not a bug — pick another date, or wait out the 10-minute hold |
| `410 Your seat hold expired` | the countdown ran out | start the booking again; the seats were already released |
| `409 CAPACITY_BELOW_SOLD` | admin lowered capacity under confirmed seats | raise it, or cancel bookings first |
| Vite: `Failed to resolve import` | dependencies not installed | `npm install` in `client/` |
| `npm error EBADENGINE` | Node below 20 | upgrade Node |

---

## 8\. Checks you can run yourself

```
cd server && npm run check     # parses every .js without executing it
cd server && npm test          # 8 pricing tests
cd client && npm run check     # brackets, JSX pairing, imports, api surface
cd client && npm run build     # the real production build
```

`client/scripts/checkClient.mjs` exists because this project was assembled in an  
environment with no npm registry access, so `vite build` could not be run there.  
It parses every `.js`/`.jsx` file and checks bracket balance, JSX tag pairing,  
that every relative import resolves, that every named import is genuinely  
exported, and that every `api.x()` call exists on the API client. It is a  
stand-in, not a replacement: **run** `**npm run build**` **in** `**client/**` **once** — that is  
the one check that was never executed against real tooling. The migrations have  
likewise never run against a live Postgres.