CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  business_name text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 150),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 255),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 6 AND 20),
  business_category text NOT NULL,
  budget numeric NOT NULL,
  locations text[] NOT NULL DEFAULT '{}',
  duration_days integer NOT NULL,
  vehicle_type text NOT NULL,
  campaign_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent boolean NOT NULL CHECK (consent = true)
);
GRANT INSERT ON public.leads TO anon, authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit a lead" ON public.leads FOR INSERT TO anon, authenticated WITH CHECK (consent = true);