-- Admin Device Management — Activity logs + Assignment history + Maintenance (Phase 2)
-- Never delete history on revoke/replace.
-- Admin Supabase only. Non-destructive.

CREATE TABLE IF NOT EXISTS admin_dm_activity (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL DEFAULT '',
  actor text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_dm_activity_device_created_idx
  ON admin_dm_activity (device_pk, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_dm_activity_type_idx
  ON admin_dm_activity (event_type);

CREATE TABLE IF NOT EXISTS admin_dm_assignments (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  vehicle_no text,
  vehicle_id text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  assigned_by text,
  reason text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS admin_dm_assignments_device_idx
  ON admin_dm_assignments (device_pk, assigned_at DESC);

CREATE INDEX IF NOT EXISTS admin_dm_assignments_active_vehicle_idx
  ON admin_dm_assignments (vehicle_no)
  WHERE unassigned_at IS NULL AND vehicle_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_dm_maintenance (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by text,
  completed_at timestamptz,
  completed_by text
);

CREATE INDEX IF NOT EXISTS admin_dm_maintenance_device_idx
  ON admin_dm_maintenance (device_pk, started_at DESC);

CREATE INDEX IF NOT EXISTS admin_dm_maintenance_open_idx
  ON admin_dm_maintenance (device_pk)
  WHERE completed_at IS NULL;
