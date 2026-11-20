import { randomUUID } from 'crypto';
import type {
  EnqueueAdInput,
  PlaybackHistoryItem,
  QueueItem,
  QueueStatus,
} from './queue.types';

/**
 * In-process queue + history for CMS_DEV_AUTH / unit tests.
 * Not a physical player — state machine only. No fake seed history.
 */
export class MemoryQueueStore {
  private items: QueueItem[] = [];
  private history: PlaybackHistoryItem[] = [];
  private locks = new Map<string, Promise<void>>();

  async withScreenLock<T>(screenId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(screenId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(
      screenId,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(screenId) === gate) {
        this.locks.delete(screenId);
      }
    }
  }

  listByScreen(screenId: string) {
    return this.items
      .filter((i) => i.screenId === screenId)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }

  listHistory(screenId: string, limit = 20) {
    return this.history
      .filter((h) => h.screenId === screenId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  playing(screenId: string) {
    return this.items.find((i) => i.screenId === screenId && i.status === 'PLAYING') ?? null;
  }

  queued(screenId: string) {
    return this.listByScreen(screenId).filter((i) => i.status === 'QUEUED');
  }

  nextPosition(screenId: string) {
    const max = this.listByScreen(screenId).reduce(
      (m, i) => Math.max(m, i.position),
      0,
    );
    return max + 1;
  }

  append(
    screenId: string,
    vehicleId: string,
    ads: EnqueueAdInput[],
  ): QueueItem[] {
    const created: QueueItem[] = [];
    let pos = this.nextPosition(screenId);
    for (const ad of ads) {
      const item: QueueItem = {
        id: randomUUID(),
        screenId,
        vehicleId,
        title: ad.title,
        advertiser: ad.advertiser ?? '',
        durationSec: ad.durationSec ?? 30,
        position: pos++,
        status: 'QUEUED',
        externalAdId: ad.externalAdId ?? null,
        mediaUrl: ad.mediaUrl?.trim() || null,
        startedAt: null,
        endedAt: null,
        failReason: null,
        createdAt: new Date().toISOString(),
      };
      this.items.push(item);
      created.push(item);
    }
    return created;
  }

  setStatus(
    id: string,
    status: QueueStatus,
    patch: Partial<QueueItem> = {},
  ): QueueItem | null {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, patch, { status });
    return item;
  }

  addHistory(entry: Omit<PlaybackHistoryItem, 'id'>): PlaybackHistoryItem {
    const row: PlaybackHistoryItem = { id: randomUUID(), ...entry };
    this.history.push(row);
    return row;
  }

  /** Test helper — wipe memory (no fake seed data). */
  reset() {
    this.items = [];
    this.history = [];
    this.locks.clear();
  }
}

/** Shared singleton for Nest + tests when not using Supabase. */
export const memoryQueueStore = new MemoryQueueStore();
