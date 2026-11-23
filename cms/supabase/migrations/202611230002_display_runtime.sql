ALTER TABLE cms_ad_queue
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cms_ad_queue_expiry
  ON cms_ad_queue (screen_id, expires_at)
  WHERE status = 'QUEUED' AND expires_at IS NOT NULL;

ALTER TABLE cms_device_status
  ADD COLUMN IF NOT EXISTS screen_status text NOT NULL DEFAULT 'idle'
    CHECK (screen_status IN ('idle', 'playing', 'error', 'offline')),
  ADD COLUMN IF NOT EXISTS current_queue_item_id uuid
    REFERENCES cms_ad_queue (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_campaign_id text,
  ADD COLUMN IF NOT EXISTS last_playback_error text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

COMMENT ON COLUMN cms_ad_queue.expires_at IS
  'Campaign playback deadline. Expired QUEUED items are cancelled before promotion.';
COMMENT ON COLUMN cms_device_status.last_sync_at IS
  'Most recent successful display heartbeat / queue synchronization.';
