
ALTER TABLE public.phone_models
  ADD COLUMN IF NOT EXISTS overlay_url text,
  ADD COLUMN IF NOT EXISTS holes_url text;

CREATE OR REPLACE FUNCTION public.validate_mold_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.mold_status NOT IN ('pendiente_conversion','listo','error_conversion') THEN
    RAISE EXCEPTION 'mold_status inválido: %', NEW.mold_status;
  END IF;
  RETURN NEW;
END;
$$;
