/**
 * Silent LIVE GPS pipeline for CMS Display — continuous stream, no map/UI.
 * Foreground (browser): watchPosition plus periodic fresh position requests.
 * Android Capacitor: NiyoAdsSilentGps FGS + persistent notification.
 * Background/locked tracking is only claimed when verified on a real Android device.
 *
 * Interval: VITE_GPS_POST_INTERVAL_MS (default 15000). Auto-send; not manual pins.
 * On network failure: keep latest fix and retry (reconnect) without interrupting ads.
 */

import { Capacitor } from '@capacitor/core';
import { ApiError, api } from './api';
import { loadSession } from './session';

/** Steady cadence when stationary. Movement posts sooner (see MOVE_MIN_INTERVAL_MS). */
const DEFAULT_POST_INTERVAL_MS = 10_000;
/** CP-56: min gap between posts when the phone has moved enough to update Admin Live. */
const MOVE_MIN_INTERVAL_MS = 2_000;
/** ~15 m — post immediately (subject to MOVE_MIN_INTERVAL_MS) so the map marker tracks. */
const MOVE_METERS = 15;

function postIntervalMs(): number {
  const raw = Number(
    (import.meta as ImportMeta & { env: Record<string, string> }).env
      ?.VITE_GPS_POST_INTERVAL_MS,
  );
  if (!Number.isFinite(raw) || raw < 2_000) return DEFAULT_POST_INTERVAL_MS;
  return Math.min(raw, 120_000);
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // Prefer fresh fixes so Admin Live is not stuck on cached coords
  maximumAge: 1_000,
  timeout: 20_000,
};

function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const DEVICE_KEY = 'cms.deviceId.v1';

type NativeGpsBridge = {
  start?: (opts: {
    accessToken: string;
    intervalMs?: number;
    deviceId?: string;
  }) => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

declare global {
  interface Window {
    /** Optional Capacitor/native companion bridge */
    NiyoAdsGps?: NativeGpsBridge;
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

let watchId: number | null = null;
let positionPollId: number | null = null;
let positionRequestInFlight = false;
let lastPostAt = 0;
let running = false;
let pending: GeolocationPosition | null = null;
let flushTimer: number | undefined;
let streamSeq = 0;
let lastPostedLat: number | null = null;
let lastPostedLng: number | null = null;
let gpsError: string | null = null;

function setGpsError(message: string | null) {
  gpsError = message;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('niyoads:gps-status', { detail: { error: message } }),
    );
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `web-ephemeral-${Date.now()}`;
  }
}

function nativeBridge(): NativeGpsBridge | null {
  if (typeof window === 'undefined') return null;
  if (window.NiyoAdsGps) return window.NiyoAdsGps;
  return null;
}

function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return window.Capacitor?.isNativePlatform?.() === true;
  }
}

async function postFix(pos: GeolocationPosition, token: string) {
  const interval = postIntervalMs();
  const now = Date.now();
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const movedM =
    lastPostedLat != null && lastPostedLng != null
      ? haversineM(lastPostedLat, lastPostedLng, lat, lng)
      : Number.POSITIVE_INFINITY;
  const movedEnough = movedM >= MOVE_METERS;
  const minGap = movedEnough ? MOVE_MIN_INTERVAL_MS : interval;

  if (now - lastPostAt < minGap) {
    pending = pos;
    scheduleFlush(token, movedEnough ? MOVE_MIN_INTERVAL_MS : interval);
    return;
  }

  pending = null;
  streamSeq += 1;
  try {
    // Prefer server-received ordering on Admin: send phone time but Nest also sets lastUpdated.
    const result = await api.postLocation(token, {
      lat,
      lng,
      accuracy:
        typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : undefined,
      recordedAt: new Date().toISOString(),
      deviceId: deviceId(),
    });
    if (result.adminForwarded === false) {
      setGpsError(
        'GPS reached CMS; forwarding to Admin is pending. CMS will retry automatically.',
      );
    } else {
      setGpsError(null);
    }
    lastPostAt = Date.now();
    lastPostedLat = lat;
    lastPostedLng = lng;
  } catch (err) {
    pending = pos;
    const detail =
      err instanceof ApiError
        ? `CMS GPS update failed (${err.status}): ${err.message}`
        : 'CMS GPS update failed because the network is unavailable';
    setGpsError(`${detail}. Retrying when the connection is available.`);
    scheduleFlush(token, MOVE_MIN_INTERVAL_MS);
  }
}

