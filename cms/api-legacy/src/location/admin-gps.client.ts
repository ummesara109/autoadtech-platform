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
    return (
      process.env.ADMIN_GPS_URL ||
      process.env.ADMIN_API_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, '');
  }

  private ingestKey(): string {
    return String(process.env.CMS_GPS_INGEST_KEY || '').trim();
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
        headers: {
          'Content-Type': 'application/json',
          'x-cms-ingest-key': this.ingestKey(),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `Admin GPS stop ${res.status}: ${text.slice(0, 300)}`,
        );
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
        headers: {
          'Content-Type': 'application/json',
          'x-cms-ingest-key': this.ingestKey(),
        },
        body: JSON.stringify({
          ...payload,
          onlineThresholdMs: this.onlineThresholdMs(),
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `Admin GPS upsert ${res.status}: ${text.slice(0, 300)}`,
        );
        return false;
      }
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
