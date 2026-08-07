DROP FUNCTION IF EXISTS public.diagnose_visualskin_admin_role();

UPDATE public.payment_gateways
SET
  webhook_path = '/functions/v1/mercadopago-webhook?source_news=webhooks',
  updated_at = now()
WHERE provider = 'mercadopago'
  AND webhook_path = '/api/public/webhooks/mercadopago';