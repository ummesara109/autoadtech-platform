-- Admin Device Management — Device Registry (Phase 2)
-- Admin Supabase only. Non-destructive: CREATE IF NOT EXISTS.
-- Do NOT apply to Advertiser. Do NOT truncate existing admin_devices.
-- Apply manually after review (see admin/sql/ADMIN_DM_APPLY.md).

CREATE TABLE IF NOT EXISTS admin_dm_devices (
  id text PRIMARY KEY,
  device_id text NOT NULL UNIQUE,
  name text NOT NULL,
  device_type text NOT NULL DEFAULT 'display',
  platform text NOT NULL DEFAULT 'unknown',
  vehicle_no text,
  vehicle_id text,
  marker_dev_id text,
  install_date date,
  registered_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  lifecycle_status text NOT NULL DEFAULT 'registered',
  notes text NOT NULL DEFAULT '',
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_dm_devices_lifecycle_chk CHECK (
    lifecycle_status IN (
      'registered',
      'activated',
      'maintenance',
      'suspended',
      'revoked'
    )
  )
);

CREATE INDEX IF NOT EXISTS admin_dm_devices_vehicle_idx
  ON admin_dm_devices (vehicle_no)
  WHERE vehicle_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS admin_dm_devices_lifecycle_idx
  ON admin_dm_devices (lifecycle_status);

CREATE INDEX IF NOT EXISTS admin_dm_devices_marker_idx
  ON admin_dm_devices (marker_dev_id)
  WHERE marker_dev_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_dm_devices_one_active_vehicle_idx
  ON admin_dm_devices (vehicle_no)
  WHERE vehicle_no IS NOT NULL
    AND lifecycle_status IN ('registered', 'activated', 'maintenance');
