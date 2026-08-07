
DROP VIEW IF EXISTS public.admin_users;
CREATE VIEW public.admin_users
WITH (security_invoker = true) AS
  SELECT user_id, created_at FROM public.user_roles WHERE role = 'admin';
GRANT SELECT ON public.admin_users TO authenticated;
