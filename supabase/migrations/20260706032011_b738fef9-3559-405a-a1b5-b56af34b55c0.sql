
CREATE OR REPLACE FUNCTION public.apply_mercado_pago_payment_response(
  p_order_id uuid,
  p_attempt_id uuid,
  p_payment_id text,
  p_payment_status text,
  p_status_detail text,
  p_live_mode boolean,
  p_transaction_amount numeric,
  p_currency_id text,
  p_external_reference text,
  p_metadata_order_id text,
  p_metadata_attempt_id text,
  p_payment_type_id text,
  p_collector_id text,
  p_expected_collector_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order          RECORD;
  v_attempt        RECORD;
  v_mapped_order   text;
  v_mapped_attempt text;
  v_from           text;
  v_apply          boolean := false;
  v_terminal       boolean := false;
  v_dup            RECORD;
  v_reason         text := NULL;
BEGIN
  SELECT id, total_amount, payment_status, payment_environment, is_live_mode,
         manual_review_required
    INTO v_order
    FROM public.custom_orders
    WHERE id = p_order_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT id, order_id, status, mercado_pago_payment_id,
         payment_environment, is_live_mode
    INTO v_attempt
    FROM public.payment_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v_attempt.order_id <> p_order_id THEN RAISE EXCEPTION 'attempt_order_mismatch'; END IF;

  -- Idempotent short-circuit: attempt already terminal with the same MP id.
  -- Prevents contradictory transitions when the same notification is replayed.
  IF v_attempt.status IN ('approved','rejected','cancelled')
     AND v_attempt.mercado_pago_payment_id IS NOT NULL
     AND v_attempt.mercado_pago_payment_id = p_payment_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applied_transition', false,
      'order_status', v_order.payment_status,
      'attempt_status', v_attempt.status,
      'terminal', true,
      'idempotent', true
    );
  END IF;

  -- Canonical validations. Any mismatch => reconciliation.
  IF p_payment_id IS NULL OR length(btrim(p_payment_id)) = 0 THEN
    v_reason := 'missing_payment_id';
  ELSIF p_payment_status IS NULL
        OR p_payment_status NOT IN ('approved','pending','in_process','rejected','cancelled') THEN
    v_reason := 'unknown_status';
  ELSIF v_attempt.status NOT IN ('processing','pending','awaiting_reconciliation') THEN
    v_reason := 'attempt_state_incompatible';
  ELSIF p_external_reference IS NULL OR p_external_reference <> v_order.id::text THEN
    v_reason := 'external_reference_mismatch';
  ELSIF p_metadata_order_id IS NULL OR p_metadata_order_id <> v_order.id::text THEN
    v_reason := 'metadata_order_mismatch';
  ELSIF p_metadata_attempt_id IS NULL OR p_metadata_attempt_id <> v_attempt.id::text THEN
    v_reason := 'metadata_attempt_mismatch';
  ELSIF p_transaction_amount IS NULL
        OR p_transaction_amount <> v_order.total_amount THEN
    v_reason := 'amount_mismatch';
  ELSIF p_currency_id IS NULL OR upper(p_currency_id) <> 'CLP' THEN
    v_reason := 'currency_mismatch';
  ELSIF v_attempt.payment_environment <> v_order.payment_environment THEN
    v_reason := 'environment_mismatch';
  ELSIF p_payment_type_id IS NULL
        OR p_payment_type_id NOT IN ('credit_card','debit_card') THEN
    v_reason := 'payment_type_not_allowed';
  ELSIF p_expected_collector_id IS NOT NULL
        AND length(btrim(p_expected_collector_id)) > 0
        AND (p_collector_id IS NULL OR p_collector_id <> p_expected_collector_id) THEN
    v_reason := 'collector_mismatch';
  ELSIF v_attempt.mercado_pago_payment_id IS NOT NULL
        AND v_attempt.mercado_pago_payment_id <> p_payment_id THEN
    v_reason := 'attempt_payment_id_mismatch';
  END IF;

  IF v_reason IS NULL THEN
    SELECT id, order_id INTO v_dup
      FROM public.payment_attempts
      WHERE mercado_pago_payment_id = p_payment_id
        AND id <> v_attempt.id
      LIMIT 1;
    IF FOUND THEN v_reason := 'payment_id_reused'; END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- Persist the payment id even when we can't apply a transition, so the
    -- webhook / reconciler can retry safely. Never overwrite a conflicting id.
    UPDATE public.payment_attempts SET
      status = 'awaiting_reconciliation',
      status_detail = 'reconcile:' || v_reason,
      mercado_pago_payment_id = COALESCE(mercado_pago_payment_id, p_payment_id),
      last_synced_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.custom_orders SET
      manual_review_required = true,
      mp_payment_id = COALESCE(mp_payment_id, p_payment_id),
      last_mercado_pago_sync_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', false, 'code', 'requires_reconciliation', 'reason', v_reason);
  END IF;

  v_mapped_order := CASE p_payment_status
    WHEN 'approved'   THEN 'approved'
    WHEN 'pending'    THEN 'pending'
    WHEN 'in_process' THEN 'pending'
    WHEN 'rejected'   THEN 'rejected'
    WHEN 'cancelled'  THEN 'cancelled'
  END;
  v_mapped_attempt := v_mapped_order;
  v_terminal := v_mapped_attempt IN ('approved','rejected','cancelled');
  v_from := v_order.payment_status;

  IF v_from = v_mapped_order THEN
    v_apply := false;
  ELSIF v_from = 'pending' AND v_mapped_order IN ('approved','rejected','cancelled') THEN
    v_apply := true;
  ELSE
    UPDATE public.payment_attempts SET
      status = 'awaiting_reconciliation',
      status_detail = 'reconcile:unexpected_transition',
      mercado_pago_payment_id = COALESCE(mercado_pago_payment_id, p_payment_id),
      last_synced_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.custom_orders SET
      manual_review_required = true,
      mp_payment_id = COALESCE(mp_payment_id, p_payment_id),
      last_mercado_pago_sync_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('ok', false, 'code', 'requires_reconciliation', 'reason', 'unexpected_transition');
  END IF;

  UPDATE public.payment_attempts SET
    mercado_pago_payment_id = p_payment_id,
    status                  = v_mapped_attempt,
    status_detail           = p_status_detail,
    last_synced_at          = now(),
    completed_at            = CASE WHEN v_terminal THEN now() ELSE completed_at END
  WHERE id = v_attempt.id;

  IF v_apply THEN
    UPDATE public.custom_orders SET
      payment_status              = v_mapped_order,
      mp_payment_id               = p_payment_id,
      last_mercado_pago_sync_at   = now(),
      payment_status_updated_at   = now(),
      manual_review_required      = false
    WHERE id = v_order.id;
  ELSE
    UPDATE public.custom_orders SET
      mp_payment_id               = COALESCE(mp_payment_id, p_payment_id),
      last_mercado_pago_sync_at   = now()
    WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied_transition', v_apply,
    'order_status', v_mapped_order,
    'attempt_status', v_mapped_attempt,
    'terminal', v_terminal,
    'payment_live_mode_audit', p_live_mode
  );
END;
$function$;
