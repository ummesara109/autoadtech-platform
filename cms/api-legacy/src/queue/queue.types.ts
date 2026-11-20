export const QUEUE_STATUSES = [
  'QUEUED',
  'PLAYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export type QueueItem = {
  id: string;
  screenId: string;
  vehicleId: string;
  title: string;
  advertiser: string;
  durationSec: number;
  position: number;
  status: QueueStatus;
  externalAdId?: string | null;
  /** Real creative URL from ad delivery — display PWA only renders when set. */
  mediaUrl?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  failReason?: string | null;
  createdAt: string;
};

export type EnqueueAdInput = {
  title: string;
  advertiser?: string;
  durationSec?: number;
  externalAdId?: string;
  mediaUrl?: string;
};

export type PlaybackHistoryItem = {
  id: string;
  screenId: string;
  queueItemId: string | null;
  title: string;
  advertiser: string;
  startedAt: string;
  endedAt: string | null;
  outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
};
