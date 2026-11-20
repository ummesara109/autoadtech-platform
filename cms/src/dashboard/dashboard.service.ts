import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import type { SessionPayload } from '../auth/auth.types';
import { DEV_SEED } from '../auth/dev-seed';
import { QueueService } from '../queue/queue.service';
import { LocationService } from '../location/location.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly queue: QueueService,
    private readonly locationService: LocationService,
  ) {}

  /**
   * Session-bound dashboard. Never trusts client Auto Number or screenId.
   * Optional screenId query is validated against the session screen and rejected if mismatched.
   */
  async getDashboard(session: SessionPayload, clientScreenId?: string) {
    const screen =
      session.screen ??
      (await this.auth.requireSingleScreenForOperator(
        session.operator.id,
        session.operator.vehicleId,
      ));

    if (clientScreenId && clientScreenId !== screen.id) {
      throw new ForbiddenException(
        'Cross-auto / foreign screen access blocked — screen is bound to session',
      );
    }

    // Ensure screen belongs to session vehicle
    const vehicle = await this.getVehicleById(session.operator.vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.autoNumber !== session.operator.autoNumber) {
      throw new ForbiddenException('Session Auto Number mismatch');
    }
    const screenVehicleId = await this.queue.resolveScreenVehicle(screen.id);
    if (screenVehicleId !== session.operator.vehicleId) {
      throw new ForbiddenException('Screen does not belong to session vehicle');
    }

    // Local / CMS_DEV_AUTH: refill empty in-memory queue so login never idles blank.
    // No-op when PLAYING or QUEUED already exist (never interrupts PLAYING).
    const seeded = this.auth.devAuthEnabled
      ? await this.queue.ensureDevDemoAdsIfEmpty(screen.id)
      : false;

    // Screen-scoped key so QueueService can invalidate after assign/complete
    const cacheKey = `cms:dash:screen:${screen.id}`;
    if (!seeded) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          currentlyPlaying?: unknown;
          upcomingQueue?: unknown[];
        };
        // Skip stale empty cache after Nest restart wiped memory queue
        if (
          parsed.currentlyPlaying ||
          (parsed.upcomingQueue?.length ?? 0) > 0
        ) {
          return parsed;
        }
      }
    }

    const [queueSnap, device, location] = await Promise.all([
      this.queue.snapshot(screen.id),
      this.getDevice(screen.id),
      this.getLocation(vehicle.id),
    ]);

    const payload = {
      screen,
      vehicle: {
        id: vehicle.id,
        autoNumber: vehicle.autoNumber,
        displayName: vehicle.displayName,
        makeModel: vehicle.makeModel,
        status: vehicle.status,
      },
      currentlyPlaying: queueSnap.currentlyPlaying,
      upcomingQueue: queueSnap.upcomingQueue,
      playbackHistory: queueSnap.playbackHistory,
      liveLocation: location,
      deviceStatus: device,
      placeholders: {
        ads: 'Queue empty until the ad-delivery worker assigns creatives (Nest appends QUEUED; never interrupts PLAYING).',
        location:
          'Location empty until telematics writes cms_vehicle_location (or CMS_DEV_AUTH seed).',
        history:
          'History appears only after a PLAYING item is completed or failed — never fabricated.',
      },
      fetchedAt: new Date().toISOString(),
    };

    await this.redis.set(cacheKey, JSON.stringify(payload), 5);
    return payload;
  }

  private async getVehicleById(id: string) {
    if (this.supabase.isConfigured) {
      const { data: v } = await this.supabase.client
        .from('cms_vehicles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!v) return null;
      return {
        id: v.id as string,
        autoNumber: v.auto_number as string,
        displayName: v.display_name as string,
        makeModel: v.make_model as string,
        status: v.status as string,
      };
    }
    const v = DEV_SEED.vehicles.find((x) => x.id === id);
    return v
      ? {
          id: v.id,
          autoNumber: v.autoNumber,
          displayName: v.displayName,
          makeModel: v.makeModel,
          status: v.status,
        }
      : null;
  }

  private async getDevice(screenId: string) {
    if (!this.supabase.isConfigured) {
      return {
        online: false,
        lastSeenAt: null,
        firmwareVersion: '',
        signalStrength: null,
        source: 'placeholder',
      };
    }
    const { data } = await this.supabase.client
      .from('cms_device_status')
      .select('*')
      .eq('screen_id', screenId)
      .maybeSingle();
    return {
      online: data?.online ?? false,
      lastSeenAt: data?.last_seen_at ?? null,
      firmwareVersion: data?.firmware_version ?? '',
      signalStrength: data?.signal_strength ?? null,
      source: 'cms_device_status',
    };
  }

  private async getLocation(vehicleId: string) {
    // Prefer real device GPS ingest (silent tracker) over demo seed.
    const live = this.locationService.getLiveForVehicle(vehicleId);
    if (live && live.lat != null && live.lng != null) {
      return {
        available: true,
        label: null as string | null,
        lat: live.lat,
        lng: live.lng,
        speedKmh: null,
        headingDeg: null,
        accuracyM: live.accuracyM,
        recordedAt: live.recordedAt,
        lastUpdated: live.lastUpdated,
        trackingActive: live.trackingActive,
        source: 'device_gps' as const,
      };
    }

    if (!this.supabase.isConfigured) {
      const seeded = DEV_SEED.locations.find((x) => x.vehicleId === vehicleId);
      if (!seeded || seeded.lat == null || seeded.lng == null) {
        return {
          available: false,
          label: null,
          lat: null,
          lng: null,
          speedKmh: null,
          headingDeg: null,
          recordedAt: null,
          source: 'placeholder',
        };
      }
      // Local CMS_DEV_AUTH sample only — clearly not live telematics.
      return {
        available: true,
        label: seeded.label,
        lat: seeded.lat,
        lng: seeded.lng,
        speedKmh: seeded.speedKmh,
        headingDeg: seeded.headingDeg,
        recordedAt: seeded.recordedAt,
        source: 'cms_dev_seed',
      };
    }
    const { data } = await this.supabase.client
      .from('cms_vehicle_location')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();
    if (!data || data.lat == null || data.lng == null) {
      return {
        available: false,
        label: null,
        lat: null,
        lng: null,
        speedKmh: null,
        headingDeg: null,
        recordedAt: null,
        source: 'cms_vehicle_location',
      };
    }
    const src =
      data.source === 'device_gps' ? 'device_gps' : 'cms_vehicle_location';
    return {
      available: true,
      // DB has no city label column yet — UI falls back to coords when null.
      label: null as string | null,
      lat: data.lat,
      lng: data.lng,
      speedKmh: data.speed_kmh,
      headingDeg: data.heading_deg,
      accuracyM: data.accuracy_m ?? null,
      recordedAt: data.recorded_at,
      lastUpdated: data.updated_at ?? null,
      trackingActive: data.tracking_active ?? false,
      source: src,
    };
  }
}
