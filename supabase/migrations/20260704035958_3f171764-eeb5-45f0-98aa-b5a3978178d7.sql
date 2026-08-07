
-- Enable extensions required for scheduling.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Harden cleanup: never delete orders that have an active/terminal payment
-- attempt in progress; keep audit trail for pending confirmations.
CREATE OR REPLACE FUNCTION public.cleanup_abandoned_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Storage first.
  DELETE FROM storage.objects o
  USING public.custom_orders co
  WHERE o.bucket_id = 'order-designs'
    AND (o.name LIKE (co.id::text || '/%'))
    AND co.payment_status IN ('pending','rejected','cancelled')
    AND co.design_status <> 'ready'
    AND co.created_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_attempts pa
      WHERE pa.order_id = co.id AND pa.status IN ('processing','pending')
    );

  DELETE FROM public.custom_orders co
  WHERE co.payment_status IN ('pending','rejected','cancelled')
    AND co.design_status <> 'ready'
    AND co.created_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_attempts pa
      WHERE pa.order_id = co.id AND pa.status IN ('processing','pending')
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- Expired session cleanup (7-day audit retention).
CREATE OR REPLACE FUNCTION public.cleanup_expired_payment_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.payment_sessions
  WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- Unschedule prior instances (idempotent).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
           WHERE jobname IN ('cleanup_abandoned_orders_hourly','cleanup_expired_sessions_daily')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup_abandoned_orders_hourly',
  '17 * * * *',
  $$SELECT public.cleanup_abandoned_orders();$$
);

SELECT cron.schedule(
  'cleanup_expired_sessions_daily',
  '23 3 * * *',
  $$SELECT public.cleanup_expired_payment_sessions();$$
);
