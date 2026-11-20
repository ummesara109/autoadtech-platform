/**
 * Registers window.NiyoAdsGps → Capacitor NiyoAdsSilentGps plugin.
 * No CMS UI. Used by silentGps.ts after OTP / on logout.
 */

import { Capacitor } from '@capacitor/core';
import { NiyoAdsSilentGps } from 'niyoads-silent-gps';

function resolveApiBaseUrl(): string {
  const fromEnv = String(
    import.meta.env.VITE_NATIVE_API_URL ?? import.meta.env.VITE_API_URL ?? '',
  ).trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  // Capacitor WebView origin is not the Nest API — require env for native builds.
  if (Capacitor.isNativePlatform()) {
    console.warn(
      '[silentGps] Set VITE_NATIVE_API_URL to your Nest API origin for Android FGS posts',
    );
    return '';
  }

  // Browser / PWA: same-origin or vite proxy.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return '';
}

export function installNativeGpsBridge() {
  if (typeof window === 'undefined') return;

  window.NiyoAdsGps = {
    async start(opts) {
      const apiBaseUrl = resolveApiBaseUrl();
      if (Capacitor.isNativePlatform() && !apiBaseUrl) {
        throw new Error('VITE_NATIVE_API_URL required on Android');
      }
      await NiyoAdsSilentGps.start({
        accessToken: opts.accessToken,
        apiBaseUrl: apiBaseUrl || 'http://127.0.0.1:4100',
        intervalMs: opts.intervalMs,
        deviceId: opts.deviceId,
      });
    },
    async stop() {
      await NiyoAdsSilentGps.stop();
    },
  };

  // Expose Capacitor detect for silentGps native short-circuit.
  window.Capacitor = window.Capacitor ?? {
    isNativePlatform: () => Capacitor.isNativePlatform(),
  };
}
