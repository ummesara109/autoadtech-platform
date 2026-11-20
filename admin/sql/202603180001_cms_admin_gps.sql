-- CMS ↔ Admin GPS (Phase 1) — Admin Supabase only.
-- Non-destructive: CREATE IF NOT EXISTS + INSERT … ON CONFLICT DO NOTHING.
-- Do not apply to Advertiser. Do not truncate existing Admin collections.

-- Explicit identity mapping (no fuzzy plate matching).
CREATE TABLE IF NOT EXISTS vehicle_cms_link (
  id text PRIMARY KEY,
  auto_number_norm text NOT NULL UNIQUE,
  admin_vehicle_id text NOT NULL,
  admin_device_id text,
  cms_vehicle_id text,
  cms_screen_id text,
  status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_cms_link_admin_vehicle_idx
  ON vehicle_cms_link (admin_vehicle_id);

CREATE INDEX IF NOT EXISTS vehicle_cms_link_cms_vehicle_idx
  ON vehicle_cms_link (cms_vehicle_id)
  WHERE cms_vehicle_id IS NOT NULL;

-- Live GPS store for CMS ingest (separate from devices document collection).
CREATE TABLE IF NOT EXISTS cms_admin_vehicle_gps (
  auto_number_norm text PRIMARY KEY,
  admin_vehicle_id text,
  admin_device_id text,
  cms_vehicle_id text,
  cms_screen_id text,
  device_id text,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  speed_kmh double precision,
  recorded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  tracking_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'device_gps',
  CONSTRAINT cms_admin_vehicle_gps_source_chk CHECK (source = 'device_gps')
);

CREATE INDEX IF NOT EXISTS cms_admin_vehicle_gps_updated_idx
  ON cms_admin_vehicle_gps (updated_at DESC);

CREATE INDEX IF NOT EXISTS cms_admin_vehicle_gps_tracking_idx
  ON cms_admin_vehicle_gps (tracking_active)
  WHERE tracking_active = true;

-- Phase 2 optional: enable Realtime so Admin UI can subscribe without refresh.
-- Safe no-op if already added. Polling GET /api/live remains supported.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE cms_admin_vehicle_gps;
  EXCEPTION
    WHEN undefined_object THEN
      NULL; -- publication missing (non-Supabase) — ignore
    WHEN duplicate_object THEN
      NULL; -- already in publication
  END;
END $$;

-- Demo seed: CMS DEV_SEED plates → Admin seed vehicles 1 / 2 (DEV-001 / DEV-002).
-- Safe to re-run; never overwrites an existing mapping row.
INSERT INTO vehicle_cms_link (
  id,
  auto_number_norm,
  admin_vehicle_id,
  admin_device_id,
  cms_vehicle_id,
  cms_screen_id,
  status
) VALUES
  (
    'link-ka01ab1234',
    'KA01AB1234',
    '1',
    'DEV-001',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333331',
    'Active'
  ),
  (
    'link-ka02cd5678',
    'KA02CD5678',
    '2',
    'DEV-002',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333332',
    'Active'
  )
ON CONFLICT (auto_number_norm) DO NOTHING;
