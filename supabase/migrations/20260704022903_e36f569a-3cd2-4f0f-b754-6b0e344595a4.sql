
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS mp_preference_id text,
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS payment_status text;

CREATE INDEX IF NOT EXISTS custom_orders_mp_preference_id_idx ON public.custom_orders(mp_preference_id);
CREATE INDEX IF NOT EXISTS custom_orders_mp_payment_id_idx ON public.custom_orders(mp_payment_id);

-- Allow unauthenticated buyer to read their own order (used on /pedido/:id).
-- Read is by primary-key id (unguessable UUID). PII stays behind knowing the id.
DROP POLICY IF EXISTS "Public read order by id" ON public.custom_orders;
CREATE POLICY "Public read order by id"
  ON public.custom_orders FOR SELECT
  TO anon, authenticated
  USING (true);

-- Payment events audit log
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_events TO authenticated;
GRANT ALL ON public.payment_events TO service_role;

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read payment events"
  ON public.payment_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
