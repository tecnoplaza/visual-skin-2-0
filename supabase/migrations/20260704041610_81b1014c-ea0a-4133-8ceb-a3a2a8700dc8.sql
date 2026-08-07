
REVOKE EXECUTE ON FUNCTION public.begin_payment_attempt(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_order_design(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_order_designs(uuid, text, text, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_mercado_pago_webhook(uuid, uuid, uuid, text, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_webhook_delivery(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_webhook_delivery(text, text, text, text, text, text) TO service_role;
