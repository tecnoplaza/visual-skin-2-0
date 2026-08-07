-- Repair NULLs (none currently but idempotent)
WITH repaired AS (
  UPDATE public.phone_models
     SET print_area = '{"x":0,"y":0,"width":100,"height":100,"radius":8,"camera":null}'::jsonb
   WHERE print_area IS NULL
   RETURNING 1
)
SELECT COUNT(*) FROM repaired;

-- Set default
ALTER TABLE public.phone_models
  ALTER COLUMN print_area SET DEFAULT '{"x":0,"y":0,"width":100,"height":100,"radius":8,"camera":null}'::jsonb;

-- Trigger function
CREATE OR REPLACE FUNCTION public.ensure_phone_model_print_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.print_area IS NULL THEN
    NEW.print_area := '{"x":0,"y":0,"width":100,"height":100,"radius":8,"camera":null}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_phone_model_print_area_trg ON public.phone_models;

CREATE TRIGGER ensure_phone_model_print_area_trg
BEFORE INSERT OR UPDATE OF print_area ON public.phone_models
FOR EACH ROW
EXECUTE FUNCTION public.ensure_phone_model_print_area();