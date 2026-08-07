
-- 1. Extend design_status to include 'editable' and 'locked'.
ALTER TABLE public.custom_orders DROP CONSTRAINT IF EXISTS custom_orders_design_status_check;
ALTER TABLE public.custom_orders ADD CONSTRAINT custom_orders_design_status_check
  CHECK (design_status = ANY (ARRAY['pending','editable','uploading','ready','locked','failed']));

-- 2. Extend payment_attempts.status with 'awaiting_reconciliation'.
ALTER TABLE public.payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_status_check;
ALTER TABLE public.payment_attempts ADD CONSTRAINT payment_attempts_status_check
  CHECK (status = ANY (ARRAY['processing','pending','awaiting_reconciliation','approved','rejected','cancelled','error','refunded','charged_back']));

-- 3. Update partial unique index: awaiting_reconciliation blocks new attempts too.
DROP INDEX IF EXISTS public.payment_attempts_one_active_uidx;
CREATE UNIQUE INDEX payment_attempts_one_active_uidx ON public.payment_attempts (order_id)
  WHERE status = ANY (ARRAY['processing','pending','awaiting_reconciliation']);

-- 4. Unique final_designs per order.
ALTER TABLE public.final_designs DROP CONSTRAINT IF EXISTS final_designs_order_id_uniq;
ALTER TABLE public.final_designs ADD CONSTRAINT final_designs_order_id_uniq UNIQUE (order_id);

-- 5. Recreate begin_payment_attempt: block on active/awaiting_reconciliation,
--    require design_status ready|locked, atomically lock design.
CREATE OR REPLACE FUNCTION public.begin_payment_attempt(
  p_order_id uuid, p_idempotency_key text, p_request_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order       RECORD;
  v_existing    RECORD;
  v_attempt_id  uuid;
  v_attempt_num int;
  v_prev_status text;
BEGIN
  SELECT id, payment_status, design_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_not_found');
  END IF;

  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_locked',
                              'order_status', v_order.payment_status);
  END IF;

  IF v_order.design_status NOT IN ('ready','locked') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'design_not_ready',
                              'design_status', v_order.design_status);
  END IF;

  -- Same-fingerprint dedup in the last 60s (double-submit).
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
      'order_status', v_order.payment_status,
      'design_status', v_order.design_status
    );
  END IF;

  -- Any active/awaiting_reconciliation attempt blocks a new one.
  PERFORM 1 FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND status IN ('processing','pending','awaiting_reconciliation');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'awaiting_confirmation');
  END IF;

  v_prev_status := v_order.payment_status;
  IF v_order.payment_status IN ('rejected','cancelled') THEN
    UPDATE public.custom_orders SET payment_status = 'pending' WHERE id = p_order_id;
  END IF;

  -- Lock the design for the duration of the payment attempt.
  IF v_order.design_status = 'ready' THEN
    UPDATE public.custom_orders SET design_status = 'locked' WHERE id = p_order_id;
  END IF;

  SELECT COALESCE(MAX(attempt_number),0) + 1 INTO v_attempt_num
    FROM public.payment_attempts WHERE order_id = p_order_id;

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
    'order_status', 'pending',
    'design_status', 'locked'
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'awaiting_confirmation');
END;
$$;

-- 6. unlock_order_design: explicit and safe reset of design after a
--    terminal-non-approved payment result. Only when no active attempt.
CREATE OR REPLACE FUNCTION public.unlock_order_design(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order RECORD; v_active int;
BEGIN
  SELECT id, payment_status, design_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_not_found');
  END IF;
  IF v_order.design_status <> 'locked' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'noop',
                              'design_status', v_order.design_status);
  END IF;
  IF v_order.payment_status NOT IN ('rejected','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'payment_not_recoverable',
                              'payment_status', v_order.payment_status);
  END IF;
  SELECT count(*) INTO v_active FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND status IN ('processing','pending','awaiting_reconciliation');
  IF v_active > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'has_active_attempt');
  END IF;
  UPDATE public.custom_orders SET design_status = 'ready' WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'code', 'unlocked');
END; $$;

