# Android companion (Capacitor) — silent GPS

**Status (Increment B):** Capacitor plugin + Android foreground location service sources are in-repo. **Device E2E (minimized / screen locked) is not verified** on this machine (no Android SDK/emulator here).

## What was built

| Piece | Path |
| --- | --- |
| Local Capacitor plugin | `plugins/niyoads-silent-gps` |
| Android FGS + notification | `plugins/.../LocationForegroundService.java` |
| JS bridge | `web/src/lib/nativeGpsBridge.ts` → `window.NiyoAdsGps` |
| Capacitor config | `web/capacitor.config.ts` (`com.niyoads.autodisplay`) |
| Android app project | `android/` (after `npx cap add android` / `npm run build:android`) |

## Lifecycle

| Event | Action |
| --- | --- |
| OTP success / Display mount | `startSilentGps` → `NiyoAdsSilentGps.start` → FGS + persistent notification |
| Logout / session clear | `stopSilentGps` → FGS stop + prefs clear + `POST /api/location/stop` |
| Process recreation / reboot | `SilentGpsBootReceiver` restarts FGS **only if** tracking prefs still active (logout clears them) |

## Permissions (plugin manifest)

- `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` (Android 13+)
- Persistent notification: **“Auto Display location active”** (OS requirement — not a CMS UI control)

## Build on a machine with Android Studio / SDK

Requires **JDK 17 or 21** (Android Gradle). Java 24 on the agent host fails with `Unsupported class file major version 68`.

```bat
cd C:\Users\DELL\Downloads\niyoads-cms-display-pwa

REM 1) Install + build plugin + web deps
npm run install:cms

REM 2) Point the APK at your Nest API (LAN IP of the PC running :4100)
echo VITE_NATIVE_API_URL=http://192.168.x.x:4100> web\.env

REM 3) Build web assets + sync Android (project lives in web\android)
cd web
npm run build:cap
npx cap open android
```

In Android Studio: Run on a device/emulator. After OTP `KA01AB1234` / `123456`, allow location (+ notifications). Confirm the persistent notification **“Auto Display location active”**. Minimize / lock screen and confirm Admin fleet still updates — **only then** claim background tracking works.

## Security

- APK holds the **session bearer** in private SharedPreferences while tracking — never the Supabase service-role key.
- Nest remains the only writer to `cms_vehicle_location` with service-role.

## CMS UI

Unchanged — no map, coords, or tracking buttons on Display.
