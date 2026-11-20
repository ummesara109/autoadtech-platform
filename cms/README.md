# Auto AdTech CMS (Milestone 1) — local only

Vehicle **Auto Display** PWA (**Auto AdTech Display** / **Auto Display**): **Auto Number → OTP → full-screen signage** (one screen per auto).

This tree is a **standalone local copy** prepared for a future `niyoads-cms` repo.
**Do not push or deploy from this copy until you create that remote and approve publish.**

| Piece | Path | Stack |
| --- | --- | --- |
| API | `api/` | NestJS + **Fastify** (no Express), Redis cache, Supabase Auth OTP |
| Web | `web/` | React + TypeScript + Vite + Tailwind + fullscreen Auto Display PWA |
| Schema | `supabase/migrations/` | PostgreSQL + RLS |
| Compose | `docker-compose.yml` | API + Redis + PWA |

MQTT / ad delivery / live GPS stay **outside** this NestJS app — see [MQTT_SEAM.md](./MQTT_SEAM.md).

## Prerequisites

- Node.js **22+** (18+ may work; CI targets 22)
- npm
- Optional: Docker Desktop (for compose) / Redis (API falls back to in-memory if Redis is down)

## Quick start (Windows / macOS / Linux)

From this folder (`niyoads-cms`):

```bash
npm install
npm run install:cms
npm run dev:cms
```

There are no checked-in `.env.example` files. For local seeded sign-in, no API or web
`.env` file is required. To use Supabase, create `api/.env` with the server-side
credentials and set `CMS_DEV_AUTH=false`; never put the service-role key in the web
environment.

| Service | URL |
| --- | --- |
| Auto Display PWA | http://localhost:4173 |
| API health | http://localhost:4100/api/health |

Vite proxies `/api` → `:4100`; the API applies the same global `api` prefix used by
the frontend. With `CMS_DEV_AUTH=true`, the local OTP is `123456` and the seeded Auto
Numbers work without Supabase. Do not use this mode for production.

### Gate test flow

1. Open http://localhost:4173
2. Auto Number `KA01AB1234` → masked mobile → OTP `123456` → **full-screen Display**. Local dev-auth may seed sample demo ads; with Supabase-backed auth, the display stays black until a real queue item with a `mediaUrl` is assigned.
3. Display is **touch-locked**: taps must not show ad controls; mouse cursor stays **visible**; small **Log out** stays top-right (**Online** badge removed). Full operator chrome: top-left long-press or `/display?ops=1`
4. Try `KA02CD5678` → OTP `123456` → same display flow (one screen per auto)
5. Creatives appear only when the queue reports PLAYING **with** an `http(s)` `mediaUrl` from ad delivery / MQTT — never invented in the browser
6. Android tablets: see [ANDROID_KIOSK.md](./ANDROID_KIOSK.md) (CSS/JS cannot block system nav; MDM / Fully Kiosk required)

### Install as a PWA (Windows Chrome + Android)

Manifest: **Auto AdTech Display** / **Auto Display**, `display: fullscreen`,
`orientation: landscape`, `start_url: /` (login → OTP → `/display`), icons under
`web/public/icons/`, theme/background `#050e0a`. `vite-plugin-pwa` registers the
service worker; dev mode enables a development worker, but use a production build
for final install/offline validation. `/api` responses and video creatives use
NetworkOnly; assigned creative images use CacheFirst. The offline shell and icons
are precached.

**Use a production build for final installability checks** (the dev server uses a
development service worker and hot reload):

```bash
cd web
npm run build
npm run preview
```

Then open http://localhost:4173

| Platform | Steps |
| --- | --- |
| **Windows / Android Chrome** | Use the login-page **Install app** hint when Chrome exposes the install prompt, or Chrome’s ⋮ → **Install app** / **Create shortcut** menu. |

Login/OTP and live GPS always need network. Offline shell + `offline.html` are
precached; API responses and video creatives are never cached. Browser GPS requires
a secure context (HTTPS, or localhost) and explicit location permission.

### Separate terminals (if you prefer)

Install once from the CMS root:

```bash
npm install
npm run install:cms
```

Then start each service from the CMS root in its own terminal:

```bash
# Terminal 1 — API
npm run start:dev --prefix api
```

```bash
# Terminal 2 — Web
npm run dev --prefix web
```

## Docker (optional)

```bash
docker compose up --build
```

- PWA: http://localhost:8088  
- API: http://localhost:4100  

## Supabase (later / production OTP)

Not required for local gate testing with `CMS_DEV_AUTH=true`.

1. Run migrations in the Supabase SQL editor:
   - `supabase/migrations/202603140001_cms_milestone1.sql`
   - `supabase/migrations/202603140002_cms_seed_dev.sql` (dev only)
2. Enable **Phone** provider in Supabase Auth.
3. Set on the API:

```env
CMS_DEV_AUTH=false
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
REDIS_URL=redis://...
```

## API routing and environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | API | Server-side Auth + DB (never in browser) |
| `CMS_DEV_AUTH` | API | `true` = OTP `123456` + in-memory seed |
| `REDIS_URL` | API | Cache OTP challenges / sessions / dashboard |
| `CORS_ORIGIN` | API | Allowed web origins |
| `ADMIN_GPS_URL` / `ADMIN_API_URL` | API | Admin API origin for server-to-server GPS forwarding |
| `CMS_GPS_INGEST_KEY` | API | Admin ingest secret; never exposed to the PWA |
| `VITE_API_URL` | Web | API origin; leave empty for same-origin `/api` or the Vite proxy |
| `VITE_NATIVE_API_URL` | Web/native build | HTTPS Nest API origin for the Capacitor Android GPS service |

Development API routes are forwarded by Vite from `/api/*` to
`http://127.0.0.1:4100/api/*`. In Docker, Nginx serves the PWA and proxies the same
`/api/*` path to the Nest service. For a separate web/API deployment, set
`VITE_API_URL` to the Nest API origin and allow the web origin in `CORS_ORIGIN`.
Capacitor builds also need the API origin allowed by CORS for WebView login and
dashboard requests.

## Migration note

Source was extracted from `balappa-gouda/niyoads-admin-patch` branch `cursor/cms-milestone-1-gate-707b`.
After you create the real `niyoads-cms` remote and verify locally, **close PR #1** on `niyoads-admin-patch` (do not merge CMS into platform). See [MIGRATE_NOTE.md](./MIGRATE_NOTE.md).
