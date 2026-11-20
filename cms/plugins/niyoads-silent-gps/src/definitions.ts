export interface SilentGpsStartOptions {
  /** CMS session bearer token — never a Supabase service-role key. */
  accessToken: string;
  /** Absolute Nest API origin, e.g. https://192.168.1.10:4100 or https://api.example.com */
  apiBaseUrl: string;
  /** Location POST interval (ms). Default 15000. */
  intervalMs?: number;
  /** Stable device id for cms_vehicle_location.device_id */
  deviceId?: string;
}

export interface NiyoAdsSilentGpsPlugin {
  /** Start Android FGS + persistent notification; no-op on web. */
  start(options: SilentGpsStartOptions): Promise<{ started: boolean; platform: string }>;
  /** Stop FGS and clear persisted tracking session. */
  stop(): Promise<{ stopped: boolean }>;
  /** Whether native FGS reports itself as running. */
  isRunning(): Promise<{ running: boolean }>;
}
