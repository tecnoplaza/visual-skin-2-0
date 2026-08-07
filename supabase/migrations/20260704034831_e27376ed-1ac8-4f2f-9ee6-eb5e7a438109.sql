
-- 1. Kill insecure anon INSERT / public-read policies for design tables and buckets.
DROP POLICY IF EXISTS "Anyone can insert design_assets" ON public.design_assets;
DROP POLICY IF EXISTS "Anyone can insert final_designs" ON public.final_designs;
DROP POLICY IF EXISTS "Anyone insert final-designs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone upload customer-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public read catalog buckets" ON storage.objects;

-- Re-create the public catalog SELECT policy WITHOUT final-designs (it was public before).
CREATE POLICY "Public read catalog buckets"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = ANY (ARRAY[
    'phone-mockups',
    'phone-masks',
    'phone-previews',
    'garment-mockups',
    'garment-previews',
    'template-previews'
  ]));

-- 2. New private bucket policies: admins can read/manage; everyone else uses signed URLs.
DROP POLICY IF EXISTS "Admins manage order-designs" ON storage.objects;
CREATE POLICY "Admins manage order-designs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'order-designs' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'order-designs' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Also lock down final-designs bucket to admin-only. Legacy objects stay accessible
-- server-side via service role only.
DROP POLICY IF EXISTS "Admins manage final-designs" ON storage.objects;
CREATE POLICY "Admins manage final-designs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'final-designs' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'final-designs' AND public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Order design lifecycle columns.
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS design_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS case_file_path text,
  ADD COLUMN IF NOT EXISTS garment_file_path text;

-- Replace any prior check constraint.
ALTER TABLE public.custom_orders
  DROP CONSTRAINT IF EXISTS custom_orders_design_status_check;
ALTER TABLE public.custom_orders
  ADD CONSTRAINT custom_orders_design_status_check
  CHECK (design_status IN ('pending','uploading','ready','failed'));

CREATE INDEX IF NOT EXISTS custom_orders_design_status_idx
  ON public.custom_orders(design_status);

-- 4. design_assets: allow empty file_url (we store file_path now), add metadata jsonb.
ALTER TABLE public.design_assets
  ALTER COLUMN file_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 5. Cleanup of abandoned orders + their storage objects.
CREATE OR REPLACE FUNCTION public.cleanup_abandoned_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Remove storage objects for orders we're about to delete.
  DELETE FROM storage.objects o
  USING public.custom_orders co
  WHERE o.bucket_id = 'order-designs'
    AND (o.name LIKE (co.id::text || '/%'))
    AND co.payment_status = 'pending'
    AND co.design_status <> 'ready'
    AND co.created_at < now() - interval '24 hours';

  DELETE FROM public.custom_orders
  WHERE payment_status = 'pending'
    AND design_status <> 'ready'
    AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_abandoned_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_orders() TO service_role;

-- Backfill: existing orders already paid → design_status='ready'; others stay 'pending'
UPDATE public.custom_orders
SET design_status = 'ready'
WHERE payment_status = 'approved' AND design_status = 'pending';
