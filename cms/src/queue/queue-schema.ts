import type { SupabaseClient } from '@supabase/supabase-js';
import { DEV_DEMO_ADS } from '../auth/dev-seed';

export type QueueStatusMode = 'upper' | 'lower';

export type CmsAdQueueSchema = {
  statusMode: QueueStatusMode;
  hasMediaUrl: boolean;
  hasExternalAdId: boolean;
  hasVehicleId: boolean;
  hasStartedAt: boolean;
  hasEndedAt: boolean;
  hasFailReason: boolean;
  hasExpiresAt: boolean;
};

const statusMap = {
  upper: {
    queued: 'QUEUED',
    playing: 'PLAYING',
    completed: 'COMPLETED',
    failed: 'FAILED',
    cancelled: 'CANCELLED',
  },
  lower: {
    queued: 'queued',
    playing: 'playing',
    completed: 'done',
    failed: 'skipped',
    cancelled: 'skipped',
  },
} as const;

let cached: CmsAdQueueSchema | null = null;

export function statusValue(
  schema: CmsAdQueueSchema,
  key: keyof (typeof statusMap)['upper'],
): string {
  return statusMap[schema.statusMode][key];
}

/** Infer demo media path when media_url column is absent. */
export function inferMediaUrl(row: {
  media_url?: string | null;
  title?: string | null;
  external_ad_id?: string | null;
  advertiser?: string | null;
}): string | null {
  if (row.media_url && String(row.media_url).trim()) {
    return String(row.media_url).trim();
  }
  const title = String(row.title || '');
  const ext = String(row.external_ad_id || '');
  const adv = String(row.advertiser || '');
  const hit = DEV_DEMO_ADS.find(
    (a) =>
      a.title === title || a.externalAdId === ext ||
      adv.includes(a.mediaUrl),
  );
  if (hit) return hit.mediaUrl;
  // Admin may stash path in advertiser as "Name|/path.mp4"
  const pipe = adv.split('|').map((s) => s.trim());
  if (pipe.length >= 2 && pipe[pipe.length - 1].startsWith('/')) {
    return pipe[pipe.length - 1];
  }
  return null;
}

export async function detectCmsAdQueueSchema(
  client: SupabaseClient,
): Promise<CmsAdQueueSchema> {
  if (cached) return cached;

  const probe = async (col: string) => {
    const { error } = await client.from('cms_ad_queue').select(col).limit(1);
    return !error;
  };

  const hasMediaUrl = await probe('media_url');
  const hasExternalAdId = await probe('external_ad_id');
  const hasVehicleId = await probe('vehicle_id');
  const hasStartedAt = await probe('started_at');
  const hasEndedAt = await probe('ended_at');
  const hasFailReason = await probe('fail_reason');
  const hasExpiresAt = await probe('expires_at');

  // Uppercase QUEUED only works after migration 003; milestone1 uses lowercase.
  let statusMode: QueueStatusMode = 'lower';
  const { error: upperErr } = await client
    .from('cms_ad_queue')
    .select('id')
    .eq('status', 'QUEUED')
    .limit(1);
  // select doesn't validate check constraint; probe via a dry insert is heavy.
  // Prefer: if media_url exists, assume 003/004 applied → upper.
  if (hasMediaUrl && hasExternalAdId && hasVehicleId) {
    statusMode = 'upper';
  } else {
    statusMode = 'lower';
  }
  // Silence unused
  void upperErr;

  cached = {
    statusMode,
    hasMediaUrl,
    hasExternalAdId,
    hasVehicleId,
    hasStartedAt,
    hasEndedAt,
    hasFailReason,
    hasExpiresAt,
  };
  return cached;
}

/** Test helper / after migrations applied in same process. */
export function resetCmsAdQueueSchemaCache() {
  cached = null;
}
