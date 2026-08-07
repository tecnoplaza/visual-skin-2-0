
-- 1) payment_attempts: one row per real payment attempt
CREATE TABLE public.payment_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  mercado_pago_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','approved','rejected','cancelled','error','pending')),
  status_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempts_idem_uniq UNIQUE (idempotency_key),
  CONSTRAINT payment_attempts_order_attempt_uniq UNIQUE (order_id, attempt_number)
);
CREATE UNIQUE INDEX payment_attempts_mp_payment_uidx
  ON public.payment_attempts(mercado_pago_payment_id)
  WHERE mercado_pago_payment_id IS NOT NULL;
-- Only ONE processing attempt per order at a time.
CREATE UNIQUE INDEX payment_attempts_one_processing_uidx
  ON public.payment_attempts(order_id)
  WHERE status = 'processing';
CREATE INDEX payment_attempts_order_idx ON public.payment_attempts(order_id);
CREATE INDEX payment_attempts_fingerprint_idx
  ON public.payment_attempts(order_id, request_fingerprint);

GRANT SELECT ON public.payment_attempts TO authenticated; -- admins vía has_role policy
GRANT ALL ON public.payment_attempts TO service_role;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment attempts" ON public.payment_attempts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE/DELETE policies: solo service_role.

CREATE TRIGGER payment_attempts_set_updated_at
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) payment_sessions: cookie-backed per-order session
CREATE TABLE public.payment_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_sessions_order_idx ON public.payment_sessions(order_id);
CREATE INDEX payment_sessions_expires_idx ON public.payment_sessions(expires_at);
GRANT SELECT ON public.payment_sessions TO authenticated;
GRANT ALL ON public.payment_sessions TO service_role;
ALTER TABLE public.payment_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment sessions" ON public.payment_sessions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Extend payment_events for proper delivery-based idempotency
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS delivery_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS event_action TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_result TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_delivery_uidx
  ON public.payment_events(provider, delivery_id)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_events_provider_payment_idx
  ON public.payment_events(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- 4) Extend custom_orders with sync timestamps
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS payment_status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_mercado_pago_sync_at TIMESTAMPTZ;

-- 5) Payment status state-machine trigger (applies to ALL roles, incl. service_role)
CREATE OR REPLACE FUNCTION public.enforce_payment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status THEN
    RETURN NEW;
  END IF;
  -- Allowed transitions
  IF OLD.payment_status = 'pending' AND NEW.payment_status IN ('approved','rejected','cancelled') THEN allowed := TRUE;
  ELSIF OLD.payment_status = 'rejected' AND NEW.payment_status IN ('pending','cancelled') THEN allowed := TRUE;
  ELSIF OLD.payment_status = 'cancelled' AND NEW.payment_status IN ('pending') THEN allowed := TRUE;
  ELSIF OLD.payment_status = 'approved' AND NEW.payment_status IN ('refunded','charged_back') THEN allowed := TRUE;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Transición de payment_status no permitida: % -> %', OLD.payment_status, NEW.payment_status;
  END IF;
  NEW.payment_status_updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_payment_status_transition_trg ON public.custom_orders;
CREATE TRIGGER enforce_payment_status_transition_trg
  BEFORE UPDATE OF payment_status ON public.custom_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_status_transition();

-- Backfill sync ts
UPDATE public.custom_orders SET payment_status_updated_at = COALESCE(payment_status_updated_at, updated_at);
