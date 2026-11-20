-- CP-55: Admin Live "Now playing" from CMS currentlyPlaying (piggyback on GPS).
-- Admin Supabase only. Non-destructive. Do not apply to Advertiser.

ALTER TABLE cms_admin_vehicle_gps
  ADD COLUMN IF NOT EXISTS current_ad_id text,
  ADD COLUMN IF NOT EXISTS current_ad_title text,
  ADD COLUMN IF NOT EXISTS current_ad_media_url text,
  ADD COLUMN IF NOT EXISTS current_ad_updated_at timestamptz;
