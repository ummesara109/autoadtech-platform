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
│   └── tsconfig*.json
├── plugins/niyoads-silent-gps/  # Capacitor workspace dependency
├── supabase/migrations/         # Existing CMS schema migrations
├── android-companion/           # Native GPS documentation
├── tools/
├── capacitor.config.json         # Capacitor config; points to frontend/ and frontend/android/
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
Production CORS is same-origin by default; set `CORS_ORIGIN` to a comma-separated
allowlist only when the API must be called cross-origin.

For the in-memory local sample login, set `CMS_DEV_AUTH=true`; the existing
seeded Auto Numbers are `KA01AB1234` and `KA02CD5678`, and the local OTP is
`123456`. To test real registered fleet vehicles locally, set
`NODE_ENV=development`, `CMS_DEV_AUTH=true`, and
`CMS_LOCAL_AUTO_NUMBER_AUTH=true`. This additional opt-in is accepted only by a
non-Vercel development server. It still requires the Auto Number to exist in the
CMS vehicle/operator registry and an active `vehicle_cms_link` to an active
Admin display device and the vehicle's active CMS screen. No vehicle, device,
operator, or screen is created by login. Disable the option with
`CMS_LOCAL_AUTO_NUMBER_AUTH=false` when finished.

For temporary Production testing, set `CMS_DEMO_AUTH=true` in both the CMS and
Admin Vercel projects. The existing `KA01AB0000` flow and OTP are unchanged. For
`KA01AB0001`–`KA01AB0004`, configure the matching server-only CMS environment
variables `CMS_DEMO_OTP_KA01AB0001`, `CMS_DEMO_OTP_KA01AB0002`,
`CMS_DEMO_OTP_KA01AB0003`, and `CMS_DEMO_OTP_KA01AB0004` with six-digit values.
Do not put these variables in `VITE_*` settings, frontend code, or API responses.
The CMS checks each secret only against a challenge bound to that registered
vehicle; unset or malformed values fail closed. Keep `CMS_DEV_AUTH=false` in
Production.

All five vehicles must exist in the configured Supabase registry and have an
active operator and exactly one assigned active CMS screen. All five demo
challenges use the existing signed, stateless flow and do not require Redis or
send Supabase SMS. Challenges expire after five minutes; resend and verification
attempt limits are enforced by the CMS process, with five incorrect attempts
blocked per challenge. Issue, failure, expiry, lockout, and success events are
written to CMS server logs without logging OTP values. Since Vercel functions
may run in separate or restarted processes, these in-memory limits are
best-effort and are not a globally shared lockout. These demo credentials are
for controlled testing, not real-driver authentication. They use the existing
CMS session and GPS flow. Disable demo mode after testing with
`CMS_DEMO_AUTH=false` and redeploy. The Supabase service-role/secret key must
remain server-side.

Temporary Production demo PWA sessions for all five designated vehicles do not
validate the Admin display-device mapping or lifecycle status. They still
require an active CMS vehicle, operator, and assigned active screen. This only
bypasses the Admin-device check during demo authentication; it does not
reactivate a device or guarantee that a physical display or Admin GPS mapping is
available. Normal Production SMS sessions continue to require an active
Admin-device mapping.

Production demo playback is separate from demo authentication. After successful
authentication, the existing two-ad demo rotation
(`/test-ad-restaurant.mp4` and `/ad2-bbq-catering.mp4`) may be seeded only for
`KA01AB0000`–`KA01AB0004`, and only when that vehicle's already-assigned screen
has no playing or queued ad. `KA01AB0001`–`KA01AB0004` use their configured demo OTP only while
`CMS_DEMO_AUTH=true`; with the flag off, they continue through normal SMS OTP.
`CMS_DEMO_VEHICLES` does not enable Production demo OTP.
This does not create vehicle, device, or screen mappings.

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
| `CMS_DEV_AUTH` | Local/Preview seed authentication; keep `false` in Production |
| `CMS_LOCAL_AUTO_NUMBER_AUTH` | Extra local-only OTP mode for existing registered vehicles; requires `NODE_ENV=development`, `CMS_DEV_AUTH=true`, and no Vercel environment |
| `CMS_DEMO_AUTH` | Temporary demo OTP switch for the five designated plates; set `false` and redeploy to disable |
| `CMS_DEMO_OTP_KA01AB0001`–`CMS_DEMO_OTP_KA01AB0004` | Server-only six-digit OTP secrets for the four additional registered demo vehicles |
| `CMS_DEMO_VEHICLES` | Optional comma-separated demo plate allowlist; defaults to `KA01AB1234,KA02CD5678` |
| `REDIS_URL` | Shared OTP/session/dashboard cache; required for live SMS OTP, not for the five signed demo OTP flows |
| `CMS_INTERNAL_KEY` | Protects internal ad-queue endpoints |
| `ADMIN_GPS_URL` / `ADMIN_API_URL` | Admin API origin for CMS GPS forwarding |
| `CMS_GPS_INGEST_KEY` | Server-to-server Admin ingest key |
| `ADMIN_GPS_RETRY_MS` / `ADMIN_GPS_FORWARD_INTERVAL_MS` | GPS retry cadence |
| `CMS_GPS_ONLINE_MS` | Admin live-location online threshold |
| `VITE_API_URL` | Optional API origin; leave empty for same-origin/proxy routing |
| `VITE_NATIVE_API_URL` | NestJS origin used by the Android GPS foreground service |
| `VITE_GPS_POST_INTERVAL_MS` | Optional browser GPS reporting interval |

