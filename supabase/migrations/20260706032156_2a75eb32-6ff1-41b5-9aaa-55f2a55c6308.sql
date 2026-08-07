
CREATE OR REPLACE FUNCTION public.enforce_order_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- session_user preserves the original login role across SECURITY DEFINER
  -- boundaries. current_user changes to the function owner (postgres) and
  -- can't be used to distinguish the payments pipeline from admin edits.
  is_service boolean := session_user = 'service_role';
BEGIN
  IF is_service THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    RAISE EXCEPTION 'payment_status solo puede ser modificado por la pasarela de pagos';
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.shipping_amount IS DISTINCT FROM OLD.shipping_amount THEN
    RAISE EXCEPTION 'los montos no pueden ser modificados desde el panel';
  END IF;
  IF NEW.mp_payment_id IS DISTINCT FROM OLD.mp_payment_id
     OR NEW.mp_preference_id IS DISTINCT FROM OLD.mp_preference_id
     OR NEW.mp_idempotency_key IS DISTINCT FROM OLD.mp_idempotency_key
     OR NEW.public_access_token_hash IS DISTINCT FROM OLD.public_access_token_hash
     OR NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'campos de pago/identificación son inmutables';
  END IF;
  RETURN NEW;
END;
$function$;
