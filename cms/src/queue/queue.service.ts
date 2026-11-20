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

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly memory: MemoryQueueStore = memoryQueueStore;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * CMS_DEV_AUTH / local: if screen has no PLAYING and no QUEUED,
   * enqueue the two demo MP4s (first promotes to PLAYING). Never interrupts PLAYING.
   * Works for in-memory store and Supabase (Admin-provisioned screens).
   * Callers must gate on CMS_DEV_AUTH — this method does not invent GPS.
   * Returns true when ads were seeded.
   */
  async ensureDevDemoAdsIfEmpty(screenId: string): Promise<boolean> {
    if (this.supabase.isConfigured) {
      const snap = await this.snapshotSupabase(screenId);
      if (
        snap.currentlyPlaying ||
        (snap.upcomingQueue?.length ?? 0) > 0
      ) {
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
      `Local demo seed for screen ${screenId}: ${ads.map((a) => a.mediaUrl).join(' → ')}`,
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
    const vehicleId = opts?.vehicleId ?? (await this.resolveScreenVehicle(screenId));
    if (opts?.vehicleId && opts.vehicleId !== vehicleId) {
      throw new BadRequestException('vehicleId does not match screen');
    }

    const result = this.supabase.isConfigured
      ? await this.enqueueSupabase(screenId, vehicleId, ads)
      : await this.memory.withScreenLock(screenId, async () => {
          const playingBefore = this.memory.playing(screenId);
          const created = this.memory.append(screenId, vehicleId, ads);
          // Never interrupt PLAYING — only start if idle
          if (!playingBefore) {
            await this.promoteNextLocked(screenId);
          }
          return {
            enqueued: created,
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

  /**
   * Player / MQTT worker ACK: mark current PLAYING complete and advance.
   * Does not invent history for ads that never played.
   */
  async completePlaying(screenId: string, queueItemId: string) {
    const result = this.supabase.isConfigured
      ? await this.completeSupabase(screenId, queueItemId)
      : await this.memory.withScreenLock(screenId, async () => {
          const playing = this.memory.playing(screenId);
          if (!playing || playing.id !== queueItemId) {
            throw new ConflictException('queueItemId is not the PLAYING item');
          }
          const endedAt = new Date().toISOString();
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

  async failPlaying(screenId: string, queueItemId: string, reason?: string) {
    const result = this.supabase.isConfigured
      ? await this.failSupabase(screenId, queueItemId, reason)
      : await this.memory.withScreenLock(screenId, async () => {
          const playing = this.memory.playing(screenId);
          if (!playing || playing.id !== queueItemId) {
            throw new ConflictException('queueItemId is not the PLAYING item');
          }
          const endedAt = new Date().toISOString();
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
          if (item.status !== 'QUEUED') {
            throw new BadRequestException('Only QUEUED items can be cancelled');
          }
          this.memory.setStatus(queueItemId, 'CANCELLED', {
            endedAt: new Date().toISOString(),
          });
          return { cancelledId: queueItemId };
        });
    await this.invalidateDashboard(screenId);
    return result;
  }

  /** Test-only reset of memory store. */
  resetMemory() {
    this.memory.reset();
  }

  private async promoteNextLocked(screenId: string) {
    if (this.memory.playing(screenId)) return null;
    const next = this.memory.queued(screenId)[0];
    if (!next) return null;
    const startedAt = new Date().toISOString();
    return this.memory.setStatus(next.id, 'PLAYING', { startedAt });
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

    const { data: playingRows } = await client
      .from('cms_ad_queue')
      .select('id')
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .limit(1);
    const hadPlaying = (playingRows?.length ?? 0) > 0;

    const { data: maxRow } = await client
      .from('cms_ad_queue')
      .select('position')
      .eq('screen_id', screenId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let pos = (maxRow?.position as number | undefined) ?? 0;

    const rows = ads.map((ad) => {
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
      this.logger.error(error.message);
      throw new BadRequestException(`Enqueue failed: ${error.message}`);
    }

    if (!hadPlaying) {
      await this.promoteNextSupabase(screenId);
    }

    const snap = await this.snapshotSupabase(screenId);
    return {
      enqueued: (inserted ?? []).map((r) => this.rowToItem(r)),
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
    if (schema.hasStartedAt) patch.started_at = new Date().toISOString();

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

  private async snapshotSupabase(screenId: string) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const queuedStatus = statusValue(schema, 'queued');

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

  private async completeSupabase(screenId: string, queueItemId: string) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const completedStatus = statusValue(schema, 'completed');

    const { data: playing } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .maybeSingle();
    if (!playing) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    const endedAt = new Date().toISOString();
    const patch: Record<string, unknown> = { status: completedStatus };
    if (schema.hasEndedAt) patch.ended_at = endedAt;
    await client.from('cms_ad_queue').update(patch).eq('id', queueItemId);

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
  ) {
    const client = this.supabase.client;
    const schema = await this.queueSchema();
    const playingStatus = statusValue(schema, 'playing');
    const failedStatus = statusValue(schema, 'failed');

    const { data: playing } = await client
      .from('cms_ad_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', playingStatus)
      .maybeSingle();
    if (!playing) {
      throw new ConflictException('queueItemId is not the PLAYING item');
    }
    const endedAt = new Date().toISOString();
    const patch: Record<string, unknown> = { status: failedStatus };
    if (schema.hasEndedAt) patch.ended_at = endedAt;
    if (schema.hasFailReason) patch.fail_reason = reason ?? 'failed';
    await client.from('cms_ad_queue').update(patch).eq('id', queueItemId);

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

    const patch: Record<string, unknown> = { status: cancelledStatus };
    if (schema.hasEndedAt) patch.ended_at = new Date().toISOString();

    const { data, error } = await client
      .from('cms_ad_queue')
      .update(patch)
      .eq('id', queueItemId)
      .eq('screen_id', screenId)
      .eq('status', queuedStatus)
      .select('id')
      .maybeSingle();
    if (error || !data) {
      throw new BadRequestException('Only QUEUED items can be cancelled');
    }
    return { cancelledId: data.id };
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
