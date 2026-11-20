-- Optional creative URL for display PWA (filled by ad-delivery / MQTT worker).
-- Display shows media ONLY when media_url is a non-empty http(s) URL.
ALTER TABLE cms_ad_queue
  ADD COLUMN IF NOT EXISTS media_url text;

COMMENT ON COLUMN cms_ad_queue.media_url IS
  'HTTPS creative URL for the Auto Display PWA. Empty = waiting state (do not invent playback).';