-- 7. finalize_order_designs: transactional insert of final_designs,
--    design_assets and update of custom_orders. Rolls back on any failure.
CREATE OR REPLACE FUNCTION public.finalize_order_designs(
  p_order_id uuid,
  p_case_path text,
  p_garment_path text,
  p_case_design jsonb,
  p_garment_design jsonb,
  p_bucket text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order RECORD;
BEGIN
  SELECT id, payment_status, design_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RAISE EXCEPTION 'order_locked_payment';
  END IF;
  IF v_order.design_status = 'locked' THEN
    RAISE EXCEPTION 'design_locked';
  END IF;

  DELETE FROM public.final_designs WHERE order_id = p_order_id;
  INSERT INTO public.final_designs (order_id, case_design, garment_design)
    VALUES (p_order_id, p_case_design, p_garment_design);

  DELETE FROM public.design_assets WHERE order_id = p_order_id;
  INSERT INTO public.design_assets (order_id, file_path, kind, file_type, metadata)
    VALUES (p_order_id, p_case_path, 'case', 'image',
            jsonb_build_object('bucket', p_bucket));
  IF p_garment_path IS NOT NULL THEN
    INSERT INTO public.design_assets (order_id, file_path, kind, file_type, metadata)
      VALUES (p_order_id, p_garment_path, 'garment', 'image',
              jsonb_build_object('bucket', p_bucket));
  END IF;

  UPDATE public.custom_orders SET
    design_status = 'ready',
    case_file_path = p_case_path,
    garment_file_path = p_garment_path
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END; $$;

-- 8. apply_mercado_pago_webhook: transactional update of the three tables.
--    Raises on any inconsistency so the webhook returns a retryable error.
CREATE OR REPLACE FUNCTION public.apply_mercado_pago_webhook(
  p_event_id uuid,
  p_order_id uuid,
  p_attempt_id uuid,
  p_mp_payment_id text,
  p_new_status text,
  p_status_detail text,
  p_processing_result text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order   RECORD;
  v_attempt RECORD;
  v_apply   boolean := false;
  v_from    text;
  v_to      text;
  v_att_st  text;
BEGIN
  SELECT id, payment_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT id, order_id, mercado_pago_payment_id, status INTO v_attempt
    FROM public.payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.order_id <> p_order_id THEN
    RAISE EXCEPTION 'attempt_mismatch';
  END IF;
  IF v_attempt.mercado_pago_payment_id IS NOT NULL
     AND v_attempt.mercado_pago_payment_id <> p_mp_payment_id THEN
    RAISE EXCEPTION 'payment_id_mismatch';
  END IF;

  v_from := v_order.payment_status;
  v_to := p_new_status;

  IF v_from = v_to THEN
    v_apply := false;
  ELSIF v_from = 'pending' AND v_to IN ('approved','rejected','cancelled') THEN v_apply := true;
  ELSIF v_from = 'rejected' AND v_to IN ('pending','cancelled') THEN v_apply := true;
  ELSIF v_from = 'cancelled' AND v_to = 'pending' THEN v_apply := true;
  ELSIF v_from = 'approved' AND v_to IN ('refunded','charged_back') THEN v_apply := true;
  END IF;

  IF v_apply THEN
    UPDATE public.custom_orders SET
      payment_status = v_to,
      mp_payment_id = p_mp_payment_id,
      last_mercado_pago_sync_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.custom_orders SET
      mp_payment_id = p_mp_payment_id,
      last_mercado_pago_sync_at = now()
    WHERE id = p_order_id;
  END IF;

  v_att_st := CASE WHEN v_to = 'pending' THEN 'pending' ELSE v_to END;
  UPDATE public.payment_attempts SET
    mercado_pago_payment_id = p_mp_payment_id,
    status = v_att_st,
    status_detail = p_status_detail,
    last_synced_at = now(),
    completed_at = CASE WHEN v_to <> 'pending' THEN now() ELSE completed_at END
  WHERE id = p_attempt_id;

  UPDATE public.payment_events SET
    status = 'processed',
    processed_at = now(),
    processing_result = p_processing_result,
    order_id = p_order_id,
    payload = COALESCE(p_payload, '{}'::jsonb)
  WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true, 'applied_transition', v_apply,
                            'from', v_from, 'to', v_to);
END; $$;

-- 9. Grants: RPCs are called from service_role only.
REVOKE EXECUTE ON FUNCTION public.begin_payment_attempt(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlock_order_design(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_mercado_pago_webhook(uuid, uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_payment_attempt(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_order_design(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_mercado_pago_webhook(uuid, uuid, uuid, text, text, text, text, jsonb) TO service_role;
