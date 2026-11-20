-- Admin Device Management — deepen registry/telemetry/commands (Phases 1–12 gap fill)
-- Admin Supabase only. Non-destructive. Do NOT auto-execute.
-- Apply after 202603190001…006 (see ADMIN_DM_APPLY.md).

-- Registry deep fields
ALTER TABLE admin_dm_devices
  ADD COLUMN IF NOT EXISTS device_model text,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS hardware_id text,
  ADD COLUMN IF NOT EXISTS firmware_version text,
  ADD COLUMN IF NOT EXISTS player_version text;

-- Allow pending_activation + active (keep activated for back-compat rows)
ALTER TABLE admin_dm_devices DROP CONSTRAINT IF EXISTS admin_dm_devices_lifecycle_chk;
ALTER TABLE admin_dm_devices
  ADD CONSTRAINT admin_dm_devices_lifecycle_chk CHECK (
    lifecycle_status IN (
      'registered',
      'pending_activation',
      'activated',
      'active',
      'maintenance',
      'suspended',
      'revoked'
    )
  );

-- Credential expiry
ALTER TABLE admin_dm_credentials
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Richer telemetry (nullable — never fabricate)
ALTER TABLE admin_dm_telemetry
  ADD COLUMN IF NOT EXISTS memory_used_mb double precision,
  ADD COLUMN IF NOT EXISTS memory_total_mb double precision,
  ADD COLUMN IF NOT EXISTS signal_strength integer,
  ADD COLUMN IF NOT EXISTS temperature_c double precision,
  ADD COLUMN IF NOT EXISTS storage_total_mb double precision;

ALTER TABLE admin_dm_heartbeats
  ADD COLUMN IF NOT EXISTS memory_used_mb double precision,
  ADD COLUMN IF NOT EXISTS memory_total_mb double precision,
  ADD COLUMN IF NOT EXISTS signal_strength integer,
  ADD COLUMN IF NOT EXISTS temperature_c double precision,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS admin_dm_heartbeats_idem_idx
  ON admin_dm_heartbeats (device_pk, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Assignment history deepen
ALTER TABLE admin_dm_assignments
  ADD COLUMN IF NOT EXISTS previous_vehicle_no text,
  ADD COLUMN IF NOT EXISTS new_vehicle_no text,
  ADD COLUMN IF NOT EXISTS assignment_status text DEFAULT 'active';

-- Config: per-device heartbeat/offline settings
ALTER TABLE admin_dm_config
  ADD COLUMN IF NOT EXISTS heartbeat_interval_sec integer,
  ADD COLUMN IF NOT EXISTS offline_timeout_sec integer;

-- Command lifecycle deepen + playback commands
ALTER TABLE admin_dm_commands DROP CONSTRAINT IF EXISTS admin_dm_commands_status_chk;
ALTER TABLE admin_dm_commands
  ADD CONSTRAINT admin_dm_commands_status_chk CHECK (
    status IN (
      'pending',
      'delivered',
      'acknowledged',
      'executing',
      'completed',
      'failed',
      'expired'
    )
  );

ALTER TABLE admin_dm_commands DROP CONSTRAINT IF EXISTS admin_dm_commands_type_chk;
ALTER TABLE admin_dm_commands
  ADD CONSTRAINT admin_dm_commands_type_chk CHECK (
    command_type IN (
      'request_status',
      'sync_media',
      'refresh_manifest',
      'update_config',
      'restart_player',
      'start_playback',
      'stop_playback',
      'suspend_device',
      'revoke_device',
      'disable_device'
    )
  );

ALTER TABLE admin_dm_commands
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS executing_at timestamptz;

-- Recreate status view with deeper columns (must DROP — CREATE OR REPLACE cannot rename columns)
DROP VIEW IF EXISTS admin_dm_device_status;
CREATE VIEW admin_dm_device_status AS
SELECT
  d.id,
  d.device_id,
  d.name,
  d.device_type,
  d.device_model,
  d.manufacturer,
  d.serial_number,
  d.platform,
  d.firmware_version,
  d.player_version,
  d.vehicle_no,
  d.marker_dev_id,
  d.lifecycle_status,
  d.registered_at,
  d.activated_at,
  d.updated_at,
  t.last_heartbeat_at,
  t.player_status,
  t.network_status,
  t.app_version,
  t.health_status,
  t.battery_pct,
  t.storage_free_mb,
  t.storage_total_mb,
  t.memory_used_mb,
  t.signal_strength,
  t.temperature_c,
  t.error_code,
  t.lat AS device_lat,
  t.lng AS device_lng,
  t.updated_at AS telemetry_updated_at
FROM admin_dm_devices d
LEFT JOIN admin_dm_telemetry t ON t.device_pk = d.id;
