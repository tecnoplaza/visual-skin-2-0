
-- 1) pack_type CHECK
ALTER TABLE public.custom_orders DROP CONSTRAINT IF EXISTS custom_orders_pack_type_check;
ALTER TABLE public.custom_orders ADD CONSTRAINT custom_orders_pack_type_check
  CHECK (pack_type = ANY (ARRAY['carcasa','carcasa+polera','carcasa+poleron','carcasa+polera+poleron']));

-- 2) custom_orders: secondary garment columns
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS secondary_garment_id uuid REFERENCES public.garments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_garment_size text,
  ADD COLUMN IF NOT EXISTS secondary_garment_color text,
  ADD COLUMN IF NOT EXISTS secondary_garment_file_path text,
  ADD COLUMN IF NOT EXISTS secondary_garment_design_url text;

CREATE INDEX IF NOT EXISTS custom_orders_secondary_garment_id_idx
  ON public.custom_orders(secondary_garment_id);

-- 3) final_designs: secondary garment columns
ALTER TABLE public.final_designs
  ADD COLUMN IF NOT EXISTS secondary_garment_id uuid REFERENCES public.garments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secondary_garment_size text,
  ADD COLUMN IF NOT EXISTS secondary_garment_design jsonb,
  ADD COLUMN IF NOT EXISTS secondary_garment_preview_url text;

-- 4) authorized kinds
ALTER TABLE public.order_upload_authorizations DROP CONSTRAINT IF EXISTS order_upload_authorizations_kind_check;
ALTER TABLE public.order_upload_authorizations ADD CONSTRAINT order_upload_authorizations_kind_check
  CHECK (kind = ANY (ARRAY['case','garment','secondary_garment']));

ALTER TABLE public.design_assets DROP CONSTRAINT IF EXISTS design_assets_kind_check;
ALTER TABLE public.design_assets ADD CONSTRAINT design_assets_kind_check
  CHECK (kind = ANY (ARRAY['case','garment','secondary_garment','other']));

