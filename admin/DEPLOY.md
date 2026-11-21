# Vercel deploy (required settings)

Login fails with `NOT_FOUND` when Vercel only publishes the static UI and skips `/api`.

## Project settings (must match)

In Vercel → Project → **Settings → General**:

| Setting | Value |
| --- | --- |
| **Root Directory** | `admin` (this is a monorepo; do not use the repository root or `public`) |
| **Framework Preset** | Other |
| **Build Command** | leave empty |
| **Output Directory** | leave empty — **not** `public` |
| **Install Command** | `npm install` (default) |

In **Settings → Environment Variables** (Production):

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)
- optional: `AUTH_SECRET`, `DEVICE_KEY`
- **`CMS_GPS_INGEST_KEY`** — shared secret for CMS Nest → `POST /api/cms/gps` (server-to-server only; never put in `public/`)
- optional: `CMS_GPS_ONLINE_MS` (stale/online threshold, default 90000)
- For temporary demo testing of only `KA01AB0000`, set `CMS_DEMO_AUTH=true` and `CMS_DEV_AUTH=false` in both Admin and CMS Vercel Production environments, then redeploy. CMS verifies the vehicle, active operator, and screen assignment from Supabase; this path does not need an operator phone, SMS, or Redis.
- Set `CMS_DEMO_AUTH=false` in both projects and redeploy to disable temporary demo login. Keep `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) server-side in both projects.
- Configure `REDIS_URL` in the CMS Vercel project for the separate live SMS OTP challenge and rate-limit flow.
- For live SMS OTP instead, set `CMS_DEV_AUTH=false` in both projects, enable Supabase Phone Auth, configure an SMS provider that supports Indian `+91` numbers, and provision a valid operator phone on each non-demo vehicle or its assigned partner.
- optional: `DISABLE_LIVE_SIM=true` / never set `ALLOW_LIVE_SIM` in production (no dummy map movement)

Apply non-destructive SQL once on Admin Supabase:

- `sql/202603180001_cms_admin_gps.sql` (`vehicle_cms_link` + `cms_admin_vehicle_gps` + Realtime publication best-effort)

Then **Deployments → … → Redeploy**.

## Live Monitoring (Phase 2)

After deploy, open **Live Monitoring**: markers should move as CMS posts GPS (UI polls `/api/live` every second). Confirm Online/Stale/Offline and Auto Number on a mapped plate. Do **not** set `ALLOW_LIVE_SIM` in production.

## Verify

1. Open `https://YOUR-APP.vercel.app/` — login page
2. Open `https://YOUR-APP.vercel.app/api` — should **not** be Vercel NOT_FOUND HTML
3. Sign in: `admin@adtech.in` / `Admin@123`
4. Live Monitoring shows CMS GPS fields when Nest is forwarding
