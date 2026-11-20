const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function endpointUrl(path: string): string {
  if (typeof window === 'undefined') return `${API_BASE}${path}`;
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (window.location.protocol === 'https:' && url.protocol !== 'https:') {
    throw new ApiError(0, 'CMS API must use HTTPS when CMS is opened over HTTPS.');
  }
  return url.toString();
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(endpointUrl(path), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      (body as { message?: string | string[] })?.message ??
      res.statusText ??
      'Request failed';
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join(', ') : String(message),
    );
  }
  return body as T;
}

export type LookupResponse = {
  challengeId: string;
  maskedMobile: string;
  expiresAt: string;
  expiresInSec: number;
  autoNumber: string;
  devMode: boolean;
};

export type Screen = {
  id: string;
  code: string;
  label: string;
  placement: string;
};

export type SessionResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  operator: {
    id: string;
    displayName: string;
    roleCode: string;
    vehicleId: string;
    autoNumber: string;
  };
  screen: Screen;
  screens: Screen[];
};

export type DashboardResponse = {
  screen: Screen;
  vehicle: {
    id: string;
    autoNumber: string;
    displayName: string;
    makeModel: string;
    status: string;
  };
  currentlyPlaying: {
    id: string;
    title: string;
    advertiser: string;
    durationSec: number;
    status?: string;
    startedAt?: string | null;
    /** Real creative URL from ad delivery — display only renders when set. */
    mediaUrl?: string | null;
    externalAdId?: string | null;
  } | null;
  upcomingQueue: Array<{
    id: string;
    title: string;
    advertiser: string;
    durationSec: number;
    position: number;
    status?: string;
    mediaUrl?: string | null;
  }>;
  playbackHistory: Array<{
    id: string;
    title: string;
    advertiser: string;
    startedAt: string;
    endedAt: string | null;
    outcome?: string;
  }>;
  liveLocation: {
    available: boolean;
    /** Human-readable place (dev seed) or null when only coords / empty. */
    label: string | null;
    lat: number | null;
    lng: number | null;
    speedKmh: number | null;
    headingDeg: number | null;
    accuracyM?: number | null;
    recordedAt: string | null;
    lastUpdated?: string | null;
    trackingActive?: boolean;
    /** cms_dev_seed | cms_vehicle_location | placeholder */
    source: string;
  };
  deviceStatus: {
    online: boolean;
    lastSeenAt: string | null;
    firmwareVersion: string;
    signalStrength: number | null;
    source: string;
  };
  placeholders: {
    ads: string;
    location: string;
    history: string;
  };
  fetchedAt: string;
};

export const api = {
  lookup: (autoNumber: string) =>
    request<LookupResponse>('/api/auth/lookup', {
      method: 'POST',
      body: JSON.stringify({ autoNumber }),
    }),
  verifyOtp: (challengeId: string, otp: string) =>
    request<SessionResponse>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ challengeId, otp }),
    }),
  resendOtp: (challengeId: string) =>
    request<LookupResponse & { message?: string }>('/api/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ challengeId }),
    }),
  logout: (token: string) =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
      token,
    }),
  /** Session-bound display feed — no client screenId. */
  dashboard: (token: string) =>
    request<DashboardResponse>('/api/dashboard', { token }),

  /**
   * Display player: mark current PLAYING complete and promote next.
   * Screen is bound to the session on the API — do not send screenId.
   */
  playerComplete: (token: string, queueItemId: string) =>
    request<{
      completedId?: string;
      playing?: DashboardResponse['currentlyPlaying'];
      queued?: DashboardResponse['upcomingQueue'];
      currentlyPlaying?: DashboardResponse['currentlyPlaying'];
      upcomingQueue?: DashboardResponse['upcomingQueue'];
    }>('/api/queue/player/complete', {
      method: 'POST',
      token,
      body: JSON.stringify({ queueItemId }),
    }),

  /** Display player: fail broken/missing creative and advance. */
  playerFail: (token: string, queueItemId: string, reason?: string) =>
    request<{
      failedId?: string;
      playing?: DashboardResponse['currentlyPlaying'];
      queued?: DashboardResponse['upcomingQueue'];
      currentlyPlaying?: DashboardResponse['currentlyPlaying'];
      upcomingQueue?: DashboardResponse['upcomingQueue'];
    }>('/api/queue/player/fail', {
      method: 'POST',
      token,
      body: JSON.stringify({ queueItemId, reason }),
    }),

  /** Silent GPS ingest — session vehicle only; no CMS UI. */
  postLocation: (
    token: string,
    body: {
      lat: number;
      lng: number;
      accuracy?: number;
      recordedAt?: string;
      deviceId?: string;
    },
  ) =>
    request<{
      available: boolean;
      lat: number;
      lng: number;
      accuracyM: number | null;
      lastUpdated: string;
      trackingActive: boolean;
      source: string;
      adminForwarded?: boolean;
    }>('/api/location', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  stopLocation: (token: string) =>
    request<{ trackingActive?: boolean; ok?: boolean }>('/api/location/stop', {
      method: 'POST',
      token,
    }),

  /** Admin / local fleet snapshot (CMS_DEV_AUTH open). */
  locationFleet: () =>
    request<{
      positions: Array<{
        vehicleId: string;
        autoNumber: string;
        lat: number;
        lng: number;
        accuracyM: number | null;
        lastUpdated: string;
        trackingActive: boolean;
        online: boolean;
        source: string;
      }>;
      empty: boolean;
      fetchedAt: string;
    }>('/api/location/fleet'),
};
