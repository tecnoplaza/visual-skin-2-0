
REVOKE ALL ON FUNCTION public.cleanup_abandoned_orders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_payment_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_orders() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_payment_sessions() TO service_role;
