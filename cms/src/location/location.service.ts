import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { SessionPayload } from '../auth/auth.types';
import { QueueService } from '../queue/queue.service';
import { AdminGpsClient, type AdminGpsCurrentAd } from './admin-gps.client';
import { LocationStore } from './location.store';
import type { LiveVehicleLocation } from './location.types';
import type { UpsertLocationDto } from './dto/upsert-location.dto';

const ONLINE_MS = 90_000;

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly store: LocationStore,
    private readonly supabase: SupabaseService,
    private readonly adminGps: AdminGpsClient,
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
  ) {}

  /** CP-55: fail-soft currentlyPlaying for Admin Live Now playing. */
  private async currentAdForScreen(
    screenId: string | undefined,
  ): Promise<AdminGpsCurrentAd> {
    if (!screenId) return null;
    try {
      const snap = await this.queue.snapshot(screenId);
      const playing = snap?.currentlyPlaying;
      if (!playing?.id && !playing?.title) return null;
      return {
        queueItemId: playing.id ?? null,
        id: playing.id ?? null,
        title: playing.title ?? null,
        mediaUrl: playing.mediaUrl ?? null,
        startedAt: playing.startedAt ?? null,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(
        `currentAd snapshot skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async upsertFromSession(session: SessionPayload, dto: UpsertLocationDto) {
    if (!Number.isFinite(dto.lat) || !Number.isFinite(dto.lng)) {
      throw new BadRequestException('Invalid coordinates');
    }

    const recordedAt = dto.recordedAt
      ? new Date(dto.recordedAt)
      : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('Invalid recordedAt');
    }

    const accuracyM =
      dto.accuracy === undefined || dto.accuracy === null
        ? null
        : Number(dto.accuracy);
    if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0)) {
      throw new BadRequestException('Invalid accuracy');
    }

    const now = new Date().toISOString();
    const row: LiveVehicleLocation = {
      vehicleId: session.operator.vehicleId,
      autoNumber: session.operator.autoNumber,
      deviceId: dto.deviceId?.trim() || null,
      lat: dto.lat,
      lng: dto.lng,
      accuracyM,
      recordedAt: recordedAt.toISOString(),
      lastUpdated: now,
      trackingActive: true,
      source: 'device_gps',
    };

    this.store.upsert(row);
    await this.persist(row);

    const currentAd = await this.currentAdForScreen(session.screen?.id);

    // Keep retrying transient Admin failures, and report when forwarding is pending.
    const adminForwarded = await this.adminGps.forwardUpsert({
      autoNumber: session.operator.autoNumber,
      cmsVehicleId: session.operator.vehicleId,
      vehicleId: session.operator.vehicleId,
      cmsScreenId: session.screen?.id,
      screenId: session.screen?.id,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracyM,
      recordedAt: row.recordedAt,
      lastUpdated: row.lastUpdated,
      deviceId: row.deviceId,
      trackingActive: true,
      source: 'device_gps',
      currentAd,
    });

    return { ...this.toPublic(row), adminForwarded };
  }

  async stopForSession(session: SessionPayload) {
    const row = this.store.markInactive(session.operator.vehicleId);
    if (row) {
      await this.persist(row);
      await this.adminGps.forwardStop({
        autoNumber: session.operator.autoNumber,
        cmsVehicleId: session.operator.vehicleId,
        vehicleId: session.operator.vehicleId,
        cmsScreenId: session.screen?.id,
        screenId: session.screen?.id,
      });
      return this.toPublic(row);
    }

    if (this.supabase.isConfigured) {
      const { data } = await this.supabase.client
        .from('cms_vehicle_location')
        .update({
          tracking_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('vehicle_id', session.operator.vehicleId)
        .select('*')
        .maybeSingle();
      if (data) {
        const mapped = this.fromDb(data);
        this.store.upsert(mapped);
        await this.adminGps.forwardStop({
          autoNumber: session.operator.autoNumber,
          cmsVehicleId: session.operator.vehicleId,
          vehicleId: session.operator.vehicleId,
          cmsScreenId: session.screen?.id,
          screenId: session.screen?.id,
        });
        return this.toPublic(mapped);
      }
    }

    await this.adminGps.forwardStop({
      autoNumber: session.operator.autoNumber,
      cmsVehicleId: session.operator.vehicleId,
      vehicleId: session.operator.vehicleId,
      cmsScreenId: session.screen?.id,
      screenId: session.screen?.id,
    });

    return {
      ok: true,
      trackingActive: false,
      vehicleId: session.operator.vehicleId,
    };
  }

  /** Best-effort stop when logout only has a token / vehicle id. */
  async stopForVehicle(vehicleId: string) {
    const row = this.store.markInactive(vehicleId);
    if (row) {
      await this.persist(row);
      await this.adminGps.forwardStop({
        autoNumber: row.autoNumber,
        cmsVehicleId: vehicleId,
        vehicleId,
      });
      return;
    }
    if (!this.supabase.isConfigured) return;
    try {
      await this.supabase.client
        .from('cms_vehicle_location')
        .update({
          tracking_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('vehicle_id', vehicleId);
    } catch (err) {
      this.logger.warn(
        `location stop on logout skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getMine(session: SessionPayload) {
    const live = this.store.get(session.operator.vehicleId);
    if (live) return this.toPublic(live);
    return {
      available: false,
      trackingActive: false,
      vehicleId: session.operator.vehicleId,
      autoNumber: session.operator.autoNumber,
      source: null as string | null,
    };
  }

  /**
   * Admin / internal fleet snapshot. Only real device_gps rows.
   * Online = tracking_active && lastUpdated within ONLINE_MS.
   */
  async listFleet() {
    const fromMemory = this.store.list().filter((r) => r.source === 'device_gps');

    if (this.supabase.isConfigured) {
      try {
        const { data } = await this.supabase.client
          .from('cms_vehicle_location')
          .select('*')
          .eq('source', 'device_gps')
          .not('lat', 'is', null)
          .not('lng', 'is', null);
        for (const row of data ?? []) {
          const mapped = this.fromDb(row);
          // Memory wins if fresher (local CMS_DEV_AUTH dual-write).
          const mem = this.store.get(mapped.vehicleId);
          if (!mem || mem.lastUpdated < mapped.lastUpdated) {
            this.store.upsert(mapped);
          }
        }
      } catch (err) {
        this.logger.warn(
          `fleet supabase read skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const rows =
      this.supabase.isConfigured && fromMemory.length === 0
        ? this.store.list().filter((r) => r.source === 'device_gps')
        : this.store.list().filter((r) => r.source === 'device_gps');

    const now = Date.now();
    return {
      positions: rows.map((r) => {
        const age = now - new Date(r.lastUpdated).getTime();
        const online = r.trackingActive && age <= ONLINE_MS;
        return {
          vehicleId: r.vehicleId,
          autoNumber: r.autoNumber,
          deviceId: r.deviceId,
          lat: r.lat,
          lng: r.lng,
          accuracyM: r.accuracyM,
          recordedAt: r.recordedAt,
          lastUpdated: r.lastUpdated,
          trackingActive: r.trackingActive,
          online,
          source: r.source,
        };
      }),
      empty: rows.length === 0,
      onlineThresholdMs: ONLINE_MS,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Used by dashboard — prefer live device_gps over seed. */
  getLiveForVehicle(vehicleId: string): LiveVehicleLocation | null {
    return this.store.get(vehicleId);
  }

  private async persist(row: LiveVehicleLocation) {
    if (!this.supabase.isConfigured) return;
    try {
      const { error } = await this.supabase.client
        .from('cms_vehicle_location')
        .upsert(
          {
            vehicle_id: row.vehicleId,
            auto_number: row.autoNumber,
            device_id: row.deviceId,
            lat: row.lat,
            lng: row.lng,
            accuracy_m: row.accuracyM,
            recorded_at: row.recordedAt,
            updated_at: row.lastUpdated,
            tracking_active: row.trackingActive,
            source: row.source,
          },
          { onConflict: 'vehicle_id' },
        );
      if (error) {
        this.logger.warn(`cms_vehicle_location upsert failed: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(
        `cms_vehicle_location upsert error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private fromDb(data: Record<string, unknown>): LiveVehicleLocation {
    return {
      vehicleId: String(data.vehicle_id),
      autoNumber: String(data.auto_number ?? ''),
      deviceId: data.device_id != null ? String(data.device_id) : null,
      lat: Number(data.lat),
      lng: Number(data.lng),
      accuracyM:
        data.accuracy_m == null || data.accuracy_m === ''
          ? null
          : Number(data.accuracy_m),
      recordedAt: String(data.recorded_at ?? data.updated_at),
      lastUpdated: String(data.updated_at ?? data.recorded_at),
      trackingActive: Boolean(data.tracking_active),
      source: 'device_gps',
    };
  }

  private toPublic(row: LiveVehicleLocation) {
    const age = Date.now() - new Date(row.lastUpdated).getTime();
    return {
      available: true,
      vehicleId: row.vehicleId,
      autoNumber: row.autoNumber,
      deviceId: row.deviceId,
      lat: row.lat,
      lng: row.lng,
      accuracyM: row.accuracyM,
      recordedAt: row.recordedAt,
      lastUpdated: row.lastUpdated,
      trackingActive: row.trackingActive,
      online: row.trackingActive && age <= ONLINE_MS,
      source: row.source,
    };
  }
}
