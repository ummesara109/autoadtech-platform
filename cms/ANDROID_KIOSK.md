# Android kiosk setup — Auto AdTech Display

The PWA can run **immersive fullscreen** (`manifest.display: fullscreen`, landscape, no in-app playback controls). **CSS/JS alone cannot block Android system navigation** (Home, Recents, status bar, gesture nav). Use one of the options below on the vehicle tablet.

## What the web app already does

- Fullscreen PWA display mode + landscape orientation preference (`name` / `short_name`: Auto AdTech Display / Auto Display)
- Native Capacitor Android build is landscape-locked, reapplies immersive fullscreen on resume/focus, and keeps the display awake while the player is open
- **Idle = pure black** (no waiting chrome, logo, or location strip on the passenger stage)
- Small **Log out** always top-right (**Online** badge removed); mouse cursor stays **visible**
- Automatic playback of queue `mediaUrl` only (no invented creatives); video `ended` / image dwell → `POST /api/queue/player/complete` advances the queue
- No tap-to-show playback / ad controls; media has `pointer-events: none`
- Soft `beforeunload` / history guard (honest limit: user/agent can still leave; OS Home always wins)
- Operator chrome on `/display` (Lock / Log out — no install card on the kiosk surface; Login may show a real Install button via `beforeinstallprompt`):
  - **Top-left corner long-press** (~2.8s), or
  - URL query: `/display?ops=1`
- **CSS/JS cannot block Android system navigation** — use MDM / Fully Kiosk below

## Native playback and offline behavior

- The Android app uses the same authenticated DisplayScreen and server queue; it does not create a second player or queue.
- The player polls for queue changes, reports a heartbeat while online, and retries queued playback acknowledgements after reconnecting.
- Images use the existing service-worker cache. Videos are downloaded only by the native Android app to its private app storage, for assigned, unexpired queue items, and only when the server provides a known size no greater than 100 MiB. Video files are not put in Cache Storage, preserving normal online HTTP Range playback.
- A web-only PWA does not persist complete video files for offline playback. Native video downloads require enough app storage and a successful download before connectivity is lost.
- Queue expiry is enforced from persisted campaign metadata while offline and on the next server sync. Removed/expired native video files are cleaned up as the queue refreshes.
- `MainActivity` fullscreen and keep-awake flags do not provide lock-task security, process restart, or app boot autostart. The existing GPS boot receiver only restarts GPS tracking; it does not launch the display activity. Configure MDM / Fully Kiosk to relaunch the app after reboot or crash.
- The existing silent GPS foreground service is unchanged.

Build and synchronize the native Android project from the `cms` directory with `npm run build:android`, then build/install the generated Android project using Android Studio or Gradle.

## Required: lock the device outside the browser

Pick **one** production path:

### 1) Android Enterprise / MDM locked task (recommended)

1. Enroll the tablet as **managed device** (device-owner / work-managed) via your MDM (Intune, Mosyle, Esper, Hexnode, etc.).
2. Install Chrome or a managed WebView browser; allow only the Display PWA origin.
3. Enable **Lock task mode** / **Dedicated device** / **Single-app kiosk** for that browser or a WebView wrapper.
4. Hide status bar & navigation bar via MDM kiosk policy.
5. Disable: notifications, multi-window, screen pin exit, factory reset (as policy allows), unknown sources.
6. Pin orientation to **landscape**.
7. Set the start URL to your hosted Display origin (or local LAN URL) and auto-launch on boot.

### 2) Fully Kiosk Browser (common for signage)

1. Install [Fully Kiosk Browser](https://www.fully-kiosk.com/) on the tablet.
2. Set **Start URL** to the Auto Display PWA URL.
3. Enable **Kiosk Mode**, **Fullscreen**, **Hide navigation bar**, **Disable pull-down**, **Disable volume keys** (as needed).
4. Enable **Autostart** + **Restart after crash**.
5. Optionally use Fully’s **device-owner** / motion detection features; set a **PIN** for settings exit.
6. Turn on **Screen orientation → Landscape**.

### 3) Screen pinning (weak / temporary only)

Android **Screen pinning** can pin Chrome, but passengers can often unpin with Back+Overview. **Do not rely on this for revenue displays.** Prefer MDM or Fully Kiosk.

## Install the PWA (immersive chrome)

Production build required for the service worker (`cd web && npm run build && npm run preview`). Dev mode does not register SW.

1. Open the Display origin in **Chrome** (http://localhost:4173 locally, or your hosted URL).
2. **Chrome (HTTPS):** Login → **Install app** (when offered) or ⋮ → Install app. iOS Safari: Share → Add to Home Screen.
3. Launch from the installed **Auto Display** icon (`display: fullscreen`, `orientation: landscape` when the OS honors the manifest). `start_url` is `/` → login/OTP → `/display`.
4. Still pair with MDM / Fully — installed PWAs do **not** remove Android system nav by themselves.

## Operator access on a locked unit

| Action | How |
| --- | --- |
| Log out | Small **Log out** top-right (always) |
| Lock / operator chrome | Top-left long-press **or** open `/display?ops=1` |
| Install PWA | Chrome ⋮ → **Install and create shortcut** (not in the web UI) |
| Exit OS kiosk | MDM admin PIN / Fully Kiosk settings PIN — **not** available in the web UI |

## Honesty limits

| Layer | Blocks passenger ad controls? | Blocks Android Home / Recents? |
| --- | --- | --- |
| Display PWA (this app) | Yes | **No** |
| Browser fullscreen API | Partial | **No** |
| Fully Kiosk / MDM lock-task | Yes | **Yes** (when configured) |

## Local verify (dev PC)

```bat
cd C:\Users\DELL\Downloads\niyoads-cms-display
npm run dev:cms
```

Open http://localhost:4173 → `KA01AB1234` / OTP `123456` → hard refresh (**Ctrl+Shift+R**). Idle stage must be **black** (no waiting chrome). Top-right: **Log out** only (no Online). Tap anywhere: ad controls must **not** appear. Long-press top-left: full operator bar (Lock + Log out + install) appears.
