-- Admin Device Management — RLS + optional Realtime (Phase 2)
-- Service-role Admin API uses these tables; no anon/authenticated policies by default.
-- Admin Supabase only. Non-destructive.

ALTER TABLE admin_dm_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_dm_commands ENABLE ROW LEVEL SECURITY;

-- Latest status view for Admin DM poll / optional Realtime (no secrets).
CREATE OR REPLACE VIEW admin_dm_device_status AS
SELECT
  d.id,
  d.device_id,
  d.name,
  d.device_type,
  d.platform,
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
  t.error_code,
  t.lat AS device_lat,
  t.lng AS device_lng,
  t.updated_at AS telemetry_updated_at
FROM admin_dm_devices d
LEFT JOIN admin_dm_telemetry t ON t.device_pk = d.id;

-- Optional Realtime on telemetry (Admin may poll GET /api/dm/* instead).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE admin_dm_telemetry;
  EXCEPTION
    WHEN undefined_object THEN
      NULL;
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;
