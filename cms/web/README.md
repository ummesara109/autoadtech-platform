# Auto AdTech Display — web PWA

React + TypeScript + Vite + Tailwind + `vite-plugin-pwa`.

| Manifest field | Value |
| --- | --- |
| `name` | **Auto AdTech Display** |
| `short_name` | **Auto Display** |
| `display` | `fullscreen` (override: fullscreen → standalone → minimal-ui) |
| `orientation` | `landscape` |
| `start_url` / `scope` | `/` (login → OTP → `/display`) |
| Icons | `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` |
| Theme / background | `#050e0a` |

## Dev

From repo root (preferred):

```bash
npm run install:cms
npm run dev:cms
```

Or here:

```bash
cp .env.example .env
npm install
npm run dev
```

UI: http://localhost:4173 (proxies `/api` → Nest `:4100`). Override with `VITE_PORT=3002` or `npm run dev -- --port 3002`.

Dev enables the service worker (`devOptions.enabled: true`) so Chrome can offer Install over an HTTPS tunnel. Prefer `npm run build && npm run preview` for production install checks.

## Production build (installable)

```bash
npm run build
npm run preview
```

`registerSW` in `src/main.tsx` registers the generated worker (`autoUpdate`). Precache covers the app shell + `offline.html`. **All `/api/*` requests are NetworkOnly** — OTP, tokens, and dashboard JSON are never written to Cache Storage. Creative media uses CacheFirst (`cms-ad-media-v1`).

## Install

- **Android Chrome (HTTPS):** Login page **Install app** (real `beforeinstallprompt`) or ⋮ → Install app  
- **iOS Safari (HTTPS):** Share → Add to Home Screen  
- **Local HTTP:** install criteria usually fail — use Cloudflare Tunnel / ngrok  
- Display kiosk (`/display`) stays chrome-free; install UX is on Login only  

See [ANDROID_KIOSK.md](../ANDROID_KIOSK.md) and Project doc `cms-display-pwa-install.md`.
