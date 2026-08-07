-- §5 Revoke access from public/anon/authenticated for internal RPCs.
-- These functions must only be callable by service_role (from server code
-- using SUPABASE_SERVICE_ROLE_KEY). SECURITY DEFINER is preserved so the
-- functions still run with the owner's privileges when service_role invokes.

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'issue_upload_authorization(uuid,uuid,text,text,text,bigint,integer)',
    'consume_upload_authorization(text,uuid,text,text,integer,integer)',
    'reject_upload_authorization(text,text)',
    'finalize_order_designs(uuid,text,text,jsonb,jsonb,text,jsonb)',
    'consume_rate_limit(text,text,integer,integer)',
    'rotate_session_csrf(uuid,text)',
    'revoke_session(uuid)',
    'issue_recovery_token(uuid,text,text,integer,text)',
    'consume_recovery_token(text)',
    'acquire_cleanup_lock(text,integer,text)',
    'release_cleanup_lock(text)',
    'list_abandoned_orders(integer)',
    'begin_payment_attempt(uuid,text,text)',
    'apply_mercado_pago_webhook(uuid,uuid,uuid,text,text,text,text,jsonb)',
    'reserve_webhook_delivery(text,text,text,text,text,text)',
    'unlock_order_design(uuid)',
    'cleanup_abandoned_orders()',
    'cleanup_expired_payment_sessions()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated',
      fn
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%s TO service_role',
      fn
    );
  END LOOP;
END $$;

-- has_role is legitimately callable by authenticated users (used inside RLS).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- §10 Unschedule legacy / duplicate cron jobs. Keep only current names.
DO $$
DECLARE
  j text;
  legacy text[] := ARRAY[
    'cleanup_abandoned_orders_hourly',
    'cleanup_expired_sessions_daily',
    'visualskin-storage-cleanup-old',
    'visualskin-cleanup-abandoned',
    'visualskin-cleanup-sessions'
  ];
BEGIN
  FOREACH j IN ARRAY legacy LOOP
    BEGIN
      PERFORM cron.unschedule(j);
    EXCEPTION WHEN OTHERS THEN
      -- ignore: job did not exist
      NULL;
    END;
  END LOOP;
END $$;
