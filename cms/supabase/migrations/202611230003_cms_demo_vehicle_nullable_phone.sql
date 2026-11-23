-- Demo vehicle registration stores no fabricated phone number.
-- Production SMS login still requires a valid phone at authentication time.
ALTER TABLE public.cms_vehicles
  ALTER COLUMN registered_mobile DROP NOT NULL,
  ALTER COLUMN mobile_e164 DROP NOT NULL;
