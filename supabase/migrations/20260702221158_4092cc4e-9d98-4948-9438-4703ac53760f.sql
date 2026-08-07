
-- Lock down SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Tighten guest INSERT policies with minimal validity checks
DROP POLICY IF EXISTS "Anyone can create orders" ON public.custom_orders;
CREATE POLICY "Anyone can create orders" ON public.custom_orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (customer_email IS NOT NULL AND length(customer_email) > 3 AND pack_type IN ('carcasa+polera','carcasa+poleron'));

DROP POLICY IF EXISTS "Anyone can insert design_assets" ON public.design_assets;
CREATE POLICY "Anyone can insert design_assets" ON public.design_assets
  FOR INSERT TO anon, authenticated
  WITH CHECK (file_url IS NOT NULL AND order_id IS NOT NULL);

DROP POLICY IF EXISTS "Anyone can insert final_designs" ON public.final_designs;
CREATE POLICY "Anyone can insert final_designs" ON public.final_designs
  FOR INSERT TO anon, authenticated
  WITH CHECK (order_id IS NOT NULL);
