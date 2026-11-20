-- Admin Device Management — Configuration + Remote Commands (Phase 2)
-- Commands stay Pending until the device acknowledges.
-- Admin Supabase only. Non-destructive.

CREATE TABLE IF NOT EXISTS admin_dm_config (
  device_pk text PRIMARY KEY REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  orientation text NOT NULL DEFAULT 'landscape',
  resolution text,
  playback jsonb NOT NULL DEFAULT '{}'::jsonb,
  operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_sync jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT admin_dm_config_version_chk CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS admin_dm_config_history (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_dm_config_history_device_idx
  ON admin_dm_config_history (device_pk, version DESC);

CREATE TABLE IF NOT EXISTS admin_dm_commands (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  issued_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ack_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  failure_reason text,
  CONSTRAINT admin_dm_commands_status_chk CHECK (
    status IN ('pending', 'acknowledged', 'completed', 'failed', 'expired')
  ),
  CONSTRAINT admin_dm_commands_type_chk CHECK (
    command_type IN (
      'request_status',
      'sync_media',
      'refresh_manifest',
      'update_config',
      'restart_player',
      'suspend_device',
      'revoke_device'
    )
  )
);

CREATE INDEX IF NOT EXISTS admin_dm_commands_device_created_idx
  ON admin_dm_commands (device_pk, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_dm_commands_pending_idx
  ON admin_dm_commands (device_pk, created_at)
  WHERE status = 'pending';
