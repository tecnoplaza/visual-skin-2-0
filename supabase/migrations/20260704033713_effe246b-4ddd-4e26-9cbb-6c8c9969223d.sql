
-- 1. payment_attempts: expand status enum + new columns
ALTER TABLE public.payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_status_check;
ALTER TABLE public.payment_attempts
  ADD CONSTRAINT payment_attempts_status_check
  CHECK (status IN ('processing','pending','approved','rejected','cancelled','error','refunded','charged_back'));

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS previous_order_status text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Replace "one processing" guard with "one active" (processing OR pending).
DROP INDEX IF EXISTS public.payment_attempts_one_processing_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_active_uidx
  ON public.payment_attempts(order_id)
  WHERE status IN ('processing','pending');

-- 2. payment_events: add status / attempt_count / last_error / updated_at
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_status_check;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_status_check
  CHECK (status IN ('processing','processed','failed'));

DROP TRIGGER IF EXISTS payment_events_set_updated_at ON public.payment_events;
CREATE TRIGGER payment_events_set_updated_at
  BEFORE UPDATE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. begin_payment_attempt RPC — transactional lock + guards + attempt row.
CREATE OR REPLACE FUNCTION public.begin_payment_attempt(
  p_order_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order         RECORD;
  v_existing      RECORD;
  v_attempt_id    uuid;
  v_attempt_num   int;
  v_prev_status   text;
BEGIN
  -- Lock the order row.
  SELECT id, payment_status
    INTO v_order
  FROM public.custom_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_not_found');
  END IF;

  -- Terminal / locked states can never start a new attempt.
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'order_locked',
      'order_status', v_order.payment_status
    );
  END IF;

  -- Reuse identical attempt in the last 60s (double-submit / retry).
  SELECT id, attempt_number, idempotency_key, status, previous_order_status
    INTO v_existing
  FROM public.payment_attempts
  WHERE order_id = p_order_id
    AND request_fingerprint = p_request_fingerprint
    AND created_at > now() - interval '60 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true,
      'attempt_id', v_existing.id,
      'attempt_number', v_existing.attempt_number,
      'idempotency_key', v_existing.idempotency_key,
      'previous_order_status', v_existing.previous_order_status,
      'order_status', v_order.payment_status
    );
  END IF;

  -- Block if there is another active attempt.
  PERFORM 1 FROM public.payment_attempts
   WHERE order_id = p_order_id
     AND status IN ('processing','pending');
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'awaiting_confirmation'
    );
  END IF;

  v_prev_status := v_order.payment_status;

  -- Flip rejected/cancelled to pending so the state machine starts clean.
  IF v_order.payment_status IN ('rejected','cancelled') THEN
    UPDATE public.custom_orders
       SET payment_status = 'pending'
     WHERE id = p_order_id;
  END IF;

  SELECT COALESCE(MAX(attempt_number),0) + 1
    INTO v_attempt_num
  FROM public.payment_attempts
  WHERE order_id = p_order_id;

  INSERT INTO public.payment_attempts (
    order_id, attempt_number, idempotency_key, request_fingerprint,
    status, previous_order_status
  ) VALUES (
    p_order_id, v_attempt_num, p_idempotency_key, p_request_fingerprint,
    'processing', v_prev_status
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false,
    'attempt_id', v_attempt_id,
    'attempt_number', v_attempt_num,
    'idempotency_key', p_idempotency_key,
    'previous_order_status', v_prev_status,
    'order_status', 'pending'
  );
EXCEPTION WHEN unique_violation THEN
  -- Race: another concurrent call slipped in and created an active attempt.
  RETURN jsonb_build_object('ok', false, 'code', 'awaiting_confirmation');
END;
$$;

REVOKE ALL ON FUNCTION public.begin_payment_attempt(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_payment_attempt(uuid,text,text) TO service_role;

-- 4. reserve_webhook_delivery RPC — atomic reservation.
CREATE OR REPLACE FUNCTION public.reserve_webhook_delivery(
  p_provider   text,
  p_delivery_id text,
  p_request_id text,
  p_type       text,
  p_action     text,
  p_payment_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_id    uuid;
BEGIN
  INSERT INTO public.payment_events (
    provider, delivery_id, request_id, event_type, event_action,
    provider_payment_id, provider_event_id, status, attempt_count
  ) VALUES (
    p_provider, p_delivery_id, p_request_id, p_type, p_action,
    p_payment_id, p_delivery_id, 'processing', 1
  )
  ON CONFLICT (provider, delivery_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'event_id', v_id);
  END IF;

  SELECT id, status, updated_at, attempt_count
    INTO v_event
  FROM public.payment_events
  WHERE provider = p_provider AND delivery_id = p_delivery_id
  FOR UPDATE;

  IF v_event.status = 'processed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate', 'event_id', v_event.id);
  END IF;

  IF v_event.status = 'processing'
     AND v_event.updated_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'in_progress', 'event_id', v_event.id);
  END IF;

  UPDATE public.payment_events
     SET status = 'processing',
         attempt_count = COALESCE(attempt_count,0) + 1
   WHERE id = v_event.id;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'reserved', 'event_id', v_event.id, 'retry', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_webhook_delivery(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_webhook_delivery(text,text,text,text,text,text) TO service_role;
