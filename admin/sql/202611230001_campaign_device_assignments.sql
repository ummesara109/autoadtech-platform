-- Campaign-to-vehicle and campaign-to-device delivery records.
-- Apply to the shared Supabase project after advertiser campaigns, CMS, and
-- Admin Device Management migrations have been applied.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS campaign_target_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  admin_vehicle_id text NOT NULL,
  vehicle_no text NOT NULL,
  admin_device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  cms_vehicle_id uuid NOT NULL REFERENCES cms_vehicles (id) ON DELETE RESTRICT,
  screen_id uuid NOT NULL REFERENCES cms_screens (id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_target_vehicle_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT campaign_target_vehicle_unique UNIQUE (campaign_id, cms_vehicle_id),
  CONSTRAINT campaign_target_screen_unique UNIQUE (campaign_id, screen_id),
  CONSTRAINT campaign_target_vehicle_no_overlap
    EXCLUDE USING gist (
      cms_vehicle_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status = 'reserved')
);

CREATE INDEX IF NOT EXISTS campaign_target_vehicles_campaign_idx
  ON campaign_target_vehicles (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_target_vehicles_vehicle_dates_idx
  ON campaign_target_vehicles (cms_vehicle_id, start_date, end_date)
  WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS campaign_device_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  target_vehicle_id uuid NOT NULL REFERENCES campaign_target_vehicles (id) ON DELETE CASCADE,
  admin_device_pk text NOT NULL REFERENCES admin_dm_devices (id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  vehicle_no text NOT NULL,
  cms_vehicle_id uuid NOT NULL REFERENCES cms_vehicles (id) ON DELETE RESTRICT,
  screen_id uuid NOT NULL REFERENCES cms_screens (id) ON DELETE RESTRICT,
  queue_item_id uuid REFERENCES cms_ad_queue (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'delivered', 'completed', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  next_retry_at timestamptz,
  queued_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_device_assignment_screen_unique UNIQUE (campaign_id, screen_id)
);

CREATE INDEX IF NOT EXISTS campaign_device_assignments_campaign_status_idx
  ON campaign_device_assignments (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_device_assignments_retry_idx
  ON campaign_device_assignments (next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS campaign_device_assignments_vehicle_idx
  ON campaign_device_assignments (cms_vehicle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_delivery_attempts (
  id text PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES campaign_device_assignments (id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status text NOT NULL CHECK (status IN ('started', 'accepted', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text,
  response jsonb,
  CONSTRAINT campaign_delivery_attempt_unique UNIQUE (assignment_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS campaign_delivery_attempts_assignment_idx
  ON campaign_delivery_attempts (assignment_id, attempt_no DESC);

ALTER TABLE campaign_target_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_delivery_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE campaign_target_vehicles IS
  'Concrete campaign reservations for mapped vehicles. One vehicle cannot be reserved by overlapping campaign date ranges.';
COMMENT ON TABLE campaign_device_assignments IS
  'Per-screen state for delivery through the existing CMS queue. queued means accepted by CMS, not confirmed playback.';
COMMENT ON TABLE campaign_delivery_attempts IS
  'Append-only history of server-to-server campaign queue requests.';
