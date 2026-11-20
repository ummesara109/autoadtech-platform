-- CMS Milestone 1: vehicles, operators, screens, assignments, dashboard placeholders
-- Run against Supabase PostgreSQL. Uses auth.users for OTP sessions.
-- RBAC roles + RLS: operators only see assigned screens.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Roles (RBAC)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cms_roles (code, description) VALUES
  ('cms_operator', 'Vehicle operator with access to assigned CMS screens'),
  ('cms_admin', 'Platform admin (future; not used in milestone 1 UI)')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Vehicles + registered mobile (never return full mobile from API)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_number text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  make_model text NOT NULL DEFAULT '',
  registered_mobile text NOT NULL,
  mobile_e164 text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cms_vehicles_auto_number
  ON cms_vehicles (upper(replace(auto_number, ' ', '')));

-- ---------------------------------------------------------------------------
-- Operators (link Supabase auth user ↔ vehicle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
  vehicle_id uuid NOT NULL REFERENCES cms_vehicles (id) ON DELETE CASCADE,
  role_code text NOT NULL DEFAULT 'cms_operator'
    REFERENCES cms_roles (code),
  display_name text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id)
);

-- ---------------------------------------------------------------------------
-- Screens (physical displays on a vehicle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES cms_vehicles (id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  placement text NOT NULL DEFAULT 'rear',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, code)
);

-- Operator ↔ screen assignments (RBAC scope)
CREATE TABLE IF NOT EXISTS cms_screen_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES cms_operators (id) ON DELETE CASCADE,
  screen_id uuid NOT NULL REFERENCES cms_screens (id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, screen_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_screen_assignments_operator
  ON cms_screen_assignments (operator_id);

-- ---------------------------------------------------------------------------
-- Dashboard placeholder tables (empty until MQTT / ad delivery populates)
-- Ad delivery + device telemetry live OUTSIDE the NestJS main path (MQTT seam).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_ad_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES cms_screens (id) ON DELETE CASCADE,
  title text NOT NULL,
  advertiser text NOT NULL DEFAULT '',
  duration_sec integer NOT NULL DEFAULT 30,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'playing', 'done', 'skipped')),
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_playback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES cms_screens (id) ON DELETE CASCADE,
  title text NOT NULL,
  advertiser text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_device_status (
  screen_id uuid PRIMARY KEY REFERENCES cms_screens (id) ON DELETE CASCADE,
  online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  firmware_version text NOT NULL DEFAULT '',
  signal_strength integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Live location is written by a future MQTT / telematics worker — not NestJS.
CREATE TABLE IF NOT EXISTS cms_vehicle_location (
  vehicle_id uuid PRIMARY KEY REFERENCES cms_vehicles (id) ON DELETE CASCADE,
  lat double precision,
  lng double precision,
  speed_kmh double precision,
  heading_deg double precision,
  recorded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- OTP challenge audit (NestJS may also keep ephemeral Redis state)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES cms_vehicles (id) ON DELETE CASCADE,
  masked_mobile text NOT NULL,
  supabase_phone text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Helper: current operator id from JWT (auth.uid())
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cms_current_operator_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM cms_operators WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE cms_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_screen_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_ad_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_playback_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_device_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_vehicle_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_roles ENABLE ROW LEVEL SECURITY;

-- Operators can read their own operator row
DROP POLICY IF EXISTS cms_operators_self_select ON cms_operators;
CREATE POLICY cms_operators_self_select ON cms_operators
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Vehicles: only the operator's vehicle
DROP POLICY IF EXISTS cms_vehicles_operator_select ON cms_vehicles;
CREATE POLICY cms_vehicles_operator_select ON cms_vehicles
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT vehicle_id FROM cms_operators WHERE auth_user_id = auth.uid())
  );

-- Screens: only assigned screens
DROP POLICY IF EXISTS cms_screens_assigned_select ON cms_screens;
CREATE POLICY cms_screens_assigned_select ON cms_screens
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT sa.screen_id
      FROM cms_screen_assignments sa
      JOIN cms_operators o ON o.id = sa.operator_id
      WHERE o.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cms_assignments_self_select ON cms_screen_assignments;
CREATE POLICY cms_assignments_self_select ON cms_screen_assignments
  FOR SELECT TO authenticated
  USING (operator_id = cms_current_operator_id());

DROP POLICY IF EXISTS cms_ad_queue_assigned_select ON cms_ad_queue;
CREATE POLICY cms_ad_queue_assigned_select ON cms_ad_queue
  FOR SELECT TO authenticated
  USING (
    screen_id IN (
      SELECT sa.screen_id
      FROM cms_screen_assignments sa
      WHERE sa.operator_id = cms_current_operator_id()
    )
  );

DROP POLICY IF EXISTS cms_history_assigned_select ON cms_playback_history;
CREATE POLICY cms_history_assigned_select ON cms_playback_history
  FOR SELECT TO authenticated
  USING (
    screen_id IN (
      SELECT sa.screen_id
      FROM cms_screen_assignments sa
      WHERE sa.operator_id = cms_current_operator_id()
    )
  );

DROP POLICY IF EXISTS cms_device_assigned_select ON cms_device_status;
CREATE POLICY cms_device_assigned_select ON cms_device_status
  FOR SELECT TO authenticated
  USING (
    screen_id IN (
      SELECT sa.screen_id
      FROM cms_screen_assignments sa
      WHERE sa.operator_id = cms_current_operator_id()
    )
  );

DROP POLICY IF EXISTS cms_location_own_vehicle ON cms_vehicle_location;
CREATE POLICY cms_location_own_vehicle ON cms_vehicle_location
  FOR SELECT TO authenticated
  USING (
    vehicle_id IN (
      SELECT vehicle_id FROM cms_operators WHERE auth_user_id = auth.uid()
    )
  );

-- Roles readable by authenticated (codes only)
DROP POLICY IF EXISTS cms_roles_read ON cms_roles;
CREATE POLICY cms_roles_read ON cms_roles
  FOR SELECT TO authenticated
  USING (true);

-- OTP challenges: no direct client access (NestJS service role only)
DROP POLICY IF EXISTS cms_otp_no_client ON cms_otp_challenges;
CREATE POLICY cms_otp_no_client ON cms_otp_challenges
  FOR ALL TO authenticated
  USING (false);

-- Service role bypasses RLS by default in Supabase.
