
-- §14 Sessions: add CSRF hash + revocation + absolute expiry
ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS csrf_token_hash text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;

UPDATE public.payment_sessions
  SET absolute_expires_at = COALESCE(absolute_expires_at, created_at + interval '7 days');

ALTER TABLE public.payment_sessions
  ALTER COLUMN absolute_expires_at SET NOT NULL,
  ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '7 days');

CREATE INDEX IF NOT EXISTS payment_sessions_absolute_expires_idx
  ON public.payment_sessions(absolute_expires_at);

CREATE OR REPLACE FUNCTION public.rotate_session_csrf(
  p_session_id uuid, p_new_csrf_hash text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_sessions
    SET csrf_token_hash = p_new_csrf_hash
    WHERE id = p_session_id
      AND revoked_at IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = p_session_id;
END; $$;

-- §12 Persistent rate limits
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,           -- e.g. 'create_order', 'exchange_token'
  bucket_key text NOT NULL,      -- hashed identifier (ip+action, order+action, ...)
  hits int NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  window_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- Only service role touches this table; no anon/auth policies needed.

CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_scope_key_uidx
  ON public.rate_limits(scope, bucket_key);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx
  ON public.rate_limits(window_expires_at);

-- Atomically consume one hit. Returns { allowed, remaining, retry_after_seconds }.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_scope text,
  p_bucket_key text,
  p_limit int,
  p_window_seconds int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.rate_limits;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_allowed boolean;
  v_retry int := 0;
BEGIN
  v_expires := v_now + make_interval(secs => p_window_seconds);

  INSERT INTO public.rate_limits(scope, bucket_key, hits, window_started_at, window_expires_at)
    VALUES (p_scope, p_bucket_key, 1, v_now, v_expires)
    ON CONFLICT (scope, bucket_key) DO UPDATE
      SET hits = CASE
                   WHEN public.rate_limits.window_expires_at < v_now THEN 1
                   ELSE public.rate_limits.hits + 1
                 END,
          window_started_at = CASE
                   WHEN public.rate_limits.window_expires_at < v_now THEN v_now
                   ELSE public.rate_limits.window_started_at
                 END,
          window_expires_at = CASE
                   WHEN public.rate_limits.window_expires_at < v_now THEN v_expires
                   ELSE public.rate_limits.window_expires_at
                 END,
          updated_at = v_now
    RETURNING * INTO v_row;

  v_allowed := v_row.hits <= p_limit;
  IF NOT v_allowed THEN
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.window_expires_at - v_now)))::int);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', GREATEST(0, p_limit - v_row.hits),
    'retry_after_seconds', v_retry
  );
END; $$;

-- §14 Recovery tokens
CREATE TABLE IF NOT EXISTS public.order_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.custom_orders(id) ON DELETE CASCADE,
  customer_email_normalized text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  requested_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.order_recovery_tokens TO service_role;
ALTER TABLE public.order_recovery_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS order_recovery_tokens_email_idx
  ON public.order_recovery_tokens(customer_email_normalized);
CREATE INDEX IF NOT EXISTS order_recovery_tokens_expires_idx
  ON public.order_recovery_tokens(expires_at);

-- Invalidate all previous unused tokens for the same order+email before issuing.
CREATE OR REPLACE FUNCTION public.issue_recovery_token(
  p_order_id uuid,
  p_email_normalized text,
  p_token_hash text,
  p_ttl_seconds int,
  p_ip_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.order_recovery_tokens
    SET revoked_at = now()
    WHERE order_id = p_order_id
      AND customer_email_normalized = p_email_normalized
      AND used_at IS NULL
      AND revoked_at IS NULL;

  INSERT INTO public.order_recovery_tokens
    (order_id, customer_email_normalized, token_hash, expires_at, requested_ip_hash)
    VALUES (p_order_id, p_email_normalized, p_token_hash,
            now() + make_interval(secs => p_ttl_seconds), p_ip_hash)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.consume_recovery_token(
  p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.order_recovery_tokens
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF r.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'used'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'revoked'); END IF;
  IF r.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'code', 'expired'); END IF;
  UPDATE public.order_recovery_tokens SET used_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'order_id', r.order_id,
                            'email', r.customer_email_normalized);
END; $$;

-- §15 Cleanup locks (advisory lock as a table for cross-request visibility)
CREATE TABLE IF NOT EXISTS public.cleanup_execution_locks (
  scope text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NOT NULL,
  actor text
);

GRANT ALL ON public.cleanup_execution_locks TO service_role;
ALTER TABLE public.cleanup_execution_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.acquire_cleanup_lock(
  p_scope text, p_ttl_seconds int, p_actor text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean := false;
BEGIN
  INSERT INTO public.cleanup_execution_locks(scope, locked_at, locked_until, actor)
    VALUES (p_scope, now(), now() + make_interval(secs => p_ttl_seconds), p_actor)
    ON CONFLICT (scope) DO UPDATE
      SET locked_at = EXCLUDED.locked_at,
          locked_until = EXCLUDED.locked_until,
          actor = EXCLUDED.actor
      WHERE public.cleanup_execution_locks.locked_until < now()
    RETURNING true INTO ok;
  RETURN COALESCE(ok, false);
END; $$;

CREATE OR REPLACE FUNCTION public.release_cleanup_lock(p_scope text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.cleanup_execution_locks WHERE scope = p_scope;
END; $$;

-- Abandoned orders eligible for physical cleanup (older than 24h, no paid state,
-- no active attempts, design not ready).
CREATE OR REPLACE FUNCTION public.list_abandoned_orders(p_limit int)
RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT co.id
  FROM public.custom_orders co
  WHERE co.payment_status IN ('pending','rejected','cancelled')
    AND co.design_status <> 'ready'
    AND co.created_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_attempts pa
      WHERE pa.order_id = co.id
        AND pa.status IN ('processing','pending','awaiting_reconciliation')
    )
  ORDER BY co.created_at ASC
  LIMIT p_limit;
$$;
