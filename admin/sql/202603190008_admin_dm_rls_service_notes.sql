-- Admin Device Management — RLS notes / no anon policies (Phase 11)
-- Admin Supabase only. Non-destructive. Do NOT auto-execute.
-- Admin API uses the service role key server-side only.
-- Frontend never receives service-role or device secrets.

-- Ensure RLS remains enabled (idempotent).
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

-- Explicitly deny anon/authenticated direct table access.
-- Service role bypasses RLS; Admin Express is the only writer/reader for DM.

DROP POLICY IF EXISTS admin_dm_devices_deny_all ON admin_dm_devices;
CREATE POLICY admin_dm_devices_deny_all ON admin_dm_devices
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_credentials_deny_all ON admin_dm_credentials;
CREATE POLICY admin_dm_credentials_deny_all ON admin_dm_credentials
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_heartbeats_deny_all ON admin_dm_heartbeats;
CREATE POLICY admin_dm_heartbeats_deny_all ON admin_dm_heartbeats
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_telemetry_deny_all ON admin_dm_telemetry;
CREATE POLICY admin_dm_telemetry_deny_all ON admin_dm_telemetry
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_activity_deny_all ON admin_dm_activity;
CREATE POLICY admin_dm_activity_deny_all ON admin_dm_activity
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_assignments_deny_all ON admin_dm_assignments;
CREATE POLICY admin_dm_assignments_deny_all ON admin_dm_assignments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_maintenance_deny_all ON admin_dm_maintenance;
CREATE POLICY admin_dm_maintenance_deny_all ON admin_dm_maintenance
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_config_deny_all ON admin_dm_config;
CREATE POLICY admin_dm_config_deny_all ON admin_dm_config
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_config_history_deny_all ON admin_dm_config_history;
CREATE POLICY admin_dm_config_history_deny_all ON admin_dm_config_history
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_dm_commands_deny_all ON admin_dm_commands;
CREATE POLICY admin_dm_commands_deny_all ON admin_dm_commands
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE admin_dm_credentials IS
  'Hashed device secrets only. Never select secret_hash into Admin frontend responses.';