Never commit `.env` or expose Supabase/Admin secrets through a `VITE_*` variable.

For temporary Production demo OTP, set `CMS_DEMO_AUTH=true` and `CMS_DEV_AUTH=false`
in the **Production** environment of both Vercel projects. Set the four
`CMS_DEMO_OTP_KA01AB0001` through `CMS_DEMO_OTP_KA01AB0004` values only in CMS
server environment settings; keep them out of Admin frontend/build variables.
The Admin backend uses `CMS_DEMO_AUTH` for phone-less provisioning of the five
designated plates; the CMS backend reads the flag and OTP secrets at runtime
through Nest `ConfigModule`. All five vehicles use the existing signed,
short-lived HttpOnly demo session cookie and do not require Redis. Redeploy both projects after changing
environment variables. After testing, set `CMS_DEMO_AUTH=false` and redeploy to
disable these demo login paths before real drivers use the app.
Provide `SUPABASE_URL` and either `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY` server-side in both projects, pointing to the same project.
The CMS project needs a reachable shared `REDIS_URL` for live SMS OTP. The
five temporary demo OTP flows do not use Redis. Leave
`VITE_API_URL` empty for same-origin `/api` routing. Never expose a service key,
SMS credentials, the demo flag, or phone number through a `VITE_*` variable.

Ensure `KA01AB0000` exists in `cms_vehicles`, has an active row in
`cms_operators`, and has exactly one active assigned screen in
`cms_screen_assignments`/`cms_screens`. An actual phone number is not needed for
this demo vehicle. Admin can provision it without one when `CMS_DEMO_AUTH=true`;
other vehicles still use the configured live OTP path and require a valid phone
when SMS is enabled. Partner changes continue to refresh the linked CMS vehicle.
No schema migration is required for this mode.

For future live SMS operation, set `CMS_DEV_AUTH=false` in both projects. Enable
**Authentication → Sign In / Providers → Phone** in the shared Supabase project
and configure an SMS provider with valid credentials and India delivery enabled.
Verify sender ID/template requirements and Supabase Auth SMS rate limits with the
provider. Live operator phones are normalized to `+91` before Supabase Auth sends
SMS. Do not configure Supabase test-phone OTPs for Production.

For protected Vercel Preview-to-Preview GPS forwarding, enable **Protection Bypass
for Automation** in the Admin Vercel project. In the CMS Vercel project, set these
server-side variables for **Preview only**:

| Variable                                 | Value                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `ADMIN_GPS_PREVIEW_URL`                  | Admin branch Preview alias, such as `https://admin-git-branch-team.vercel.app` |
| `ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET` | The Admin project's generated Vercel automation bypass secret                  |
| `CMS_GPS_INGEST_KEY`                     | Same server-to-server ingest key configured in Admin                           |

CMS sends `x-vercel-protection-bypass` only when `VERCEL_ENV=preview` and the
explicit HTTPS Admin branch Preview alias (`*.vercel.app` with `-git-` in the
hostname) is configured; production-style URLs are not eligible. It continues sending
`x-cms-ingest-key`; Admin validates that key before accepting GPS or persisting it
to Supabase. Keep `ADMIN_GPS_URL` for the regular/Production Admin origin. The
bypass secret is a server-side credential: never use a `VITE_*` variable or expose
it to the browser. Production CMS requests never include the Preview bypass header.

## Supabase

The application continues using the existing Supabase schema and migrations. Apply
the migrations in `supabase/migrations/` to the existing project; do not create
duplicate tables. For campaign delivery, apply
`202611230001_campaign_queue_idempotency.sql` after the queue schema migration;
it makes retries idempotent by screen and campaign ID without changing legacy
queue rows. Production demo login requires registered vehicle/operator/screen
rows and server-side Supabase credentials. Supabase Phone Auth and an SMS
provider are required only when `CMS_DEV_AUTH=false` and live SMS OTP is used.

## Validation

```powershell
npm run build
npm test -- --runInBand
npm run lint
```

The production run uses one CMS process and one origin. Development uses Vite and
NestJS as two processes managed by the root `npm run dev` command.
