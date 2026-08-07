
REVOKE EXECUTE ON FUNCTION public.finalize_order_designs(uuid,text,text,jsonb,jsonb,text,jsonb)
  FROM public, anon, authenticated;
