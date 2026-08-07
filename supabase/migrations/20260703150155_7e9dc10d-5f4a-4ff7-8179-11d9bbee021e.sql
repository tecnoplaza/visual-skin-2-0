
CREATE OR REPLACE FUNCTION public.validate_mold_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.mold_status NOT IN ('pendiente_conversion','listo') THEN
    RAISE EXCEPTION 'mold_status inválido: %', NEW.mold_status;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_mold_status() FROM PUBLIC, anon, authenticated;
