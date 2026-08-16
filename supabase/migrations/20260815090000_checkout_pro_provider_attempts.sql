-- Checkout Pro preferences are not payment attempts. An attempt is attached
-- only after Mercado Pago exposes a real payment id.
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS payment_flow text NOT NULL DEFAULT 'card_payment';

-- Fail closed before normalizing the pre-existing unique index. Never choose
-- or rewrite one of the duplicate historical rows automatically.
DO $duplicate_check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_attempts
    WHERE mercado_pago_payment_id IS NOT NULL
    GROUP BY mercado_pago_payment_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_mercado_pago_payment_id';
  END IF;
END;
$duplicate_check$;

-- This index was originally introduced by migration
-- 20260704031315_391ef1cc-cd57-4ef2-9ba7-2f7c0c3d6356. IF NOT EXISTS keeps
-- the canonical name without creating a redundant second index.
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_mp_payment_uidx
  ON public.payment_attempts (mercado_pago_payment_id)
  WHERE mercado_pago_payment_id IS NOT NULL;

ALTER TABLE public.payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_payment_flow_check;
ALTER TABLE public.payment_attempts
  ADD CONSTRAINT payment_attempts_payment_flow_check
  CHECK (payment_flow IN ('card_payment', 'checkout_pro'));

-- Create the narrower protection first, then remove the historical broader
-- index. In the migration transaction Card Payment is never left unprotected.
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_active_card_uidx
  ON public.payment_attempts (order_id)
  WHERE payment_flow = 'card_payment'
    AND status IN ('processing', 'pending', 'awaiting_reconciliation');
DROP INDEX IF EXISTS public.payment_attempts_one_active_uidx;

-- Short-lived, server-owned Checkout Pro preference cache/creation lease.
-- A preference is not a payment and these nullable columns do not change the
-- payment state of existing orders.
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS mercadopago_preference_id text,
  ADD COLUMN IF NOT EXISTS mercadopago_checkout_url text,
  ADD COLUMN IF NOT EXISTS mercadopago_preference_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS mercadopago_preference_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS mercadopago_preference_environment text,
  ADD COLUMN IF NOT EXISTS mercadopago_preference_claim_token uuid,
  ADD COLUMN IF NOT EXISTS mercadopago_preference_claimed_at timestamptz;

ALTER TABLE public.custom_orders
  DROP CONSTRAINT IF EXISTS custom_orders_mp_preference_environment_check;
ALTER TABLE public.custom_orders
  ADD CONSTRAINT custom_orders_mp_preference_environment_check
  CHECK (mercadopago_preference_environment IS NULL OR
         mercadopago_preference_environment IN ('test', 'production'));

