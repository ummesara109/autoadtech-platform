REVOKE INSERT ON public.leads FROM anon, authenticated;
COMMENT ON TABLE public.leads IS 'DEPRECATED: site is a static landing page; no longer written to.';