
ALTER TABLE public.custom_orders DROP CONSTRAINT IF EXISTS custom_orders_pack_type_check;
ALTER TABLE public.custom_orders ADD CONSTRAINT custom_orders_pack_type_check CHECK (pack_type IN ('carcasa','carcasa+polera','carcasa+poleron'));

ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS phone_model text,
  ADD COLUMN IF NOT EXISTS garment_size text,
  ADD COLUMN IF NOT EXISTS garment_color text,
  ADD COLUMN IF NOT EXISTS case_design_url text,
  ADD COLUMN IF NOT EXISTS garment_design_url text,
  ADD COLUMN IF NOT EXISTS pack_id uuid,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text;

DROP POLICY IF EXISTS "Anyone can create orders" ON public.custom_orders;
CREATE POLICY "Anyone can create orders" ON public.custom_orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    customer_email IS NOT NULL
    AND length(customer_email) > 3
    AND pack_type IN ('carcasa','carcasa+polera','carcasa+poleron')
  );
