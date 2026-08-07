
CREATE OR REPLACE FUNCTION public.enforce_fulfillment_requires_paid()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
     AND COALESCE(NEW.payment_status::text, '') <> 'approved' THEN
    RAISE EXCEPTION 'Fulfillment status cannot change before payment approval'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_fulfillment_requires_paid ON public.custom_orders;
CREATE TRIGGER trg_enforce_fulfillment_requires_paid
BEFORE UPDATE ON public.custom_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_fulfillment_requires_paid();
