
-- =============== 1. Ampliar custom_orders ===============
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS order_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS public_access_token_hash text,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS mp_idempotency_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS shipping_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;

-- Normalizar payment_status
UPDATE public.custom_orders SET payment_status = 'pending' WHERE payment_status IS NULL;
UPDATE public.custom_orders SET payment_status = 'approved' WHERE payment_status IN ('approved','pagado');
UPDATE public.custom_orders SET payment_status = 'rejected' WHERE payment_status IN ('rejected','pago_rechazado');
UPDATE public.custom_orders SET payment_status = 'pending' WHERE payment_status IN ('pending','pendiente_pago','in_process');
ALTER TABLE public.custom_orders ALTER COLUMN payment_status SET NOT NULL;
ALTER TABLE public.custom_orders ALTER COLUMN payment_status SET DEFAULT 'pending';

ALTER TABLE public.custom_orders DROP CONSTRAINT IF EXISTS custom_orders_payment_status_check;
ALTER TABLE public.custom_orders ADD CONSTRAINT custom_orders_payment_status_check
  CHECK (payment_status IN ('pending','approved','rejected','cancelled','refunded','charged_back'));

ALTER TABLE public.custom_orders DROP CONSTRAINT IF EXISTS custom_orders_fulfillment_status_check;
ALTER TABLE public.custom_orders ADD CONSTRAINT custom_orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('new','in_production','ready','shipped','completed','cancelled'));

-- =============== 2. Secuencia y generador de número de pedido ===============
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq;

CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('public.order_number_seq');
  RETURN 'VS-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(n::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_order_number() FROM PUBLIC, anon, authenticated;

-- =============== 3. Eliminar políticas inseguras ===============
DROP POLICY IF EXISTS "Public read order by id" ON public.custom_orders;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.custom_orders;

-- Mantener/asegurar solo estas políticas:
--  * "Users read own orders": auth.uid()=user_id o admin (ya existente).
--  * "Admins update orders": admin (ya existente, se refuerza con trigger).
-- Nada más: sin SELECT anon, sin INSERT desde cliente.

-- =============== 4. Trigger anti-manipulación de pago y total ===============
CREATE OR REPLACE FUNCTION public.enforce_order_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := current_user = 'service_role';
BEGIN
  IF is_service THEN
    RETURN NEW;
  END IF;
  -- Rutas no service_role (admins vía dashboard): no pueden tocar campos sensibles.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'payment_status solo puede ser modificado por la pasarela de pagos';
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.shipping_amount IS DISTINCT FROM OLD.shipping_amount THEN
    RAISE EXCEPTION 'los montos no pueden ser modificados desde el panel';
  END IF;
  IF NEW.mp_payment_id IS DISTINCT FROM OLD.mp_payment_id
     OR NEW.mp_preference_id IS DISTINCT FROM OLD.mp_preference_id
     OR NEW.mp_idempotency_key IS DISTINCT FROM OLD.mp_idempotency_key
     OR NEW.public_access_token_hash IS DISTINCT FROM OLD.public_access_token_hash
     OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'campos de pago/identificación son inmutables';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_orders_immutability ON public.custom_orders;
CREATE TRIGGER trg_custom_orders_immutability
  BEFORE UPDATE ON public.custom_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_immutability();

-- =============== 5. Eventos de pago idempotentes ===============
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS provider_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_uidx
  ON public.payment_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- =============== 6. Índices útiles ===============
CREATE INDEX IF NOT EXISTS custom_orders_payment_status_idx ON public.custom_orders (payment_status);
CREATE INDEX IF NOT EXISTS custom_orders_fulfillment_status_idx ON public.custom_orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS custom_orders_order_number_idx ON public.custom_orders (order_number);