function scheduleFlush(token: string, waitMs?: number) {
  if (flushTimer != null) return;
  const wait = waitMs ?? postIntervalMs();
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    if (!running || !pending) return;
    const session = loadSession();
    const t = session?.accessToken ?? token;
    if (!t) return;
    void postFix(pending, t);
  }, wait);
}

function stopBrowserWatch() {
  if (watchId != null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (positionPollId != null) {
    window.clearInterval(positionPollId);
    positionPollId = null;
  }
  positionRequestInFlight = false;
}

function handleBrowserPositionError(error: GeolocationPositionError) {
  if (!running) return;
  if (error.code === error.PERMISSION_DENIED) {
    setGpsError(
      'Location permission was denied. Allow location access for this site in Android settings, then reopen CMS.',
    );
    stopBrowserWatch();
    running = false;
    return;
  }
  setGpsError(
    error.code === error.POSITION_UNAVAILABLE
      ? 'Phone location is unavailable. Check that Android location services are enabled.'
      : 'Phone location timed out. Waiting for a fresh GPS fix.',
  );
}

function requestCurrentPosition(token: string) {
  if (!running || positionRequestInFlight) return;
  positionRequestInFlight = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      positionRequestInFlight = false;
      if (running) void postFix(pos, token);
    },
    (error) => {
      positionRequestInFlight = false;
      handleBrowserPositionError(error);
    },
    WATCH_OPTIONS,
  );
}

function startBrowserWatch(token: string) {
  if (!('geolocation' in navigator)) return;
  if (watchId == null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!running) return;
        void postFix(pos, token);
      },
      handleBrowserPositionError,
      WATCH_OPTIONS,
    );
  }
  if (positionPollId == null) {
    requestCurrentPosition(token);
    positionPollId = window.setInterval(
      () => requestCurrentPosition(token),
      postIntervalMs(),
    );
  }
}

/**
 * Start continuous silent tracking after OTP / when Display mounts with a session.
 * On Android Capacitor: FGS owns tracking (no duplicate browser watch).
 * On web: watchPosition plus periodic geolocation refreshes while foregrounded.
 */
export async function startSilentGps(accessToken?: string) {
  const session = loadSession();
  const token = accessToken ?? session?.accessToken;
  if (!token) return;
  if (running) return;

  if (
    !isNativeApp() &&
    typeof window !== 'undefined' &&
    !window.isSecureContext
  ) {
    setGpsError('Phone GPS requires CMS to be opened over HTTPS.');
    return;
  }
  if (!isNativeApp() && !('geolocation' in navigator)) {
    setGpsError('This browser does not support phone location.');
    return;
  }

  running = true;
  setGpsError(null);

  const intervalMs = postIntervalMs();
  const bridge = nativeBridge();
  if (bridge?.start) {
    try {
      await bridge.start({
        accessToken: token,
        intervalMs,
        deviceId: deviceId(),
      });
      if (isNativeApp()) {
        // Native FGS posts from Android — skip browser watch to avoid double ingest.
        return;
      }
    } catch {
      /* fall through to browser */
    }
  }

  startBrowserWatch(token);
}

/** Stop watchers / FGS and tell API tracking ended (logout). */
export async function stopSilentGps(accessToken?: string) {
  running = false;
  lastPostedLat = null;
  lastPostedLng = null;
  pending = null;
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  stopBrowserWatch();

  const bridge = nativeBridge();
  if (bridge?.stop) {
    try {
      await bridge.stop();
    } catch {
      /* ignore */
    }
  }

  const session = loadSession();
  const token = accessToken ?? session?.accessToken;
  if (token) {
    try {
      await api.stopLocation(token);
    } catch {
      /* ignore */
    }
  }
}

export function getSilentGpsError() {
  return gpsError;
}

export function isSilentGpsRunning() {
  return running;
}

/** Current auto-send interval (ms) — for native bridge / diagnostics. */
export function getSilentGpsIntervalMs() {
  return postIntervalMs();
}
