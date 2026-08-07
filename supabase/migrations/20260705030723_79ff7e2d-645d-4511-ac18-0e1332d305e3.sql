CREATE OR REPLACE FUNCTION public.diagnose_visualskin_admin_role()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'current_user', current_user::text,
    'session_user', session_user::text,
    'jwt_role', COALESCE(
      current_setting('request.jwt.claim.role', true),
      (NULLIF(current_setting('request.jwt', true), '')::jsonb ->> 'role'),
      'none'
    ),
    'can_execute_rate_limit', has_function_privilege(
      current_user,
      'public.consume_rate_limit(text,text,integer,integer)',
      'EXECUTE'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_visualskin_admin_role() TO anon, authenticated, service_role;