-- Fix upload authorization lifecycle: issued -> uploaded -> finalized.
-- consume_upload_authorization now stops at 'uploaded' (idempotent re-verification allowed).
-- finalize_order_designs transactionally verifies 'uploaded' auths and stamps them 'finalized'.

CREATE OR REPLACE FUNCTION public.consume_upload_authorization(
  p_storage_path text,
  p_order_id uuid,
  p_kind text,
  p_detected_format text,
  p_detected_width integer,
  p_detected_height integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM public.order_upload_authorizations
    WHERE storage_path = p_storage_path FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_issued');
  END IF;
  IF a.order_id <> p_order_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_mismatch');
  END IF;
  IF a.kind <> p_kind THEN
    RETURN jsonb_build_object('ok', false, 'code', 'kind_mismatch');
  END IF;
  IF a.status = 'finalized' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_finalized');
  END IF;
  IF a.status = 'rejected' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rejected');
  END IF;
  IF a.status = 'expired' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;
  IF a.expires_at < now() THEN
    UPDATE public.order_upload_authorizations
      SET status = 'expired', rejection_reason = 'expired'
      WHERE id = a.id;
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  IF a.status = 'uploaded' THEN
    -- Idempotent re-verification: same order, kind, format, dimensions -> noop.
    IF a.detected_format IS DISTINCT FROM p_detected_format
       OR a.detected_width IS DISTINCT FROM p_detected_width
       OR a.detected_height IS DISTINCT FROM p_detected_height THEN
      RETURN jsonb_build_object('ok', false, 'code', 'metadata_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'noop');
  END IF;

  IF a.status <> 'issued' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  -- issued -> uploaded. Do NOT set finalized_at here.
  UPDATE public.order_upload_authorizations SET
    status = 'uploaded',
    detected_format = p_detected_format,
    detected_width = p_detected_width,
    detected_height = p_detected_height,
    detected_pixels = (COALESCE(p_detected_width, 0)::bigint * COALESCE(p_detected_height, 0)::bigint),
    uploaded_at = COALESCE(uploaded_at, now())
  WHERE id = a.id;

  RETURN jsonb_build_object('ok', true, 'code', 'uploaded');
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_upload_authorization(text, uuid, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_upload_authorization(text, uuid, text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_upload_authorization(text, uuid, text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_upload_authorization(text, uuid, text, text, integer, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.finalize_order_designs(
  p_order_id uuid,
  p_case_path text,
  p_garment_path text,
  p_case_design jsonb,
  p_garment_design jsonb,
  p_bucket text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order        RECORD;
  v_case_auth    RECORD;
  v_garment_auth RECORD;
  v_case_dims    jsonb := COALESCE(p_metadata->'case_dimensions', '{}'::jsonb);
  v_garment_dims jsonb := COALESCE(p_metadata->'garment_dimensions', '{}'::jsonb);
  v_low_res      boolean := COALESCE((p_metadata->>'low_resolution_warning')::boolean, false);
BEGIN
  -- 1) Lock the order.
  SELECT id, payment_status, design_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RAISE EXCEPTION 'order_locked_payment';
  END IF;
  IF v_order.design_status = 'locked' THEN
    RAISE EXCEPTION 'design_locked';
  END IF;

  -- 2) Lock and verify case authorization.
  SELECT * INTO v_case_auth FROM public.order_upload_authorizations
    WHERE storage_path = p_case_path FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_auth_not_found'; END IF;
  IF v_case_auth.order_id <> p_order_id THEN RAISE EXCEPTION 'case_auth_order_mismatch'; END IF;
  IF v_case_auth.kind <> 'case' THEN RAISE EXCEPTION 'case_auth_kind_mismatch'; END IF;
  IF v_case_auth.status <> 'uploaded' THEN RAISE EXCEPTION 'case_auth_not_uploaded'; END IF;
  IF v_case_auth.expires_at < now() THEN RAISE EXCEPTION 'case_auth_expired'; END IF;

  -- 3) Lock and verify garment authorization when present.
  IF p_garment_path IS NOT NULL THEN
    SELECT * INTO v_garment_auth FROM public.order_upload_authorizations
      WHERE storage_path = p_garment_path FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'garment_auth_not_found'; END IF;
    IF v_garment_auth.order_id <> p_order_id THEN RAISE EXCEPTION 'garment_auth_order_mismatch'; END IF;
    IF v_garment_auth.kind <> 'garment' THEN RAISE EXCEPTION 'garment_auth_kind_mismatch'; END IF;
    IF v_garment_auth.status <> 'uploaded' THEN RAISE EXCEPTION 'garment_auth_not_uploaded'; END IF;
    IF v_garment_auth.expires_at < now() THEN RAISE EXCEPTION 'garment_auth_expired'; END IF;
  END IF;

  -- 4) Persist final_designs.
  DELETE FROM public.final_designs WHERE order_id = p_order_id;
  INSERT INTO public.final_designs (
    order_id, case_design, garment_design,
    editor_schema_version, template_version, mold_version,
    validated_at, low_resolution_warning
  ) VALUES (
    p_order_id, p_case_design, p_garment_design,
    p_metadata->>'editor_schema_version',
    p_metadata->>'template_version',
    p_metadata->>'mold_version',
    now(), v_low_res
  );

  -- 5) Persist design_assets.
  DELETE FROM public.design_assets WHERE order_id = p_order_id;
  INSERT INTO public.design_assets (
    order_id, file_path, kind, file_type, metadata, width, height, detected_format
  ) VALUES (
    p_order_id, p_case_path, 'case', 'image',
    jsonb_build_object('bucket', p_bucket) || v_case_dims,
    NULLIF((v_case_dims->>'width')::int, 0),
    NULLIF((v_case_dims->>'height')::int, 0),
    v_case_dims->>'format'
  );
  IF p_garment_path IS NOT NULL THEN
    INSERT INTO public.design_assets (
      order_id, file_path, kind, file_type, metadata, width, height, detected_format
    ) VALUES (
      p_order_id, p_garment_path, 'garment', 'image',
      jsonb_build_object('bucket', p_bucket) || v_garment_dims,
      NULLIF((v_garment_dims->>'width')::int, 0),
      NULLIF((v_garment_dims->>'height')::int, 0),
      v_garment_dims->>'format'
    );
  END IF;

  -- 6) Mark order as ready.
  UPDATE public.custom_orders SET
    design_status = 'ready',
    case_file_path = p_case_path,
    garment_file_path = p_garment_path,
    low_resolution_warning = v_low_res
  WHERE id = p_order_id;

  -- 7) Stamp authorizations as finalized in the same transaction.
  UPDATE public.order_upload_authorizations
    SET status = 'finalized', finalized_at = now()
    WHERE id = v_case_auth.id;
  IF p_garment_path IS NOT NULL THEN
    UPDATE public.order_upload_authorizations
      SET status = 'finalized', finalized_at = now()
      WHERE id = v_garment_auth.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text, jsonb) TO service_role;