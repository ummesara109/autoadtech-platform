-- Protect campaign delivery retries from appending the same campaign twice
-- to a screen. Legacy queue rows with NULL external_ad_id remain unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cms_ad_queue_screen_external_ad_id
  ON cms_ad_queue (screen_id, external_ad_id);