CREATE OR REPLACE FUNCTION public.claim_mercado_pago_checkout_pro_preference(
  p_order_id uuid,
  p_environment text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_order RECORD;
BEGIN
  IF p_environment NOT IN ('test','production') OR p_claim_token IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_claim');
  END IF;
  SELECT id,payment_status,design_status,legal_accepted_at,
         mercadopago_preference_id,mercadopago_checkout_url,
         mercadopago_preference_created_at,mercadopago_preference_expires_at,
         mercadopago_preference_environment,
         mercadopago_preference_claimed_at
    INTO v_order FROM public.custom_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','order_not_found'); END IF;
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RETURN jsonb_build_object('ok',false,'code','order_locked');
  END IF;
  IF v_order.design_status <> 'ready' OR v_order.legal_accepted_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','order_not_ready');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE order_id=p_order_id
             AND status IN ('processing','pending','awaiting_reconciliation')) THEN
    RETURN jsonb_build_object('ok',false,'code','active_payment');
  END IF;

  IF v_order.payment_status='pending'
     AND v_order.mercadopago_preference_environment=p_environment
     AND v_order.mercadopago_preference_expires_at > now()+interval '30 seconds'
     AND v_order.mercadopago_preference_id IS NOT NULL
     AND v_order.mercadopago_checkout_url IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'code','reused',
      'preference_id',v_order.mercadopago_preference_id,
      'checkout_url',v_order.mercadopago_checkout_url);
  END IF;

  IF v_order.mercadopago_preference_claimed_at > now()-interval '2 minutes' THEN
    RETURN jsonb_build_object('ok',false,'code','creation_in_progress');
  END IF;
  UPDATE public.custom_orders SET mercadopago_preference_claim_token=p_claim_token,
    mercadopago_preference_claimed_at=now() WHERE id=p_order_id;
  RETURN jsonb_build_object('ok',true,'code','claimed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.store_mercado_pago_checkout_pro_preference(
  p_order_id uuid, p_environment text, p_claim_token uuid,
  p_preference_id text, p_checkout_url text, p_expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_order RECORD;
BEGIN
  SELECT id,payment_status,mercadopago_preference_claim_token INTO v_order
    FROM public.custom_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','order_not_found'); END IF;
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RETURN jsonb_build_object('ok',false,'code','order_locked');
  END IF;
  IF v_order.mercadopago_preference_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok',false,'code','claim_mismatch');
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE order_id=p_order_id
             AND status IN ('processing','pending','awaiting_reconciliation')) THEN
    RETURN jsonb_build_object('ok',false,'code','active_payment');
  END IF;
  IF p_preference_id IS NULL OR length(btrim(p_preference_id))=0 OR length(p_preference_id)>200 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_preference_id');
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now()+interval '30 seconds'
     OR p_expires_at > now()+interval '31 minutes' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_expiration');
  END IF;
  IF (p_environment='test' AND p_checkout_url !~ '^https://sandbox\.mercadopago\.(com|cl)/')
     OR (p_environment='production' AND p_checkout_url !~ '^https://www\.mercadopago\.(com|cl)/')
     OR p_environment NOT IN ('test','production') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_checkout_url');
  END IF;
  UPDATE public.custom_orders SET mercadopago_preference_id=p_preference_id,
    mercadopago_checkout_url=p_checkout_url,
    mercadopago_preference_created_at=now(),
    mercadopago_preference_expires_at=p_expires_at,
    mercadopago_preference_environment=p_environment,
    mercadopago_preference_claim_token=NULL,
    mercadopago_preference_claimed_at=NULL WHERE id=p_order_id;
  RETURN jsonb_build_object('ok',true,'code','stored');
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_mercado_pago_checkout_pro_preference_claim(
  p_order_id uuid, p_claim_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.custom_orders SET mercadopago_preference_claim_token=NULL,
    mercadopago_preference_claimed_at=NULL
    WHERE id=p_order_id AND mercadopago_preference_claim_token=p_claim_token;
  RETURN jsonb_build_object('ok',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_mercado_pago_checkout_pro_preference(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.store_mercado_pago_checkout_pro_preference(uuid,text,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_mercado_pago_checkout_pro_preference_claim(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mercado_pago_checkout_pro_preference(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_mercado_pago_checkout_pro_preference(uuid,text,uuid,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_mercado_pago_checkout_pro_preference_claim(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_mercado_pago_checkout_pro_attempt(
  p_order_id uuid,
  p_payment_id text,
  p_payment_environment text,
  p_is_live_mode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_previous_status text;
BEGIN
  IF p_payment_id IS NULL OR p_payment_id !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payment_id');
  END IF;
  IF p_payment_environment NOT IN ('test', 'production') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_environment');
  END IF;

  SELECT id, order_id, status INTO v_existing
    FROM public.payment_attempts
    WHERE mercado_pago_payment_id = p_payment_id
    FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id <> p_order_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'payment_id_reused');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'attempt_id', v_existing.id,
      'attempt_status', v_existing.status
    );
  END IF;

  SELECT id, payment_status, payment_environment, is_live_mode, design_status
    INTO v_order
    FROM public.custom_orders
    WHERE id = p_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_not_found');
  END IF;
  IF v_order.payment_status IN ('approved', 'refunded', 'charged_back') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_locked',
                              'order_status', v_order.payment_status);
  END IF;
  IF v_order.design_status NOT IN ('ready', 'locked') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'design_not_ready');
  END IF;
  IF v_order.payment_environment <> p_payment_environment
     OR v_order.is_live_mode IS DISTINCT FROM p_is_live_mode THEN
    RETURN jsonb_build_object('ok', false, 'code', 'environment_mismatch');
  END IF;

  v_previous_status := v_order.payment_status;
  SELECT COALESCE(max(attempt_number), 0) + 1 INTO v_attempt_number
    FROM public.payment_attempts WHERE order_id = p_order_id;

  INSERT INTO public.payment_attempts (
    order_id, attempt_number, idempotency_key, request_fingerprint,
    mercado_pago_payment_id, status, previous_order_status,
    payment_environment, is_live_mode, payment_flow
  ) VALUES (
    p_order_id, v_attempt_number, 'mp-provider:' || p_payment_id,
    'mp-provider:' || p_payment_id, p_payment_id, 'processing',
    v_previous_status, p_payment_environment, p_is_live_mode, 'checkout_pro'
  )
  RETURNING id INTO v_attempt_id;

  UPDATE public.custom_orders
    SET payment_status = CASE
          WHEN payment_status IN ('rejected', 'cancelled') THEN 'pending'
          ELSE payment_status
        END,
        design_status = CASE WHEN design_status = 'ready' THEN 'locked' ELSE design_status END,
        mp_payment_id = COALESCE(mp_payment_id, p_payment_id)
    WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'reused', false,
                            'attempt_id', v_attempt_id,
                            'attempt_status', 'processing');
EXCEPTION WHEN unique_violation THEN
  SELECT id, order_id, status INTO v_existing
    FROM public.payment_attempts
    WHERE mercado_pago_payment_id = p_payment_id;
  IF FOUND AND v_existing.order_id = p_order_id THEN
    RETURN jsonb_build_object('ok', true, 'reused', true,
                              'attempt_id', v_existing.id,
                              'attempt_status', v_existing.status);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'payment_id_reused');
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_mercado_pago_checkout_pro_attempt(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_mercado_pago_checkout_pro_attempt(uuid,text,text,boolean) TO service_role;

-- Keep the canonical state machine shared by direct Card Payment and Checkout
-- Pro. Only Checkout Pro relaxes the attempt metadata and card-only method rule.
CREATE OR REPLACE FUNCTION public.apply_mercado_pago_payment_response(
  p_order_id uuid, p_attempt_id uuid, p_payment_id text,
  p_payment_status text, p_status_detail text, p_live_mode boolean,
  p_transaction_amount numeric, p_currency_id text,
  p_external_reference text, p_metadata_order_id text,
  p_metadata_attempt_id text, p_payment_type_id text,
  p_collector_id text, p_expected_collector_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD; v_attempt RECORD; v_mapped_order text; v_mapped_attempt text;
  v_from text; v_apply boolean := false; v_terminal boolean := false;
  v_dup RECORD; v_reason text := NULL;
BEGIN
  SELECT id,total_amount,payment_status,payment_environment,is_live_mode,manual_review_required
    INTO v_order FROM public.custom_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  SELECT id,order_id,status,mercado_pago_payment_id,payment_environment,is_live_mode,payment_flow
    INTO v_attempt FROM public.payment_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v_attempt.order_id<>p_order_id THEN RAISE EXCEPTION 'attempt_order_mismatch'; END IF;

  IF v_attempt.status IN ('approved','rejected','cancelled','refunded','charged_back')
     AND v_attempt.mercado_pago_payment_id=p_payment_id THEN
    RETURN jsonb_build_object('ok',true,'applied_transition',false,
      'order_status',v_order.payment_status,'attempt_status',v_attempt.status,
      'terminal',true,'idempotent',true);
  END IF;

  IF p_payment_id IS NULL OR length(btrim(p_payment_id))=0 THEN v_reason:='missing_payment_id';
  ELSIF p_payment_status IS NULL OR p_payment_status NOT IN
    ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back') THEN v_reason:='unknown_status';
  ELSIF v_attempt.status NOT IN ('processing','pending','awaiting_reconciliation') THEN v_reason:='attempt_state_incompatible';
  ELSIF p_external_reference IS NULL OR p_external_reference<>v_order.id::text THEN v_reason:='external_reference_mismatch';
  ELSIF p_metadata_order_id IS NULL OR p_metadata_order_id<>v_order.id::text THEN v_reason:='metadata_order_mismatch';
  ELSIF v_attempt.payment_flow<>'checkout_pro'
        AND (p_metadata_attempt_id IS NULL OR p_metadata_attempt_id<>v_attempt.id::text) THEN v_reason:='metadata_attempt_mismatch';
  ELSIF p_transaction_amount IS NULL OR p_transaction_amount<>v_order.total_amount THEN v_reason:='amount_mismatch';
  ELSIF p_currency_id IS NULL OR upper(p_currency_id)<>'CLP' THEN v_reason:='currency_mismatch';
  ELSIF v_attempt.payment_environment<>v_order.payment_environment
        OR v_attempt.is_live_mode IS DISTINCT FROM p_live_mode THEN v_reason:='environment_mismatch';
  ELSIF p_payment_type_id IS NULL OR length(btrim(p_payment_type_id))=0 THEN v_reason:='payment_type_not_allowed';
  ELSIF v_attempt.payment_flow<>'checkout_pro'
        AND p_payment_type_id NOT IN ('credit_card','debit_card') THEN v_reason:='payment_type_not_allowed';
  ELSIF p_expected_collector_id IS NOT NULL AND length(btrim(p_expected_collector_id))>0
        AND (p_collector_id IS NULL OR p_collector_id<>p_expected_collector_id) THEN v_reason:='collector_mismatch';
  ELSIF v_attempt.mercado_pago_payment_id IS NOT NULL
        AND v_attempt.mercado_pago_payment_id<>p_payment_id THEN v_reason:='attempt_payment_id_mismatch';
  END IF;
  IF v_reason IS NULL THEN
    SELECT id,order_id INTO v_dup FROM public.payment_attempts
      WHERE mercado_pago_payment_id=p_payment_id AND id<>v_attempt.id LIMIT 1;
    IF FOUND THEN v_reason:='payment_id_reused'; END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    UPDATE public.payment_attempts SET status='awaiting_reconciliation',
      status_detail='reconcile:'||v_reason,
      mercado_pago_payment_id=COALESCE(mercado_pago_payment_id,p_payment_id),last_synced_at=now()
      WHERE id=v_attempt.id;
    UPDATE public.custom_orders SET manual_review_required=true,
      mp_payment_id=COALESCE(mp_payment_id,p_payment_id),last_mercado_pago_sync_at=now()
      WHERE id=v_order.id;
    RETURN jsonb_build_object('ok',false,'code','requires_reconciliation','reason',v_reason);
  END IF;

  v_mapped_order:=CASE p_payment_status WHEN 'approved' THEN 'approved'
    WHEN 'pending' THEN 'pending' WHEN 'in_process' THEN 'pending'
    WHEN 'authorized' THEN 'pending' WHEN 'rejected' THEN 'rejected'
    WHEN 'cancelled' THEN 'cancelled' WHEN 'refunded' THEN 'refunded'
    WHEN 'charged_back' THEN 'charged_back' END;
  v_mapped_attempt:=v_mapped_order;
  v_terminal:=v_mapped_attempt IN ('approved','rejected','cancelled','refunded','charged_back');
  v_from:=v_order.payment_status;
  IF v_from=v_mapped_order THEN v_apply:=false;
  ELSIF v_from='pending' AND v_mapped_order IN ('approved','rejected','cancelled','refunded','charged_back') THEN v_apply:=true;
  ELSIF v_from='approved' AND v_mapped_order IN ('refunded','charged_back') THEN v_apply:=true;
  ELSE
    UPDATE public.payment_attempts SET status='awaiting_reconciliation',
      status_detail='reconcile:unexpected_transition',
      mercado_pago_payment_id=COALESCE(mercado_pago_payment_id,p_payment_id),last_synced_at=now()
      WHERE id=v_attempt.id;
    UPDATE public.custom_orders SET manual_review_required=true,
      mp_payment_id=COALESCE(mp_payment_id,p_payment_id),last_mercado_pago_sync_at=now()
      WHERE id=v_order.id;
    RETURN jsonb_build_object('ok',false,'code','requires_reconciliation','reason','unexpected_transition');
  END IF;
  UPDATE public.payment_attempts SET mercado_pago_payment_id=p_payment_id,
    status=v_mapped_attempt,status_detail=p_status_detail,last_synced_at=now(),
    completed_at=CASE WHEN v_terminal THEN now() ELSE completed_at END WHERE id=v_attempt.id;
  IF v_apply THEN
    UPDATE public.custom_orders SET payment_status=v_mapped_order,mp_payment_id=p_payment_id,
      last_mercado_pago_sync_at=now(),payment_status_updated_at=now(),manual_review_required=false
      WHERE id=v_order.id;
  ELSE
    UPDATE public.custom_orders SET mp_payment_id=COALESCE(mp_payment_id,p_payment_id),
      last_mercado_pago_sync_at=now() WHERE id=v_order.id;
  END IF;
  RETURN jsonb_build_object('ok',true,'applied_transition',v_apply,
    'order_status',v_mapped_order,'attempt_status',v_mapped_attempt,
    'terminal',v_terminal,'payment_live_mode_audit',p_live_mode);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_mercado_pago_payment_response(uuid,uuid,text,text,text,boolean,numeric,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mercado_pago_payment_response(uuid,uuid,text,text,text,boolean,numeric,text,text,text,text,text,text,text) TO service_role;