-- 5) finalize_order_designs_v3
CREATE OR REPLACE FUNCTION public.finalize_order_designs_v3(
  p_order_id uuid,
  p_case_path text,
  p_garment_path text,
  p_secondary_garment_path text,
  p_case_design jsonb,
  p_garment_design jsonb,
  p_secondary_garment_design jsonb,
  p_bucket text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order          RECORD;
  v_case_auth      RECORD;
  v_garment_auth   RECORD;
  v_secondary_auth RECORD;
  v_case_dims      jsonb := COALESCE(p_metadata->'case_dimensions', '{}'::jsonb);
  v_garment_dims   jsonb := COALESCE(p_metadata->'garment_dimensions', '{}'::jsonb);
  v_secondary_dims jsonb := COALESCE(p_metadata->'secondary_garment_dimensions', '{}'::jsonb);
  v_low_res        boolean := COALESCE((p_metadata->>'low_resolution_warning')::boolean, false);
BEGIN
  -- 1) Lock order
  SELECT id, pack_type, payment_status, design_status INTO v_order
    FROM public.custom_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.payment_status IN ('approved','refunded','charged_back') THEN
    RAISE EXCEPTION 'order_locked_payment';
  END IF;
  IF v_order.design_status = 'locked' THEN
    RAISE EXCEPTION 'design_locked';
  END IF;

  -- 2) Validate pack composition
  IF p_case_path IS NULL THEN RAISE EXCEPTION 'case_path_required'; END IF;

  IF v_order.pack_type = 'carcasa' THEN
    IF p_garment_path IS NOT NULL THEN RAISE EXCEPTION 'garment_path_not_allowed'; END IF;
    IF p_secondary_garment_path IS NOT NULL THEN RAISE EXCEPTION 'secondary_garment_path_not_allowed'; END IF;
  ELSIF v_order.pack_type IN ('carcasa+polera','carcasa+poleron') THEN
    IF p_garment_path IS NULL THEN RAISE EXCEPTION 'garment_path_required'; END IF;
    IF p_secondary_garment_path IS NOT NULL THEN RAISE EXCEPTION 'secondary_garment_path_not_allowed'; END IF;
  ELSIF v_order.pack_type = 'carcasa+polera+poleron' THEN
    IF p_garment_path IS NULL THEN RAISE EXCEPTION 'garment_path_required'; END IF;
    IF p_secondary_garment_path IS NULL THEN RAISE EXCEPTION 'secondary_garment_path_required'; END IF;
  ELSE
    RAISE EXCEPTION 'unknown_pack_type';
  END IF;

  IF p_garment_path IS NOT NULL AND p_garment_path = p_case_path THEN
    RAISE EXCEPTION 'duplicate_path_case_garment';
  END IF;
  IF p_secondary_garment_path IS NOT NULL AND p_secondary_garment_path = p_case_path THEN
    RAISE EXCEPTION 'duplicate_path_case_secondary';
  END IF;
  IF p_secondary_garment_path IS NOT NULL AND p_secondary_garment_path = p_garment_path THEN
    RAISE EXCEPTION 'duplicate_path_garment_secondary';
  END IF;

  -- 3) Lock/verify case auth
  SELECT * INTO v_case_auth FROM public.order_upload_authorizations
    WHERE storage_path = p_case_path FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_auth_not_found'; END IF;
  IF v_case_auth.order_id <> p_order_id THEN RAISE EXCEPTION 'case_auth_order_mismatch'; END IF;
  IF v_case_auth.kind <> 'case' THEN RAISE EXCEPTION 'case_auth_kind_mismatch'; END IF;
  IF v_case_auth.status <> 'uploaded' THEN RAISE EXCEPTION 'case_auth_not_uploaded'; END IF;
  IF v_case_auth.expires_at < now() THEN RAISE EXCEPTION 'case_auth_expired'; END IF;

  -- 4) Lock/verify garment auth
  IF p_garment_path IS NOT NULL THEN
    SELECT * INTO v_garment_auth FROM public.order_upload_authorizations
      WHERE storage_path = p_garment_path FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'garment_auth_not_found'; END IF;
    IF v_garment_auth.order_id <> p_order_id THEN RAISE EXCEPTION 'garment_auth_order_mismatch'; END IF;
    IF v_garment_auth.kind <> 'garment' THEN RAISE EXCEPTION 'garment_auth_kind_mismatch'; END IF;
    IF v_garment_auth.status <> 'uploaded' THEN RAISE EXCEPTION 'garment_auth_not_uploaded'; END IF;
    IF v_garment_auth.expires_at < now() THEN RAISE EXCEPTION 'garment_auth_expired'; END IF;
  END IF;

  -- 5) Lock/verify secondary garment auth
  IF p_secondary_garment_path IS NOT NULL THEN
    SELECT * INTO v_secondary_auth FROM public.order_upload_authorizations
      WHERE storage_path = p_secondary_garment_path FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'secondary_garment_auth_not_found'; END IF;
    IF v_secondary_auth.order_id <> p_order_id THEN RAISE EXCEPTION 'secondary_garment_auth_order_mismatch'; END IF;
    IF v_secondary_auth.kind <> 'secondary_garment' THEN RAISE EXCEPTION 'secondary_garment_auth_kind_mismatch'; END IF;
    IF v_secondary_auth.status <> 'uploaded' THEN RAISE EXCEPTION 'secondary_garment_auth_not_uploaded'; END IF;
    IF v_secondary_auth.expires_at < now() THEN RAISE EXCEPTION 'secondary_garment_auth_expired'; END IF;
  END IF;

  -- 6) final_designs
  DELETE FROM public.final_designs WHERE order_id = p_order_id;
  INSERT INTO public.final_designs (
    order_id, case_design, garment_design, secondary_garment_design,
    editor_schema_version, template_version, mold_version,
    validated_at, low_resolution_warning
  ) VALUES (
    p_order_id, p_case_design, p_garment_design, p_secondary_garment_design,
    p_metadata->>'editor_schema_version',
    p_metadata->>'template_version',
    p_metadata->>'mold_version',
    now(), v_low_res
  );

  -- 7) design_assets
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
  IF p_secondary_garment_path IS NOT NULL THEN
    INSERT INTO public.design_assets (
      order_id, file_path, kind, file_type, metadata, width, height, detected_format
    ) VALUES (
      p_order_id, p_secondary_garment_path, 'secondary_garment', 'image',
      jsonb_build_object('bucket', p_bucket) || v_secondary_dims,
      NULLIF((v_secondary_dims->>'width')::int, 0),
      NULLIF((v_secondary_dims->>'height')::int, 0),
      v_secondary_dims->>'format'
    );
  END IF;

  -- 8) custom_orders
  UPDATE public.custom_orders SET
    design_status = 'ready',
    case_file_path = p_case_path,
    garment_file_path = p_garment_path,
    secondary_garment_file_path = p_secondary_garment_path,
    low_resolution_warning = v_low_res
  WHERE id = p_order_id;

  -- 9) finalize authorizations
  UPDATE public.order_upload_authorizations
    SET status = 'finalized', finalized_at = now()
    WHERE id = v_case_auth.id;
  IF p_garment_path IS NOT NULL THEN
    UPDATE public.order_upload_authorizations
      SET status = 'finalized', finalized_at = now()
      WHERE id = v_garment_auth.id;
  END IF;
  IF p_secondary_garment_path IS NOT NULL THEN
    UPDATE public.order_upload_authorizations
      SET status = 'finalized', finalized_at = now()
      WHERE id = v_secondary_auth.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_order_designs_v3(uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_order_designs_v3(uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_order_designs_v3(uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_order_designs_v3(uuid, text, text, text, jsonb, jsonb, jsonb, text, jsonb) TO service_role;
