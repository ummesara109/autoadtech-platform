# Unified NiyoAds CMS

The `cms/` directory is the single application root. NestJS serves the built Vite
PWA and all API endpoints from the same origin. During development, one root command
starts NestJS and Vite together; Vite proxies `/api` to NestJS.

## Structure

```text
cms/
├── src/                         # NestJS/Fastify API source
├── test/                        # NestJS API tests
├── api/
│   └── [...path].ts              # Single Vercel function for all NestJS API routes
├── api-legacy/                   # Retained standalone API project, outside Vercel's function directory
├── frontend/
│   ├── src/                     # React/Vite PWA source
│   ├── public/                  # PWA icons, offline page, local demo creatives
│   ├── android/                 # Capacitor Android application
│   ├── scripts/
│   ├── index.html
│   ├── vite.config.mts
│   ├── tsconfig*.json
│   └── capacitor.config.json
├── plugins/niyoads-silent-gps/  # Capacitor workspace dependency
├── supabase/migrations/         # Existing CMS schema migrations
├── android-companion/           # Native GPS documentation
├── tools/
├── package.json                 # Unified CMS commands and dependencies
├── .env                         # Local server/Vite configuration; ignored by Git
├── Dockerfile
└── docker-compose.yml
```

`plugins/niyoads-silent-gps` remains a local workspace package used by Capacitor; it
is not a separately run CMS application. API and frontend source do not have their
own package manifests or install commands.

## Requirements and local development

- Node.js 22+
- npm

From the CMS root:

```powershell
cd C:\Users\DELL\Downloads\niyoads-platform-modules\cms
npm install
npm run dev
```

The unified development command starts both development servers:

| Service | URL |
| --- | --- |
| Vite PWA | http://localhost:4173 |
| NestJS API health | http://localhost:4100/api/health |

Vite forwards `/api/*` to NestJS on port 4100. In Docker/Node production, NestJS
serves `frontend/dist` and handles the SPA fallback for frontend routes. Requests
under `/api` are excluded from that fallback.

For the Vercel CMS project, set **Root Directory** to `cms`. Its `vercel.json`
builds the same frontend and NestJS sources, serves `frontend/dist` as static
output, and rewrites all `/api/*` requests through one serverless function. That
function boots the same `AppModule`, controllers, guards, validation, and CORS
configuration as the regular NestJS server. The old standalone project is kept
under `api-legacy/` so Vercel does not treat its source files as separate functions.

Set the CMS server environment variables in the Vercel project settings. Keep
`VITE_API_URL` empty for the browser PWA so it uses same-origin `/api` requests.
Set `CORS_ORIGIN` to the allowed browser origins when the API is called cross-origin.

For local seeded login, set `CMS_DEV_AUTH=true`; the local OTP is `123456`. Do not
use development authentication or demo creatives in production. To use Supabase,
put the API credentials in the ignored CMS-root `.env` file and set
`CMS_DEV_AUTH=false`. The Supabase service-role/secret key must remain server-side.

## Production build and run

From the CMS root:

```powershell
npm run build
npm start
```

The build compiles the Capacitor plugin, builds the PWA into `frontend/dist`, and
builds the NestJS API into `dist`. NestJS then serves both the PWA and `/api/*` on
port 4100. Set `PORT` to change the listening port.

## PWA and Android

The existing manifest, icons, fullscreen behavior, service worker, offline shell,
and install hint remain under `frontend/`. API responses and video creatives are
NetworkOnly; assigned creative images use the existing image cache. Login and OTP
require network access. Browser GPS requires HTTPS (or localhost) and location
permission.

For a production PWA install check:

```powershell
npm run build
npm run preview
```

For Android, set `VITE_NATIVE_API_URL` in the root `.env` to the reachable NestJS
API origin, then run:

```powershell
npm run build:android
npm run android:open
```

Background tracking must be verified on a real Android device with location and
notification permissions. See [ANDROID_KIOSK.md](./ANDROID_KIOSK.md) and
[android-companion/README.md](./android-companion/README.md).

## Docker

From the CMS root:

```powershell
docker compose up --build
```

The same NestJS container serves both UI and API:

- PWA: http://localhost:8088
- API health: http://localhost:4100/api/health

Redis is included for OTP challenges and session caching. Set production Supabase,
Admin GPS, and internal-key environment variables before using a deployed
environment.

## Environment variables

The API reads server configuration from the process environment or root `.env`.
Vite also reads root `.env`, but only `VITE_*` variables are included in browser
builds.

| Variable | Purpose |
| --- | --- |
| `PORT` | NestJS listening port (default `4100`) |
| `CORS_ORIGIN` | Comma-separated allowed browser origins |
| `SUPABASE_URL` | Existing Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | Server-side Supabase access |
| `CMS_DEV_AUTH` | Local development OTP/seed mode |
| `REDIS_URL` | OTP/session/dashboard cache |
| `CMS_INTERNAL_KEY` | Protects internal ad-queue endpoints |
| `ADMIN_GPS_URL` / `ADMIN_API_URL` | Admin API origin for CMS GPS forwarding |
| `CMS_GPS_INGEST_KEY` | Server-to-server Admin ingest key |
| `ADMIN_GPS_RETRY_MS` / `ADMIN_GPS_FORWARD_INTERVAL_MS` | GPS retry cadence |
| `CMS_GPS_ONLINE_MS` | Admin live-location online threshold |
| `VITE_API_URL` | Optional API origin; leave empty for same-origin/proxy routing |
| `VITE_NATIVE_API_URL` | NestJS origin used by the Android GPS foreground service |
| `VITE_GPS_POST_INTERVAL_MS` | Optional browser GPS reporting interval |

Never commit `.env` or expose Supabase/Admin secrets through a `VITE_*` variable.

## Supabase

The application continues using the existing Supabase schema and migrations. Apply
the migrations in `supabase/migrations/` to the existing project; do not create
duplicate tables. Production OTP requires Supabase Phone Auth to be enabled and
`CMS_DEV_AUTH=false`.

## Validation

```powershell
npm run build
npm test -- --runInBand
npm run lint
```

The production run uses one CMS process and one origin. Development uses Vite and
NestJS as two processes managed by the root `npm run dev` command.
