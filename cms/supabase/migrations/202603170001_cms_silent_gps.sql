-- Silent device GPS: extend cms_vehicle_location for Display PWA ingest + Admin Realtime.
-- Same Supabase project. Nest service-role writes; clients never see service-role keys.

ALTER TABLE cms_vehicle_location
  ADD COLUMN IF NOT EXISTS auto_number text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS tracking_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'device_gps';

COMMENT ON COLUMN cms_vehicle_location.accuracy_m IS 'Horizontal accuracy in meters from device GPS';
COMMENT ON COLUMN cms_vehicle_location.tracking_active IS 'True while authenticated CMS session is actively reporting';
COMMENT ON COLUMN cms_vehicle_location.source IS 'device_gps for live ingest only — never invent coordinates';

CREATE INDEX IF NOT EXISTS idx_cms_vehicle_location_updated
  ON cms_vehicle_location (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_vehicle_location_tracking
  ON cms_vehicle_location (tracking_active)
  WHERE tracking_active = true;

-- Operators may not INSERT/UPDATE from the browser; Nest uses service role.
-- Keep existing SELECT for own vehicle. Admin fleet reads via service role or Nest proxy.

DROP POLICY IF EXISTS cms_location_own_vehicle ON cms_vehicle_location;
CREATE POLICY cms_location_own_vehicle ON cms_vehicle_location
  FOR SELECT TO authenticated
  USING (
    vehicle_id IN (
      SELECT vehicle_id FROM cms_operators WHERE auth_user_id = auth.uid()
    )
  );

-- Realtime for Admin live map (ignore error if already added).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE cms_vehicle_location;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
