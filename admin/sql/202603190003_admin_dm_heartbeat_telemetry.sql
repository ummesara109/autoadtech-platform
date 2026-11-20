-- Admin Device Management — Heartbeats + Telemetry (Phase 2)
-- Connection/online status is derived from heartbeat age ONLY.
-- Never treat phone GPS (cms_admin_vehicle_gps) as heartbeat.
-- Admin Supabase only. Non-destructive.

CREATE TABLE IF NOT EXISTS admin_dm_heartbeats (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  client_ts timestamptz,
  player_status text,
  network_status text,
  app_version text,
  battery_pct double precision,
  storage_free_mb double precision,
  storage_total_mb double precision,
  error_code text,
  error_message text,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS admin_dm_heartbeats_device_received_idx
  ON admin_dm_heartbeats (device_pk, received_at DESC);

CREATE INDEX IF NOT EXISTS admin_dm_heartbeats_received_idx
  ON admin_dm_heartbeats (received_at DESC);

-- Latest operational snapshot per device (upserted on each heartbeat).
CREATE TABLE IF NOT EXISTS admin_dm_telemetry (
  device_pk text PRIMARY KEY REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  last_heartbeat_at timestamptz,
  player_status text,
  network_status text,
  app_version text,
  battery_pct double precision,
  storage_free_mb double precision,
  storage_total_mb double precision,
  error_code text,
  error_message text,
  health_status text NOT NULL DEFAULT 'unknown',
  last_media_sync_at timestamptz,
  last_player_start_at timestamptz,
  last_player_stop_at timestamptz,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_dm_telemetry_health_chk CHECK (
    health_status IN ('healthy', 'warning', 'critical', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS admin_dm_telemetry_heartbeat_idx
  ON admin_dm_telemetry (last_heartbeat_at DESC NULLS LAST);
