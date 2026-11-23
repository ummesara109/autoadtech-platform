import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { RedisService } from '../redis/redis.service';
import { DEV_DEMO_ADS, DEV_SEED } from '../auth/dev-seed';
import {
  detectCmsAdQueueSchema,
  inferMediaUrl,
  statusValue,
  type CmsAdQueueSchema,
} from './queue-schema';
import { memoryQueueStore, MemoryQueueStore } from './queue.store';
import type { EnqueueAdInput, QueueItem } from './queue.types';

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  );
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly memory: MemoryQueueStore = memoryQueueStore;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * If a screen has no PLAYING or QUEUED item, enqueue the existing demo MP4
   * rotation (the first item starts immediately). Callers restrict this to
   * local demo auth or the designated demo-playback vehicles.
   */
  async ensureDevDemoAdsIfEmpty(screenId: string): Promise<boolean> {
    if (this.supabase.isConfigured) {
      const snap = await this.snapshotSupabase(screenId);
      if (snap.currentlyPlaying || (snap.upcomingQueue?.length ?? 0) > 0) {
        return false;
      }
    } else {
      if (this.memory.playing(screenId)) return false;
      if (this.memory.queued(screenId).length > 0) return false;
    }

    const ads: EnqueueAdInput[] = DEV_DEMO_ADS.map((ad) => ({
      title: ad.title,
      advertiser: ad.advertiser,
      durationSec: ad.durationSec,
      mediaUrl: ad.mediaUrl,
      externalAdId: ad.externalAdId,
    }));
    this.logger.log(
      `Demo queue seed for screen ${screenId}: ${ads.map((a) => a.mediaUrl).join(' → ')}`,
    );
    await this.enqueue(screenId, ads);
    return true;
  }

  /** Drop cached dashboard payload after queue mutations (avoid stale empty history). */
  private async invalidateDashboard(screenId: string) {
    await this.redis.del(`cms:dash:screen:${screenId}`);
  }

  /** Resolve vehicle for a screen (isolation boundary). */
  async resolveScreenVehicle(screenId: string): Promise<string> {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase.client
        .from('cms_screens')
        .select('vehicle_id')
        .eq('id', screenId)
        .maybeSingle();
      if (!data?.vehicle_id) throw new NotFoundException('Screen not found');
      return data.vehicle_id as string;
    }
    const screen = DEV_SEED.screens.find((s) => s.id === screenId);
    if (!screen) throw new NotFoundException('Screen not found');
    return screen.vehicleId;
  }

  /**
   * Assign/append ads. Never interrupts PLAYING — always appends as QUEUED.
   * If idle (no PLAYING), promotes the first QUEUED to PLAYING.
   */
  async enqueue(
    screenId: string,
    ads: EnqueueAdInput[],
    opts?: { vehicleId?: string },
  ) {
    if (!ads.length) throw new BadRequestException('No ads to enqueue');
    const vehicleId =
      opts?.vehicleId ?? (await this.resolveScreenVehicle(screenId));
    if (opts?.vehicleId && opts.vehicleId !== vehicleId) {
      throw new BadRequestException('vehicleId does not match screen');
    }

    const result = this.supabase.isConfigured
      ? await this.enqueueSupabase(screenId, vehicleId, ads)
      : await this.memory.withScreenLock(screenId, async () => {
          const playingBefore = this.memory.playing(screenId);
          const knownExternalIds = new Set(
            this.memory
              .listByScreen(screenId)
              .map((item) => item.externalAdId)
              .filter((id): id is string => !!id),
          );
          const uniqueAds = ads.filter((ad) => {
            if (!ad.externalAdId) return true;
            if (knownExternalIds.has(ad.externalAdId)) return false;
            knownExternalIds.add(ad.externalAdId);
            return true;
          });
          const created = this.memory.append(screenId, vehicleId, uniqueAds);
          const createdIds = new Set(
            created
              .map((item) => item.externalAdId)
              .filter((id): id is string => !!id),
          );
          const alreadyEnqueued = this.memory
            .listByScreen(screenId)
            .filter(
              (item) =>
                !!item.externalAdId &&
                ads.some((ad) => ad.externalAdId === item.externalAdId) &&
                !createdIds.has(item.externalAdId),
            );
          // Never interrupt PLAYING — only start if idle
          if (!playingBefore) {
            await this.promoteNextLocked(screenId);
          }
          return {
            enqueued: [...created, ...alreadyEnqueued],
            playing: this.memory.playing(screenId),
            queued: this.memory.queued(screenId),
            interruptedPlaying: false,
          };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  /** Snapshot for dashboard (no fabricated rows). */
  async snapshot(screenId: string) {
    if (this.supabase.isConfigured) {
      return this.snapshotSupabase(screenId);
    }
    this.expireQueuedMemory(screenId);
    return {
      currentlyPlaying: this.mapPlaying(this.memory.playing(screenId)),
      upcomingQueue: this.memory.queued(screenId).map((i) => this.mapQueued(i)),
      playbackHistory: this.memory.listHistory(screenId).map((h) => ({
        id: h.id,
        title: h.title,
        advertiser: h.advertiser,
        startedAt: h.startedAt,
        endedAt: h.endedAt,
        outcome: h.outcome,
      })),
    };
  }

  async startPlaying(
    screenId: string,
    queueItemId: string,
    occurredAt?: string,
  ) {
    const startedAt = this.playbackTimestamp(occurredAt);
    const result = this.supabase.isConfigured
      ? await this.startSupabase(screenId, queueItemId, startedAt)
      : await this.memory.withScreenLock(screenId, async () => {
          const item = this.memory.playing(screenId);
          if (!item || item.id !== queueItemId) {
            const existing = this.memory
              .listByScreen(screenId)
              .find((row) => row.id === queueItemId);
            if (existing?.startedAt) {
              return { startedId: queueItemId, startedAt: existing.startedAt };
            }
            throw new ConflictException('queueItemId is not the PLAYING item');
          }
          const actualStartedAt = item.startedAt ?? startedAt;
          this.memory.setStatus(queueItemId, 'PLAYING', {
            startedAt: actualStartedAt,
          });
          return { startedId: queueItemId, startedAt: actualStartedAt };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  /**
   * Player / MQTT worker ACK: mark current PLAYING complete and advance.
   * Does not invent history for ads that never played.
   */
  async completePlaying(
    screenId: string,
    queueItemId: string,
    occurredAt?: string,
  ) {
    const endedAt = this.playbackTimestamp(occurredAt);
    const result = this.supabase.isConfigured
      ? await this.completeSupabase(screenId, queueItemId, endedAt)
      : await this.memory.withScreenLock(screenId, async () => {
          const playing = this.memory.playing(screenId);
          if (!playing || playing.id !== queueItemId) {
            const existing = this.memory
              .listByScreen(screenId)
              .find((item) => item.id === queueItemId);
            if (existing?.status === 'COMPLETED') {
              return {
                completedId: queueItemId,
                playing: this.memory.playing(screenId),
                queued: this.memory.queued(screenId),
              };
            }
            throw new ConflictException('queueItemId is not the PLAYING item');
          }
          this.memory.setStatus(queueItemId, 'COMPLETED', { endedAt });
          this.memory.addHistory({
            screenId,
            queueItemId,
            title: playing.title,
            advertiser: playing.advertiser,
            startedAt: playing.startedAt ?? endedAt,
            endedAt,
            outcome: 'COMPLETED',
          });
          await this.promoteNextLocked(screenId);
          return {
            completedId: queueItemId,
            playing: this.memory.playing(screenId),
            queued: this.memory.queued(screenId),
          };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  async failPlaying(
    screenId: string,
    queueItemId: string,
    reason?: string,
    occurredAt?: string,
  ) {
    const endedAt = this.playbackTimestamp(occurredAt);
    const result = this.supabase.isConfigured
      ? await this.failSupabase(screenId, queueItemId, reason, endedAt)
      : await this.memory.withScreenLock(screenId, async () => {
          const playing = this.memory.playing(screenId);
          if (!playing || playing.id !== queueItemId) {
            const existing = this.memory
              .listByScreen(screenId)
              .find((item) => item.id === queueItemId);
            if (existing?.status === 'FAILED') {
              return {
                failedId: queueItemId,
                playing: this.memory.playing(screenId),
                queued: this.memory.queued(screenId),
              };
            }
            throw new ConflictException('queueItemId is not the PLAYING item');
          }
          this.memory.setStatus(queueItemId, 'FAILED', {
            endedAt,
            failReason: reason ?? 'failed',
          });
          this.memory.addHistory({
            screenId,
            queueItemId,
            title: playing.title,
            advertiser: playing.advertiser,
            startedAt: playing.startedAt ?? endedAt,
            endedAt,
            outcome: 'FAILED',
          });
          await this.promoteNextLocked(screenId);
          return {
            failedId: queueItemId,
            playing: this.memory.playing(screenId),
            queued: this.memory.queued(screenId),
          };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  async cancelQueued(screenId: string, queueItemId: string) {
    const result = this.supabase.isConfigured
      ? await this.cancelSupabase(screenId, queueItemId)
      : await this.memory.withScreenLock(screenId, async () => {
          const item = this.memory
            .listByScreen(screenId)
            .find((i) => i.id === queueItemId);
          if (!item) throw new NotFoundException('Queue item not found');
          if (item.status === 'CANCELLED') {
            return { cancelledId: queueItemId };
          }
          if (item.status !== 'QUEUED') {
            throw new ConflictException('Only QUEUED items can be cancelled');
          }
          this.memory.setStatus(queueItemId, 'CANCELLED', {
            endedAt: new Date().toISOString(),
          });
          return { cancelledId: queueItemId };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  async recordPlayerHeartbeat(
    screenId: string,
    input: {
      queueItemId?: string;
      status: 'playing' | 'idle' | 'error';
      playbackError?: string;
    },
  ) {
    const syncedAt = new Date().toISOString();
    if (!this.supabase.isConfigured) {
      return { ok: true, lastSeenAt: syncedAt, lastSyncAt: syncedAt };
    }

    const snapshot = await this.snapshot(screenId);
    const playing = snapshot.currentlyPlaying;
    const screenStatus =
      input.status === 'error' ? 'error' : playing ? 'playing' : 'idle';
    const { error } = await this.supabase.client
      .from('cms_device_status')
      .upsert(
        {
          screen_id: screenId,
          online: true,
          last_seen_at: syncedAt,
          screen_status: screenStatus,
          current_queue_item_id: playing?.id ?? null,
          current_campaign_id: playing?.externalAdId ?? null,
          ...(input.playbackError
            ? { last_playback_error: input.playbackError }
            : {}),
          last_sync_at: syncedAt,
          updated_at: syncedAt,
        },
        { onConflict: 'screen_id' },
      );
    if (error) {
      throw new BadRequestException(
        `Display heartbeat could not be saved: ${error.message}`,
      );
    }
    return {
      ok: true,
      lastSeenAt: syncedAt,
      lastSyncAt: syncedAt,
      currentCampaignId: playing?.externalAdId ?? null,
    };
  }

  /** Test-only reset of memory store. */
  resetMemory() {
    this.memory.reset();
  }

  private async promoteNextLocked(screenId: string) {
    this.expireQueuedMemory(screenId);
    if (this.memory.playing(screenId)) return null;
    const next = this.memory.queued(screenId)[0];
    if (!next) return null;
    return this.memory.setStatus(next.id, 'PLAYING');
  }

  private expireQueuedMemory(screenId: string) {
    const now = Date.now();
    for (const item of this.memory.queued(screenId)) {
      if (item.expiresAt && Date.parse(item.expiresAt) <= now) {
        this.memory.setStatus(item.id, 'CANCELLED', {
          endedAt: new Date(now).toISOString(),
          failReason: 'campaign_expired',
        });
      }
    }
  }

  private playbackTimestamp(value?: string) {
    if (!value) return new Date().toISOString();
    const timestamp = Date.parse(value);
    const now = Date.now();
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now + 2 * 60_000 ||
      timestamp < now - 7 * 24 * 60 * 60_000
    ) {
      throw new BadRequestException(
        'Playback timestamp is outside the allowed range',
      );
    }
    return new Date(timestamp).toISOString();
  }

  private mapPlaying(item: QueueItem | null) {
    if (!item) return null;
    return {
      id: item.id,
      title: item.title,
      advertiser: item.advertiser,
      durationSec: item.durationSec,
      status: item.status,
      startedAt: item.startedAt ?? null,
      expiresAt: item.expiresAt ?? null,
      mediaUrl: item.mediaUrl ?? null,
      externalAdId: item.externalAdId ?? null,
    };
  }

  private mapQueued(item: QueueItem) {
    return {
      id: item.id,
      title: item.title,
      advertiser: item.advertiser,
      durationSec: item.durationSec,
      position: item.position,
      status: item.status,
      mediaUrl: item.mediaUrl ?? null,
      expiresAt: item.expiresAt ?? null,
    };
  }

  // ---- Supabase path (service role; MQTT worker / Nest) --------------------

  private async queueSchema(): Promise<CmsAdQueueSchema> {
    return detectCmsAdQueueSchema(this.supabase.client);
  }

  private buildQueueInsertRow(
    schema: CmsAdQueueSchema,
    screenId: string,
    vehicleId: string,
    ad: EnqueueAdInput,
    pos: number,
    status: string,
  ) {
    const media = ad.mediaUrl?.trim() || null;
    const advertiserBase = ad.advertiser ?? '';
    // When media_url column is missing, stash path in advertiser for inferMediaUrl.
    const advertiser =
      !schema.hasMediaUrl && media
        ? `${advertiserBase}|${media}`
        : advertiserBase;

    const row: Record<string, unknown> = {
      id: randomUUID(),
      screen_id: screenId,
      title: ad.title,
      advertiser,
      duration_sec: ad.durationSec ?? 30,
      position: pos,
      status,
    };
    if (schema.hasVehicleId) row.vehicle_id = vehicleId;
    if (schema.hasExternalAdId) row.external_ad_id = ad.externalAdId ?? null;
    if (schema.hasMediaUrl) row.media_url = media;
    if (schema.hasExpiresAt) row.expires_at = ad.expiresAt ?? null;
    return row;
  }

  private async enqueueSupabase(
    screenId: string,
    vehicleId: string,
    ads: EnqueueAdInput[],
  ) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const queuedStatus = statusValue(schema, 'queued');
    if (ads.some((ad) => ad.expiresAt) && !schema.hasExpiresAt) {
      throw new BadRequestException(
        'CMS campaign expiry migration is required before campaign delivery.',
      );
    }

    const { data: playingRows } = await client
      .from('cms_ad_queue')
      .select('id')
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .limit(1);
    const hadPlaying = (playingRows?.length ?? 0) > 0;

    const externalIds = [
      ...new Set(
        ads.map((ad) => ad.externalAdId).filter((id): id is string => !!id),
      ),
    ];
    let existingRows: Record<string, unknown>[] = [];
    if (externalIds.length) {
      const { data, error: existingError } = await client
        .from('cms_ad_queue')
        .select('*')
        .eq('screen_id', screenId)
        .in('external_ad_id', externalIds);
      if (existingError) {
        this.logger.error(existingError.message);
        throw new BadRequestException(
          `Queue idempotency lookup failed: ${existingError.message}`,
        );
      }
      existingRows = asRecordArray(data);
    }
    const existingIds = new Set(
      existingRows
        .map((row) => row.external_ad_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const newAds = ads.filter(
      (ad) => !ad.externalAdId || !existingIds.has(ad.externalAdId),
    );

    if (newAds.length === 0) {
      const snap = await this.snapshotSupabase(screenId);
      return {
        enqueued: existingRows.map((row) => this.rowToItem(row)),
        playing: snap.currentlyPlaying,
        queued: snap.upcomingQueue,
        interruptedPlaying: false,
      };
    }

    const { data: maxRow, error: maxError } = await client
      .from('cms_ad_queue')
      .select('position')
      .eq('screen_id', screenId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) {
      throw new BadRequestException(
        `Queue position lookup failed: ${maxError.message}`,
      );
    }
    let pos = (maxRow?.position as number | undefined) ?? 0;

    const rows = newAds.map((ad) => {
      pos += 1;
      return this.buildQueueInsertRow(
        schema,
        screenId,
        vehicleId,
        ad,
        pos,
        queuedStatus,
      );
    });

    const { data: inserted, error } = await client
      .from('cms_ad_queue')
      .insert(rows)
      .select('*');
    if (error) {
      if (error.code === '23505' && externalIds.length) {
        const { data: racedRows, error: raceError } = await client
          .from('cms_ad_queue')
          .select('*')
          .eq('screen_id', screenId)
          .in('external_ad_id', externalIds);
        const raceRecords = asRecordArray(racedRows);
        const raceExternalIds = new Set(
          raceRecords
            .map((row) => row.external_ad_id)
            .filter((id): id is string => typeof id === 'string'),
        );
        if (
          !raceError &&
          newAds.every(
            (ad) => !!ad.externalAdId && raceExternalIds.has(ad.externalAdId),
          )
        ) {
          const snap = await this.snapshotSupabase(screenId);
          return {
            enqueued: raceRecords.map((row) => this.rowToItem(row)),
            playing: snap.currentlyPlaying,
            queued: snap.upcomingQueue,
            interruptedPlaying: false,
          };
        }
      }
      this.logger.error(error.message);
      throw new BadRequestException(`Enqueue failed: ${error.message}`);
    }

    if (!hadPlaying) {
      await this.promoteNextSupabase(screenId);
    }

    const snap = await this.snapshotSupabase(screenId);
    return {
      enqueued: asRecordArray(inserted).map((row) => this.rowToItem(row)),
      playing: snap.currentlyPlaying,
      queued: snap.upcomingQueue,
      interruptedPlaying: false,
    };
  }

  private async promoteNextSupabase(screenId: string) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const queuedStatus = statusValue(schema, 'queued');
    await this.expireQueuedSupabase(screenId, schema);

    const { data: playing } = await client
      .from('cms_ad_queue')
      .select('id')
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .maybeSingle();
    if (playing) return null;

    const { data: next } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('screen_id', screenId)
      .eq('status', queuedStatus)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!next) return null;

    const patch: Record<string, unknown> = { status: playingStatus };

    const { error } = await client
      .from('cms_ad_queue')
      .update(patch)
      .eq('id', next.id)
      .eq('status', queuedStatus);
    if (error) {
      this.logger.warn(`promote race: ${error.message}`);
      return null;
    }
    return next.id as string;
  }

  private async startSupabase(
    screenId: string,
    queueItemId: string,
    startedAt: string,
  ) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    if (!schema.hasStartedAt) {
      throw new BadRequestException(
        'CMS playback timestamp migration is required before playback.',
      );
    }

    const playingStatus = statusValue(schema, 'playing');
    const { data, error } = await client
      .from('cms_ad_queue')
      .update({ started_at: startedAt })
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .is('started_at', null)
      .select('id, started_at')
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `Playback start could not be recorded: ${error.message}`,
      );
    }
    if (data) {
      return { startedId: queueItemId, startedAt: data.started_at as string };
    }

    const { data: existing, error: lookupError } = await client
      .from('cms_ad_queue')
      .select('status, started_at')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .maybeSingle();
    if (lookupError) {
      throw new BadRequestException(
        `Playback start lookup failed: ${lookupError.message}`,
      );
    }
    if (existing?.started_at) {
      return {
        startedId: queueItemId,
        startedAt: existing.started_at as string,
      };
    }
    throw new ConflictException('queueItemId is not the PLAYING item');
  }

  private async expireQueuedSupabase(
    screenId: string,
    schema: CmsAdQueueSchema,
  ) {
    if (!schema.hasExpiresAt) return;
    const patch: Record<string, unknown> = {
      status: statusValue(schema, 'cancelled'),
    };
    if (schema.hasEndedAt) patch.ended_at = new Date().toISOString();
    if (schema.hasFailReason) patch.fail_reason = 'campaign_expired';
    const { error } = await this.supabase.client
      .from('cms_ad_queue')
      .update(patch)
      .eq('screen_id', screenId)
      .eq('status', statusValue(schema, 'queued'))
      .lte('expires_at', new Date().toISOString());
    if (error) {
      throw new BadRequestException(
        `Expired campaign queue items could not be cancelled: ${error.message}`,
      );
    }
  }

  private async snapshotSupabase(screenId: string) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const queuedStatus = statusValue(schema, 'queued');
    await this.expireQueuedSupabase(screenId, schema);

    const { data: playing } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .maybeSingle();
    const { data: queued } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('screen_id', screenId)
      .eq('status', queuedStatus)
      .order('position', { ascending: true })
      .limit(40);
    const { data: history } = await client
      .from('cms_playback_history')
      .select('*')
      .eq('screen_id', screenId)
      .order('started_at', { ascending: false })
      .limit(20);

    return {
      currentlyPlaying: playing
        ? {
            id: playing.id,
            title: playing.title,
            advertiser: playing.advertiser,
            durationSec: playing.duration_sec,
            status: playing.status,
            startedAt: playing.started_at ?? null,
            mediaUrl: inferMediaUrl(playing),
            externalAdId: playing.external_ad_id ?? null,
            expiresAt: playing.expires_at ?? null,
          }
        : null,
      upcomingQueue: (queued ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        advertiser: row.advertiser,
        durationSec: row.duration_sec,
        position: row.position,
        status: row.status,
        mediaUrl: inferMediaUrl(row),
        expiresAt: row.expires_at ?? null,
      })),
      playbackHistory: (history ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        advertiser: row.advertiser,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        outcome: row.outcome ?? 'COMPLETED',
      })),
    };
  }

  private async completeSupabase(
    screenId: string,
    queueItemId: string,
    endedAt: string,
  ) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const completedStatus = statusValue(schema, 'completed');

    const { data: playing, error: lookupError } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .maybeSingle();
    if (lookupError) {
      throw new BadRequestException(
        `Playback completion lookup failed: ${lookupError.message}`,
      );
    }
    if (!playing) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    if (playing.status === completedStatus) {
      return this.snapshotSupabase(screenId);
    }
    if (playing.status !== playingStatus) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    const patch: Record<string, unknown> = { status: completedStatus };
    if (schema.hasEndedAt) patch.ended_at = endedAt;
    const { data: completed, error: updateError } = await client
      .from('cms_ad_queue')
      .update(patch)
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .select('*')
      .maybeSingle();
    if (updateError) {
      throw new BadRequestException(
        `Playback completion could not be saved: ${updateError.message}`,
      );
    }
    if (!completed) {
      const { data: current } = await client
        .from('cms_ad_queue')
        .select('status')
        .eq('id', queueItemId)
        .eq('screen_id', screenId)
        .maybeSingle();
      if (current?.status === completedStatus) {
        return this.snapshotSupabase(screenId);
      }
      throw new ConflictException('queueItemId is not the PLAYING item');
    }

    const hist: Record<string, unknown> = {
      screen_id: screenId,
      title: playing.title,
      advertiser: playing.advertiser,
      started_at: playing.started_at ?? endedAt,
      ended_at: endedAt,
    };
    // Optional columns from migration 003
    hist.outcome = 'COMPLETED';
    hist.queue_item_id = queueItemId;
    const { error: histErr } = await client
      .from('cms_playback_history')
      .insert(hist);
    if (histErr) {
      // Legacy history table may lack outcome/queue_item_id — retry minimal
      this.logger.warn(`history insert retry: ${histErr.message}`);
      await client.from('cms_playback_history').insert({
        screen_id: screenId,
        title: playing.title,
        advertiser: playing.advertiser,
        started_at: playing.started_at ?? endedAt,
        ended_at: endedAt,
      });
    }
    await this.promoteNextSupabase(screenId);
    return this.snapshotSupabase(screenId);
  }

  private async failSupabase(
    screenId: string,
    queueItemId: string,
    reason?: string,
    endedAt = new Date().toISOString(),
  ) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const failedStatus = statusValue(schema, 'failed');

    const { data: playing, error: lookupError } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .maybeSingle();
    if (lookupError) {
      throw new BadRequestException(
        `Playback failure lookup failed: ${lookupError.message}`,
      );
    }
    if (!playing) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    if (playing.status === failedStatus) {
      return this.snapshotSupabase(screenId);
    }
    if (playing.status !== playingStatus) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    const patch: Record<string, unknown> = { status: failedStatus };
    if (schema.hasEndedAt) patch.ended_at = endedAt;
    if (schema.hasFailReason) patch.fail_reason = reason ?? 'failed';
    const { data: failed, error: updateError } = await client
      .from('cms_ad_queue')
      .update(patch)
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .select('*')
      .maybeSingle();
    if (updateError) {
      throw new BadRequestException(
        `Playback failure could not be saved: ${updateError.message}`,
      );
    }
    if (!failed) {
      const { data: current } = await client
        .from('cms_ad_queue')
        .select('status')
        .eq('id', queueItemId)
        .eq('screen_id', screenId)
        .maybeSingle();
      if (current?.status === failedStatus) {
        return this.snapshotSupabase(screenId);
      }
      throw new ConflictException('queueItemId is not the PLAYING item');
    }

    const { error: histErr } = await client.from('cms_playback_history').insert({
      screen_id: screenId,
      queue_item_id: queueItemId,
      title: playing.title,
      advertiser: playing.advertiser,
      started_at: playing.started_at ?? endedAt,
      ended_at: endedAt,
      outcome: 'FAILED',
    });
    if (histErr) {
      await client.from('cms_playback_history').insert({
        screen_id: screenId,
        title: playing.title,
        advertiser: playing.advertiser,
        started_at: playing.started_at ?? endedAt,
        ended_at: endedAt,
      });
    }
    await this.promoteNextSupabase(screenId);
    return this.snapshotSupabase(screenId);
  }

  private async cancelSupabase(screenId: string, queueItemId: string) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const queuedStatus = statusValue(schema, 'queued');
    const cancelledStatus = statusValue(schema, 'cancelled');
    const { data: item, error: lookupError } = await client
      .from('cms_ad_queue')
      .select('id, status')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .maybeSingle();
    if (lookupError) {
      throw new BadRequestException(
        `Queue cancellation lookup failed: ${lookupError.message}`,
      );
    }
    if (!item) throw new NotFoundException('Queue item not found');
    if (item.status === cancelledStatus) {
      return { cancelledId: queueItemId, status: cancelledStatus };
    }
    if (item.status !== queuedStatus) {
      return { cancelledId: null, status: item.status };
    }

    const patch: Record<string, unknown> = { status: cancelledStatus };
    if (schema.hasEndedAt) patch.ended_at = new Date().toISOString();
    if (schema.hasFailReason) patch.fail_reason = 'campaign_cancelled';

    const { data, error } = await client
      .from('cms_ad_queue')
      .update(patch)
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', queuedStatus)
      .select('id, status')
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `Queue item could not be cancelled: ${error.message}`,
      );
    }
    if (data) {
      return { cancelledId: data.id, status: data.status };
    }
    const { data: current, error: currentError } = await client
      .from('cms_ad_queue')
      .select('status')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .maybeSingle();
    if (currentError) {
      throw new BadRequestException(
        `Queue cancellation status lookup failed: ${currentError.message}`,
      );
    }
    if (!current) throw new NotFoundException('Queue item not found');
    return {
      cancelledId: current.status === cancelledStatus ? queueItemId : null,
      status: current.status,
    };
  }

  private rowToItem(row: Record<string, unknown>): QueueItem {
    return {
      id: row.id as string,
      screenId: row.screen_id as string,
      vehicleId: (row.vehicle_id as string) ?? '',
      title: row.title as string,
      advertiser: (row.advertiser as string) ?? '',
      durationSec: (row.duration_sec as number) ?? 30,
      position: (row.position as number) ?? 0,
      status: row.status as QueueItem['status'],
      externalAdId: (row.external_ad_id as string) ?? null,
      expiresAt: (row.expires_at as string) ?? null,
      mediaUrl: inferMediaUrl({
        media_url: row.media_url as string | null,
        title: row.title as string | null,
        external_ad_id: row.external_ad_id as string | null,
        advertiser: row.advertiser as string | null,
      }),
      startedAt: (row.started_at as string) ?? null,
      endedAt: (row.ended_at as string) ?? null,
      failReason: (row.fail_reason as string) ?? null,
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
    };
  }
}
