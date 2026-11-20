-- Dev seed for CMS (manager rule: exactly one active screen per Auto Number).
--   KA01AB1234 → Rear screen
--   KA02CD5678 → Left panel only (RIGHT removed from active/assignments)
-- Mobiles are placeholders; with CMS_DEV_AUTH=true the API accepts OTP 123456
-- without calling Supabase SMS.

DO $$
DECLARE
  v1 uuid;
  v2 uuid;
  o1 uuid;
  o2 uuid;
  s1 uuid;
  s2a uuid;
BEGIN
  INSERT INTO cms_vehicles (id, auto_number, display_name, make_model, registered_mobile, mobile_e164, status)
  VALUES (
    gen_random_uuid(),
    'KA01AB1234',
    'Fleet Auto 01',
    'Tata Ace',
    '9876543210',
    '+919876543210',
    'active'
  )
  ON CONFLICT (auto_number) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        make_model = EXCLUDED.make_model,
        registered_mobile = EXCLUDED.registered_mobile,
        mobile_e164 = EXCLUDED.mobile_e164
  RETURNING id INTO v1;

  SELECT id INTO v1 FROM cms_vehicles WHERE auto_number = 'KA01AB1234';

  INSERT INTO cms_vehicles (id, auto_number, display_name, make_model, registered_mobile, mobile_e164, status)
  VALUES (
    gen_random_uuid(),
    'KA02CD5678',
    'Fleet Auto 02',
    'Mahindra Bolero',
    '9123456780',
    '+919123456780',
    'active'
  )
  ON CONFLICT (auto_number) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        make_model = EXCLUDED.make_model,
        registered_mobile = EXCLUDED.registered_mobile,
        mobile_e164 = EXCLUDED.mobile_e164
  RETURNING id INTO v2;

  SELECT id INTO v2 FROM cms_vehicles WHERE auto_number = 'KA02CD5678';

  INSERT INTO cms_operators (vehicle_id, role_code, display_name, is_active)
  VALUES (v1, 'cms_operator', 'Operator One', true)
  ON CONFLICT (vehicle_id) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO o1;
  SELECT id INTO o1 FROM cms_operators WHERE vehicle_id = v1;

  INSERT INTO cms_operators (vehicle_id, role_code, display_name, is_active)
  VALUES (v2, 'cms_operator', 'Operator Two', true)
  ON CONFLICT (vehicle_id) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO o2;
  SELECT id INTO o2 FROM cms_operators WHERE vehicle_id = v2;

  INSERT INTO cms_screens (vehicle_id, code, label, placement, is_active)
  VALUES (v1, 'REAR', 'Rear screen', 'rear', true)
  ON CONFLICT (vehicle_id, code) DO UPDATE SET label = EXCLUDED.label, is_active = true
  RETURNING id INTO s1;
  SELECT id INTO s1 FROM cms_screens WHERE vehicle_id = v1 AND code = 'REAR';

  INSERT INTO cms_screens (vehicle_id, code, label, placement, is_active)
  VALUES (v2, 'LEFT', 'Left panel', 'left', true)
  ON CONFLICT (vehicle_id, code) DO UPDATE SET label = EXCLUDED.label, is_active = true;
  SELECT id INTO s2a FROM cms_screens WHERE vehicle_id = v2 AND code = 'LEFT';

  -- Ensure legacy RIGHT is inactive if present
  UPDATE cms_screens SET is_active = false
  WHERE vehicle_id = v2 AND code = 'RIGHT';

  INSERT INTO cms_screen_assignments (operator_id, screen_id)
  VALUES (o1, s1)
  ON CONFLICT (operator_id, screen_id) DO NOTHING;

  INSERT INTO cms_screen_assignments (operator_id, screen_id)
  VALUES (o2, s2a)
  ON CONFLICT (operator_id, screen_id) DO NOTHING;

  DELETE FROM cms_screen_assignments sa
  USING cms_screens s
  WHERE sa.screen_id = s.id AND s.vehicle_id = v2 AND s.code = 'RIGHT';

  INSERT INTO cms_device_status (screen_id, online, last_seen_at, firmware_version)
  VALUES
    (s1, false, NULL, ''),
    (s2a, false, NULL, '')
  ON CONFLICT (screen_id) DO NOTHING;

  -- No location / ads / history rows — dashboard shows empty placeholders
END $$;
