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
cp api/.env.example api/.env
cp web/.env.example web/.env
npm run install:cms
npm run dev:cms
```

Equivalent: `npm run install:all` then `npm run dev`.

| Service | URL |
| --- | --- |
| Auto Display PWA | http://localhost:4173 |
| API health | http://localhost:4100/api/health |

Vite proxies `/api` → `:4100`. With `CMS_DEV_AUTH=true` (default in `.env.example`), OTP is always `123456` and seed Auto Numbers work **without** Supabase.

### Gate test flow

1. Open http://localhost:4173
2. Auto Number `KA01AB1234` → masked mobile → OTP `123456` → **full-screen Display** (pure **black** idle until a real queue `mediaUrl` is assigned — no waiting chrome)
3. Display is **touch-locked**: taps must not show ad controls; mouse cursor stays **visible**; small **Log out** stays top-right (**Online** badge removed). Full operator chrome: top-left long-press or `/display?ops=1`
4. Try `KA02CD5678` → OTP `123456` → same display flow (one screen per auto)
5. Creatives appear only when the queue reports PLAYING **with** an `http(s)` `mediaUrl` from ad delivery / MQTT — never invented in the browser
6. Android tablets: see [ANDROID_KIOSK.md](./ANDROID_KIOSK.md) (CSS/JS cannot block system nav; MDM / Fully Kiosk required)

### Install as a PWA (Windows Chrome + Android)

Manifest: **Auto AdTech Display** / **Auto Display**, `display: fullscreen`, `orientation: landscape`, `start_url: /` (login → OTP → `/display`), icons under `web/public/icons/`, theme/background `#050e0a`. Service worker registers from production builds via `vite-plugin-pwa` + `registerSW` (`/api` = NetworkOnly; media CacheFirst).

**Installability needs a production build** (dev server has SW disabled):

```bash
cd web
npm run build
npm run preview
```

Then open http://localhost:4173

| Platform | Steps |
| --- | --- |
| **Windows / Android Chrome** | ⋮ → **Install and create shortcut** → Install / Create shortcut (native browser menu only). No in-app install card anywhere in the UI. Manifest + service worker remain so Chrome can offer install. |

Login/OTP always need network. Offline shell + `offline.html` are precached; API responses are never cached.

### Separate terminals (if you prefer)

```bash
# Terminal 1 — API
cd api && cp .env.example .env && npm install && npm run start:dev

# Terminal 2 — Web
cd web && cp .env.example .env && npm install && npm run dev
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

## Env vars

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | API | Server-side Auth + DB (never in browser) |
| `CMS_DEV_AUTH` | API | `true` = OTP `123456` + in-memory seed |
| `REDIS_URL` | API | Cache OTP challenges / sessions / dashboard |
| `CORS_ORIGIN` | API | Allowed web origins |
| `VITE_API_URL` | Web | Empty for same-origin or Vite proxy |

## Migration note

Source was extracted from `balappa-gouda/niyoads-admin-patch` branch `cursor/cms-milestone-1-gate-707b`.
After you create the real `niyoads-cms` remote and verify locally, **close PR #1** on `niyoads-admin-patch` (do not merge CMS into platform). See [MIGRATE_NOTE.md](./MIGRATE_NOTE.md).
