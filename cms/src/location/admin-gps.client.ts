import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';

/** CP-55: CMS currentlyPlaying snapshot piggybacked on GPS ingest. */
export type AdminGpsCurrentAd = {
  queueItemId?: string | null;
  id?: string | null;
  title?: string | null;
  mediaUrl?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
} | null;

export type AdminGpsPayload = {
  autoNumber: string;
  cmsVehicleId?: string;
  cmsScreenId?: string;
  vehicleId?: string;
  screenId?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  recordedAt?: string;
  /** Server clock when Nest accepted the fix — Phase 2 online/stale. */
  lastUpdated?: string;
  deviceId?: string | null;
  trackingActive?: boolean;
  source?: 'device_gps';
  speedKmh?: number | null;
  /** Monotonic stream hint for clients (optional). */
  streamSeq?: number;
  /** Real CMS queue PLAYING item (or null when idle). */
  currentAd?: AdminGpsCurrentAd;
};

/**
 * Server-to-server forwarder: CMS Nest → Admin POST /api/cms/gps.
 * Continuous stream: every Nest location upsert is forwarded immediately.
 * On network drop, keeps the latest fix per Auto Number and retries.
 * Secrets stay in Nest env only (never the PWA).
 */
@Injectable()
export class AdminGpsClient implements OnModuleDestroy {
  private readonly logger = new Logger(AdminGpsClient.name);
  private readonly pendingByAuto = new Map<string, AdminGpsPayload>();
  private seqByAuto = new Map<string, number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private baseUrl(): string {
    if (
      process.env.VERCEL_ENV === 'preview' &&
      process.env.ADMIN_GPS_PREVIEW_URL
    ) {
      return process.env.ADMIN_GPS_PREVIEW_URL.trim().replace(/\/+$/, '');
    }

    return (process.env.ADMIN_GPS_URL || process.env.ADMIN_API_URL || '')
      .trim()
      .replace(/\/+$/, '');
  }

  private ingestKey(): string {
    return String(process.env.CMS_GPS_INGEST_KEY || '').trim();
  }

  private previewProtectionBypassSecret(): string {
    if (
      process.env.VERCEL_ENV !== 'preview' ||
      !process.env.ADMIN_GPS_PREVIEW_URL
    ) {
      return '';
    }
    try {
      const target = new URL(process.env.ADMIN_GPS_PREVIEW_URL);
      if (
        target.protocol !== 'https:' ||
        !target.hostname.endsWith('.vercel.app') ||
        !target.hostname.includes('-git-') ||
        target.pathname !== '/' ||
        target.search ||
        target.hash ||
        target.username ||
        target.password
      ) {
        return '';
      }
    } catch {
      return '';
    }
    return String(
      process.env.ADMIN_PREVIEW_PROTECTION_BYPASS_SECRET || '',
    ).trim();
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-cms-ingest-key': this.ingestKey(),
    };
    const bypassSecret = this.previewProtectionBypassSecret();
    if (bypassSecret) {
      headers['x-vercel-protection-bypass'] = bypassSecret;
    }
    return headers;
  }

  private responseFailure(status: number, body: string): string {
    if (
      /Protected by Vercel Authentication/i.test(body) ||
      /"vercel_auth_enabled"\s*:\s*true/i.test(body)
    ) {
      return 'Vercel Deployment Protection denied the request';
    }
    if (status === 401 || status === 403) {
      return 'request authentication was denied';
    }
    if (status === 404)
      return 'endpoint or active vehicle mapping was not found';
    if (status === 409) return 'vehicle mapping conflict';
    if (status === 400) return 'request validation failed';
    if (status === 429) return 'Admin rate limit was reached';
    if (status >= 500) return 'Admin API or Supabase persistence failed';
    return 'Admin returned a non-success response';
  }

  private responseRequestId(res: Response): string {
    const requestId = res.headers.get('x-vercel-id') ?? '';
    return /^[a-zA-Z0-9:_-]{1,128}$/.test(requestId) ? requestId : '';
  }

  /** Retry cadence after Admin network failures (ms). */
  private retryIntervalMs(): number {
    const raw = Number(
      process.env.ADMIN_GPS_RETRY_MS ||
        process.env.ADMIN_GPS_FORWARD_INTERVAL_MS ||
        5_000,
    );
    if (!Number.isFinite(raw) || raw < 1_000) return 5_000;
    return Math.min(raw, 60_000);
  }

  private onlineThresholdMs(): number {
    const raw = Number(process.env.CMS_GPS_ONLINE_MS || 90_000);
    if (!Number.isFinite(raw) || raw < 5_000) return 90_000;
    return raw;
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl() && this.ingestKey());
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async forwardUpsert(payload: AdminGpsPayload): Promise<boolean> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Admin GPS forwarding is not configured (ADMIN_GPS_URL and CMS_GPS_INGEST_KEY are required)',
      );
    }

    const nextSeq = (this.seqByAuto.get(payload.autoNumber) || 0) + 1;
    this.seqByAuto.set(payload.autoNumber, nextSeq);

    const enriched: AdminGpsPayload = {
      ...payload,
      source: 'device_gps',
      trackingActive: payload.trackingActive !== false,
      lastUpdated: payload.lastUpdated || new Date().toISOString(),
      streamSeq: nextSeq,
    };

    const ok = await this.postGps(enriched);
    if (ok) {
      this.pendingByAuto.delete(payload.autoNumber);
      return true;
    }

    // Keep only the latest fix per Auto Number for reconnect flush.
    this.pendingByAuto.set(payload.autoNumber, enriched);
    this.scheduleRetry();
    return false;
  }

  async forwardStop(payload: {
    autoNumber: string;
    cmsVehicleId?: string;
    cmsScreenId?: string;
    vehicleId?: string;
    screenId?: string;
  }): Promise<void> {
    if (!this.isConfigured) return;

    this.pendingByAuto.delete(payload.autoNumber);

    const url = `${this.baseUrl()}/api/cms/gps/stop`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const requestId = this.responseRequestId(res);
        this.logger.warn(
          `Admin GPS stop failed: HTTP ${res.status}; ${this.responseFailure(res.status, text)}${
            requestId ? `; Vercel request ${requestId}` : ''
          }`,
        );
      } else {
        this.logger.debug(`Admin GPS stop accepted: HTTP ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(
        `Admin GPS stop skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async postGps(payload: AdminGpsPayload): Promise<boolean> {
    const url = `${this.baseUrl()}/api/cms/gps`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify({
          ...payload,
          onlineThresholdMs: this.onlineThresholdMs(),
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const requestId = this.responseRequestId(res);
        this.logger.warn(
          `Admin GPS upsert failed: HTTP ${res.status}; ${this.responseFailure(res.status, text)}${
            requestId ? `; Vercel request ${requestId}` : ''
          }`,
        );
        return false;
      }
      this.logger.debug(`Admin GPS upsert accepted: HTTP ${res.status}`);
      return true;
    } catch (err) {
      this.logger.warn(
        `Admin GPS upsert skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private scheduleRetry() {
    if (this.destroyed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushPending();
    }, this.retryIntervalMs());
  }

  private async flushPending() {
    if (this.destroyed || this.pendingByAuto.size === 0) return;

    const entries = [...this.pendingByAuto.entries()];
    for (const [auto, payload] of entries) {
      const ok = await this.postGps(payload);
      if (ok) this.pendingByAuto.delete(auto);
    }

    if (this.pendingByAuto.size > 0) this.scheduleRetry();
  }
}
