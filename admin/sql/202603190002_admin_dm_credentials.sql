-- Admin Device Management — Device Credentials (Phase 2)
-- Stores hashed secrets only. Never return secret_hash to frontend.
-- Admin Supabase only. Non-destructive.

CREATE TABLE IF NOT EXISTS admin_dm_credentials (
  id text PRIMARY KEY,
  device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  secret_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_auth_at timestamptz,
  created_by text,
  CONSTRAINT admin_dm_credentials_version_chk CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_dm_credentials_active_device_idx
  ON admin_dm_credentials (device_pk)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_dm_credentials_device_id_idx
  ON admin_dm_credentials (device_id);
