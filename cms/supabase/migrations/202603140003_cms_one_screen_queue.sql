-- Manager rule: exactly one active screen per vehicle; queue states for Nest queue service.
-- Ad delivery remains independent (MQTT worker); Nest owns enqueue / PLAYING rules.

-- ---------------------------------------------------------------------------
-- Seed correction FIRST: KA02CD5678 keeps exactly ONE active screen (LEFT).
-- RIGHT is deactivated; multi-screen picker is invalid under manager rule.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v2 uuid;
  o2 uuid;
  s_left uuid;
  s_right uuid;
BEGIN
  SELECT id INTO v2 FROM cms_vehicles WHERE auto_number = 'KA02CD5678';
  IF v2 IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO o2 FROM cms_operators WHERE vehicle_id = v2;
  SELECT id INTO s_left FROM cms_screens WHERE vehicle_id = v2 AND code = 'LEFT';
  SELECT id INTO s_right FROM cms_screens WHERE vehicle_id = v2 AND code = 'RIGHT';

  IF s_right IS NOT NULL THEN
    UPDATE cms_screens SET is_active = false WHERE id = s_right;
    DELETE FROM cms_screen_assignments WHERE screen_id = s_right;
  END IF;

  IF s_left IS NOT NULL AND o2 IS NOT NULL THEN
    UPDATE cms_screens SET is_active = true WHERE id = s_left;
    INSERT INTO cms_screen_assignments (operator_id, screen_id)
    VALUES (o2, s_left)
    ON CONFLICT (operator_id, screen_id) DO NOTHING;
  END IF;
END $$;

-- One active screen per auto (after seed correction)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cms_screens_one_active_per_vehicle
  ON cms_screens (vehicle_id)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Queue status machine: QUEUED | PLAYING | COMPLETED | FAILED | CANCELLED
-- ---------------------------------------------------------------------------
ALTER TABLE cms_ad_queue
  DROP CONSTRAINT IF EXISTS cms_ad_queue_status_check;

UPDATE cms_ad_queue
  SET status = 'COMPLETED'
  WHERE lower(status) IN ('done', 'completed');

UPDATE cms_ad_queue
  SET status = 'CANCELLED'
  WHERE lower(status) IN ('skipped', 'cancelled', 'canceled');

UPDATE cms_ad_queue
  SET status = upper(status)
  WHERE status IS NOT NULL;

ALTER TABLE cms_ad_queue
  ADD CONSTRAINT cms_ad_queue_status_check
  CHECK (status IN ('QUEUED', 'PLAYING', 'COMPLETED', 'FAILED', 'CANCELLED'));

ALTER TABLE cms_ad_queue
  ALTER COLUMN status SET DEFAULT 'QUEUED';

ALTER TABLE cms_ad_queue
  ADD COLUMN IF NOT EXISTS external_ad_id text,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES cms_vehicles (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS fail_reason text;

UPDATE cms_ad_queue q
SET vehicle_id = s.vehicle_id
FROM cms_screens s
WHERE q.screen_id = s.id AND q.vehicle_id IS NULL;

-- Keep the earliest queued item as the active item when legacy data has
-- multiple PLAYING rows on one screen; return the others to the queue.
WITH ranked_playing AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY screen_id
      ORDER BY position ASC, created_at ASC, id ASC
    ) AS screen_rank
  FROM cms_ad_queue
  WHERE status = 'PLAYING'
)
UPDATE cms_ad_queue AS queue_item
SET status = 'QUEUED',
    started_at = NULL,
    ended_at = NULL
FROM ranked_playing
WHERE queue_item.id = ranked_playing.id
  AND ranked_playing.screen_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cms_ad_queue_one_playing_per_screen
  ON cms_ad_queue (screen_id)
  WHERE status = 'PLAYING';

CREATE INDEX IF NOT EXISTS idx_cms_ad_queue_screen_status_pos
  ON cms_ad_queue (screen_id, status, position);

ALTER TABLE cms_playback_history
  ADD COLUMN IF NOT EXISTS queue_item_id uuid REFERENCES cms_ad_queue (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'COMPLETED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cms_playback_history_outcome_check'
  ) THEN
    ALTER TABLE cms_playback_history
      ADD CONSTRAINT cms_playback_history_outcome_check
      CHECK (outcome IN ('COMPLETED', 'FAILED', 'CANCELLED'));
  END IF;
END $$;
