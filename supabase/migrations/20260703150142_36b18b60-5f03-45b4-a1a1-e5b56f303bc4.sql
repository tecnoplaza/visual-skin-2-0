
-- Add mold-related columns to phone_models
ALTER TABLE public.phone_models
  ADD COLUMN IF NOT EXISTS source_psd_url text,
  ADD COLUMN IF NOT EXISTS mold_status text NOT NULL DEFAULT 'pendiente_conversion',
  ADD COLUMN IF NOT EXISTS print_area jsonb;

-- Sanity: constrain mold_status via trigger (avoid CHECK for future flexibility)
CREATE OR REPLACE FUNCTION public.validate_mold_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mold_status NOT IN ('pendiente_conversion','listo') THEN
    RAISE EXCEPTION 'mold_status inválido: %', NEW.mold_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mold_status ON public.phone_models;
CREATE TRIGGER trg_validate_mold_status
BEFORE INSERT OR UPDATE ON public.phone_models
FOR EACH ROW EXECUTE FUNCTION public.validate_mold_status();
