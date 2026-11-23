import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { DashboardResponse } from './api';

const SNAPSHOT_PREFIX = 'cms.display.snapshot.v1.';
const EVENTS_PREFIX = 'cms.display.events.v1.';
const MEDIA_DIRECTORY = 'campaign-media';
const MAX_OFFLINE_VIDEO_BYTES = 100 * 1024 * 1024;
const IMAGE_CACHE = 'cms-ad-media-images-v2';
const downloadInProgress = new Set<string>();
const failedDownloads = new Map<string, number>();

export type PlaybackEvent =
  | { type: 'start'; queueItemId: string; occurredAt: string }
  | { type: 'complete'; queueItemId: string; occurredAt: string }
  | {
      type: 'fail';
      queueItemId: string;
      occurredAt: string;
      reason: string;
    };

function isExpired(item: { expiresAt?: string | null }, now = Date.now()) {
  if (!item.expiresAt) return false;
  const expiresAt = Date.parse(item.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function snapshotKey(screenId: string) {
  return `${SNAPSHOT_PREFIX}${screenId}`;
}

function eventsKey(screenId: string) {
  return `${EVENTS_PREFIX}${screenId}`;
}

export function loadDisplaySnapshot(
  screenId: string | undefined,
): DashboardResponse | null {
  if (!screenId) return null;
  try {
    const raw = localStorage.getItem(snapshotKey(screenId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardResponse;
    if (
      parsed?.screen?.id !== screenId ||
      !Array.isArray(parsed.upcomingQueue)
    ) {
      localStorage.removeItem(snapshotKey(screenId));
      return null;
    }
    return {
      ...parsed,
      upcomingQueue: parsed.upcomingQueue.filter((item) => !isExpired(item)),
    };
  } catch (error) {
    console.warn('Persisted display queue could not be restored', error);
    return null;
  }
}

export function saveDisplaySnapshot(
  screenId: string,
  snapshot: DashboardResponse,
) {
  if (snapshot.screen.id !== screenId) {
    throw new Error('Refusing to persist a dashboard for another screen');
  }
  localStorage.setItem(snapshotKey(screenId), JSON.stringify(snapshot));
}

export function pendingPlaybackEvents(screenId: string): PlaybackEvent[] {
  const raw = localStorage.getItem(eventsKey(screenId));
  if (!raw) return [];
  const parsed = JSON.parse(raw) as PlaybackEvent[];
  if (!Array.isArray(parsed)) {
    localStorage.removeItem(eventsKey(screenId));
    return [];
  }
  return parsed.filter(
    (event) =>
      typeof event.queueItemId === 'string' &&
      typeof event.occurredAt === 'string' &&
      ['start', 'complete', 'fail'].includes(event.type) &&
      (event.type !== 'fail' || typeof event.reason === 'string'),
  );
}

export function queuePlaybackEvent(screenId: string, event: PlaybackEvent) {
  const events = pendingPlaybackEvents(screenId);
  if (
    events.some(
      (pending) =>
        pending.type === event.type &&
        pending.queueItemId === event.queueItemId,
    )
  ) {
    return;
  }
  events.push(event);
  localStorage.setItem(eventsKey(screenId), JSON.stringify(events));
}

export function removePlaybackEvent(
  screenId: string,
  event: PlaybackEvent,
) {
  const remaining = pendingPlaybackEvents(screenId).filter(
    (pending) =>
      pending.type !== event.type ||
      pending.queueItemId !== event.queueItemId,
  );
  if (remaining.length) {
    localStorage.setItem(eventsKey(screenId), JSON.stringify(remaining));
  } else {
    localStorage.removeItem(eventsKey(screenId));
  }
}

export function advanceOfflineSnapshot(
  snapshot: DashboardResponse,
  queueItemId: string,
  occurredAt: string,
): DashboardResponse {
  if (snapshot.currentlyPlaying?.id !== queueItemId) return snapshot;
  const upcoming = snapshot.upcomingQueue.filter((item) => !isExpired(item));
  const next = upcoming[0];
  return {
    ...snapshot,
    currentlyPlaying: next
      ? {
          ...next,
          status: 'PLAYING',
          startedAt: occurredAt,
        }
      : null,
    upcomingQueue: next ? upcoming.slice(1) : [],
    fetchedAt: occurredAt,
  };
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|ogg|m4v)(\?|$)/i.test(url) || /\/video\//i.test(url);
}

function safeMediaPath(screenId: string, queueItemId: string, url: string) {
  const extension = new URL(url, window.location.origin).pathname.match(
    /\.(mp4|webm|ogg|m4v)$/i,
  )?.[1];
  if (!extension) return null;
  const safeScreenId = screenId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeQueueId = queueItemId.replace(/[^a-zA-Z0-9-]/g, '');
  if (!safeScreenId || !safeQueueId) return null;
  return `${MEDIA_DIRECTORY}/${safeScreenId}/${safeQueueId}.${extension.toLowerCase()}`;
}

function safeScreenDirectory(screenId: string) {
  const safeScreenId = screenId.replace(/[^a-zA-Z0-9-]/g, '');
  if (!safeScreenId) return null;
  return `${MEDIA_DIRECTORY}/${safeScreenId}`;
}

async function mediaUri(path: string) {
  return Filesystem.getUri({ directory: Directory.Data, path });
}

async function nativeVideoExists(path: string) {
  try {
    const stat = await Filesystem.stat({ directory: Directory.Data, path });
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function cacheNativeVideo(
  screenId: string,
  item: { id: string; mediaUrl?: string | null; expiresAt?: string | null },
) {
  if (
    !Capacitor.isNativePlatform() ||
    !item.mediaUrl ||
    !isVideoUrl(item.mediaUrl) ||
    isExpired(item)
  ) {
    return;
  }
  const path = safeMediaPath(screenId, item.id, item.mediaUrl);
  if (!path) return;
  const key = `${screenId}:${item.id}`;
  const failedAt = failedDownloads.get(key);
  if (failedAt && Date.now() - failedAt < 60_000) return;
  if (downloadInProgress.has(key) || (await nativeVideoExists(path))) return;
  downloadInProgress.add(key);
  try {
    const head = await fetch(item.mediaUrl, {
      method: 'HEAD',
      credentials: 'omit',
      cache: 'no-store',
    });
    const size = Number(head.headers.get('content-length'));
    if (
      !head.ok ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > MAX_OFFLINE_VIDEO_BYTES
    ) {
      return;
    }
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: `${MEDIA_DIRECTORY}/${screenId}`,
      recursive: true,
    });
    const destination = await mediaUri(path);
    await FileTransfer.downloadFile({
      url: item.mediaUrl,
      path: destination.uri,
    });
    failedDownloads.delete(key);
  } catch (error) {
    failedDownloads.set(key, Date.now());
    throw error;
  } finally {
    downloadInProgress.delete(key);
  }
}

export async function cacheAssignedVideos(
  screenId: string,
  snapshot: DashboardResponse,
) {
  if (!Capacitor.isNativePlatform() || !navigator.onLine) return;
  const items = [snapshot.currentlyPlaying, ...snapshot.upcomingQueue].filter(
    (item) => item !== null && !isExpired(item),
  );
  for (const item of items) {
    try {
      await cacheNativeVideo(screenId, item);
    } catch (error) {
      console.warn(`Offline video could not be cached for ${item.id}`, error);
    }
  }
  await cleanupNativeVideos(screenId, items);
}

export async function cachedNativeVideoUrl(
  screenId: string,
  item: { id: string; mediaUrl?: string | null },
) {
  if (!Capacitor.isNativePlatform() || !item.mediaUrl) return null;
  const path = safeMediaPath(screenId, item.id, item.mediaUrl);
  if (!path || !(await nativeVideoExists(path))) return null;
  const uri = await mediaUri(path);
  return Capacitor.convertFileSrc(uri.uri);
}

async function cleanupNativeVideos(
  screenId: string,
  retained: Array<{ id: string; mediaUrl?: string | null }>,
) {
  const directory = safeScreenDirectory(screenId);
  if (!directory) return;
  const retainedPaths = new Set(
    retained
      .map((item) =>
        item.mediaUrl
          ? safeMediaPath(screenId, item.id, item.mediaUrl)
          : null,
      )
      .filter((path): path is string => path !== null),
  );
  try {
    const { files } = await Filesystem.readdir({
      directory: Directory.Data,
      path: directory,
    });
    for (const file of files) {
      const path = `${directory}/${file.name}`;
      if (!retainedPaths.has(path)) {
        await Filesystem.deleteFile({ directory: Directory.Data, path });
      }
    }
  } catch {
    console.warn('Cached display media could not be enumerated for cleanup');
  }
}

export function isCampaignExpired(item: { expiresAt?: string | null }) {
  return isExpired(item);
}

export async function cleanupUnassignedImages(
  previous: DashboardResponse,
  current: DashboardResponse,
) {
  if (typeof caches === 'undefined') return;
  const activeUrls = new Set(
    [current.currentlyPlaying, ...current.upcomingQueue]
      .filter((item) => item && !isExpired(item))
      .map((item) => item?.mediaUrl)
      .filter(
        (url): url is string =>
          typeof url === 'string' && !isVideoUrl(url),
      )
      .map((url) => new URL(url, window.location.origin).toString()),
  );
  const previousUrls = new Set(
    [previous.currentlyPlaying, ...previous.upcomingQueue]
      .map((item) => item?.mediaUrl)
      .filter(
        (url): url is string =>
          typeof url === 'string' && !isVideoUrl(url),
      )
      .map((url) => new URL(url, window.location.origin).toString()),
  );
  const cache = await caches.open(IMAGE_CACHE);
  for (const url of previousUrls) {
    if (!activeUrls.has(url)) await cache.delete(url);
  }
}
