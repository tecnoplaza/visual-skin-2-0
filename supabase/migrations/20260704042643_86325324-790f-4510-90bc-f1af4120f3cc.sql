
-- §6 Upload authorizations table
CREATE TABLE public.order_upload_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.payment_sessions(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('case','garment')),
  storage_path text NOT NULL,
  declared_mime text NOT NULL,
  declared_size bigint NOT NULL,
  detected_format text,
  detected_width integer,
  detected_height integer,
  detected_pixels bigint,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','uploaded','finalized','rejected','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  finalized_at timestamptz,
  rejection_reason text
);
CREATE UNIQUE INDEX order_upload_auth_path_uidx
  ON public.order_upload_authorizations(storage_path);
CREATE INDEX order_upload_auth_order_idx
  ON public.order_upload_authorizations(order_id);
GRANT ALL ON public.order_upload_authorizations TO service_role;
ALTER TABLE public.order_upload_authorizations ENABLE ROW LEVEL SECURITY;
-- Only service_role interacts with this table. No policies for anon/authenticated.

-- §8 Snapshot columns on custom_orders
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS catalog_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS phone_model_id uuid REFERENCES public.phone_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS garment_id uuid REFERENCES public.garments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS low_resolution_warning boolean NOT NULL DEFAULT false;

-- §9 final_designs metadata
ALTER TABLE public.final_designs
  ADD COLUMN IF NOT EXISTS editor_schema_version text,
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS mold_version text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS low_resolution_warning boolean NOT NULL DEFAULT false;

-- §7 design_assets dimensions
ALTER TABLE public.design_assets
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS detected_format text;

-- §6 RPCs: issue + finalize authorization
CREATE OR REPLACE FUNCTION public.issue_upload_authorization(
  p_order_id uuid,
  p_session_id uuid,
  p_kind text,
  p_storage_path text,
  p_declared_mime text,
  p_declared_size bigint,
  p_ttl_seconds int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.order_upload_authorizations(
    order_id, session_id, kind, storage_path, declared_mime, declared_size,
    expires_at
  ) VALUES (
    p_order_id, p_session_id, p_kind, p_storage_path, p_declared_mime, p_declared_size,
    now() + make_interval(secs => p_ttl_seconds)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.consume_upload_authorization(
  p_storage_path text,
  p_order_id uuid,
  p_kind text,
  p_detected_format text,
  p_detected_width int,
  p_detected_height int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM public.order_upload_authorizations
    WHERE storage_path = p_storage_path FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_issued'); END IF;
  IF a.order_id <> p_order_id THEN RETURN jsonb_build_object('ok', false, 'code', 'order_mismatch'); END IF;
  IF a.kind <> p_kind THEN RETURN jsonb_build_object('ok', false, 'code', 'kind_mismatch'); END IF;
  IF a.status = 'finalized' THEN RETURN jsonb_build_object('ok', false, 'code', 'already_finalized'); END IF;
  IF a.status NOT IN ('issued','uploaded') THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_status'); END IF;
  IF a.expires_at < now() THEN
    UPDATE public.order_upload_authorizations
      SET status='expired', rejection_reason='expired' WHERE id=a.id;
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;
  UPDATE public.order_upload_authorizations SET
    status='finalized',
    detected_format=p_detected_format,
    detected_width=p_detected_width,
    detected_height=p_detected_height,
    detected_pixels = (COALESCE(p_detected_width,0)::bigint * COALESCE(p_detected_height,0)::bigint),
    uploaded_at = COALESCE(uploaded_at, now()),
    finalized_at = now()
  WHERE id=a.id;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.reject_upload_authorization(
  p_storage_path text,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.order_upload_authorizations
    SET status='rejected', rejection_reason=p_reason
    WHERE storage_path=p_storage_path AND status IN ('issued','uploaded');
END; $$;

REVOKE EXECUTE ON FUNCTION public.issue_upload_authorization(uuid,uuid,text,text,text,bigint,int)
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_upload_authorization(text,uuid,text,text,int,int)
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_upload_authorization(text,text)
  FROM public, anon, authenticated;

-- §9 finalize_order_designs v2: add metadata + dimensions atomically
DROP FUNCTION IF EXISTS public.finalize_order_designs(uuid,text,text,jsonb,jsonb,text);
CREATE OR REPLACE FUNCTION public.finalize_order_designs(
  p_order_id uuid,
  p_case_path text,
  p_garment_path text,
  p_case_design jsonb,
  p_garment_design jsonb,
  p_bucket text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_case_dims jsonb := COALESCE(p_metadata->'case_dimensions', '{}'::jsonb);
  v_garment_dims jsonb := COALESCE(p_metadata->'garment_dimensions', '{}'::jsonb);
  v_low_res boolean := COALESCE((p_metadata->>'low_resolution_warning')::boolean, false);
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

  DELETE FROM public.design_assets WHERE order_id = p_order_id;
  INSERT INTO public.design_assets (order_id, file_path, kind, file_type, metadata, width, height, detected_format)
    VALUES (
      p_order_id, p_case_path, 'case', 'image',
      jsonb_build_object('bucket', p_bucket) || v_case_dims,
      NULLIF((v_case_dims->>'width')::int, 0),
      NULLIF((v_case_dims->>'height')::int, 0),
      v_case_dims->>'format'
    );
  IF p_garment_path IS NOT NULL THEN
    INSERT INTO public.design_assets (order_id, file_path, kind, file_type, metadata, width, height, detected_format)
      VALUES (
        p_order_id, p_garment_path, 'garment', 'image',
        jsonb_build_object('bucket', p_bucket) || v_garment_dims,
        NULLIF((v_garment_dims->>'width')::int, 0),
        NULLIF((v_garment_dims->>'height')::int, 0),
        v_garment_dims->>'format'
      );
  END IF;

  UPDATE public.custom_orders SET
    design_status = 'ready',
    case_file_path = p_case_path,
    garment_file_path = p_garment_path,
    low_resolution_warning = v_low_res
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END; $$;
