# AdTech Platform – Admin + Client portals (Node.js backend)

## Run in VS Code
1. Install Node.js 16 or newer (https://nodejs.org).
2. File > Open Folder... and choose this folder.
3. Open the terminal (Ctrl + `) and run:

       npm start

   (or press F5 and pick "Run AdTech server").
4. Open http://localhost:3000

No `npm install` is needed – the backend has zero dependencies.
The live map loads Leaflet and OpenStreetMap tiles from the internet, so keep your connection on.

## Demo logins
| Portal | Email | Password |
|---|---|---|
| Admin | admin@adtech.in | Admin@123 |
| Client | ads@abc.com | Client@123 |

Other admin users (password Admin@123): amit@adtech.in (Admin), priya@adtech.in (Manager), sneha@adtech.in (Support), rahul@adtech.in (Viewer – inactive).
Other clients (password Client@123): ads@techglobal.com, hello@futurebrands.com, ads@megamedia.com. ads@dreamads.com is "Pending" and cannot sign in until an admin approves it.
New users and advertisers get the password you type in the Add form.

## What is included
- Landing page: choose Admin or Client, then sign in.
- Admin portal: users, advertisers, drivers/partners, vehicles (Bengaluru areas), devices, campaigns (approve/reject), packages, live monitoring, analytics, billing (CSV export), support, audit logs, settings.
- Client portal: own dashboard, own campaigns (create / edit / delete while Pending), ad packages, own invoices, support tickets. The server only returns the client's own data.
- Click any row to open a details panel (linked campaigns, vehicle, driver, device, activity...).
- Roles: Viewer is read-only; only Super Admin and Admin can manage users; only Super Admin can reset data.
- Live monitoring: backend simulates GPS for online devices around their vehicle's area and the map polls every 3 seconds.

## Viewing a client's portal (admin)
The landing page shows a single Admin sign-in form. Clients are viewed by admins (see below).

After signing in as admin you can open any client's portal **without signing in as that client**:
- Management > **Advertisers**: click the eye icon on a row (or open the row and press "View client portal"), or
- Overview > **Client Logins**, or the **Client portal** button in the top bar.

The client's dashboard, campaigns, packages, billing and support open in **view-only mode**. Your admin name, role and session stay active the whole time (shown in the sidebar and a banner), and no client token is ever created. Press **Back to admin** to return. Each view is recorded in the Audit Logs.
**Client Logins** also lists every client's last login, total logins and a history of recent client sign-ins (time and IP).

## Device Management (player heartbeat — not phone GPS)
Admin → **Device Management** manages advertising display lifecycle (register, credentials, heartbeat online status, config, commands).  
Phone GPS / Live Monitoring remains separate (`/api/cms/gps`, `/api/live`).

- SQL (apply manually): `sql/ADMIN_DM_APPLY.md`
- Local fallback store: `data/admin-dm.json` until Supabase `admin_dm_*` tables exist
- E2E (controlled local sim): `./scripts/test-dm.sh`
- Device auth: `POST /api/dm/device/auth` → `POST /api/dm/device/heartbeat`

## CMS demo OTP (local development and protected Preview)

For local testing, set `CMS_DEV_AUTH=true` in both `admin/.env` and `cms/.env`, then restart both servers. To enable Production demo OTP, set `CMS_DEV_AUTH=true` in the Production environment variables of both Vercel projects and redeploy. The default allowlist is `KA01AB1234,KA02CD5678`; optionally set `CMS_DEMO_VEHICLES` in both projects to override it.

Set `SUPABASE_URL` and either `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` server-side in both Vercel projects, pointing to the same Supabase project. Never expose the secret key through a `VITE_*` variable. Keep `ADMIN_GPS_URL` and `CMS_GPS_INGEST_KEY` configured for the existing CMS-to-Admin GPS forwarding, and apply the existing CMS vehicle/location and Admin GPS migrations to that project.

Demo OTP is restricted to allowlisted vehicles that are registered in Supabase and have an active operator and assigned screen. Demo login does not require an actual phone and does not send SMS. It does not expose the Supabase service key or open internal queue/fleet endpoints. Configure `REDIS_URL` in the CMS Vercel project for shared OTP state and rate limiting. Keep `SUPABASE_URL` plus `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) server-side in both projects.

For live SMS OTP, set `CMS_DEV_AUTH=false` in both projects. Enable **Authentication → Sign In / Providers → Phone**, configure an SMS provider and its server-side credentials, and confirm the provider can deliver to Indian `+91` mobile numbers. Do not configure Supabase test-phone OTPs in Production. Non-demo vehicles require a valid operator phone on the vehicle or its assigned partner; numbers are normalized to `+91` before Supabase Auth sends the code.

After deploying this flow, re-save existing Admin vehicle records so their CMS vehicle/operator/screen rows and phone mapping are synchronized. If an assigned partner supplies the phone, updating that partner also refreshes the linked CMS vehicle. Remove any existing Supabase test-phone mappings for Production operator numbers.

## Connect real devices (live GPS)
Legacy shared-key GPS for Live map markers (not Device Management auth):

    curl -X POST http://localhost:3000/api/device-location \
      -H "Content-Type: application/json" \
      -d '{"key":"device-secret","dev":"DEV-001","lat":12.9172,"lng":77.6228,"speed":24}'

Change the key with an environment variable: `DEVICE_KEY=mysecret npm start`.

## Backend API (JSON, Bearer token)
POST /api/login · GET /api/client-logins (admin) · GET /api/client-view/:clientId (admin, read-only) · GET /api/bootstrap · GET/POST /api/:collection · PUT/DELETE /api/:collection/:id · GET /api/live · PUT /api/settings · POST /api/reset · `/api/dm/*` (Device Management)
Collections: users, advertisers, partners, vehicles, devices, campaigns, inventory, billing, support.

## Data
Stored in `data/db.json` (created on first run). Passwords are hashed with scrypt; sessions are signed tokens valid for 12 hours.
Delete the `data` folder to start from fresh sample data. Use PORT=4000 to change the port.

## Files
- `server.js` – HTTP server, auth, REST API, live simulation, JSON storage
- `public/index.html`, `public/styles.css`, `public/app.js` – the front end
