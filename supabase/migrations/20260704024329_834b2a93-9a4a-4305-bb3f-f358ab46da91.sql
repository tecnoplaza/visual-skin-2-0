
CREATE TABLE public.payment_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  display_name text NOT NULL,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
  enabled boolean NOT NULL DEFAULT false,
  public_key text,
  webhook_path text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_gateways TO authenticated;
GRANT ALL ON public.payment_gateways TO service_role;

ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view payment gateways"
  ON public.payment_gateways FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert payment gateways"
  ON public.payment_gateways FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update payment gateways"
  ON public.payment_gateways FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete payment gateways"
  ON public.payment_gateways FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_gateways_updated_at
  BEFORE UPDATE ON public.payment_gateways
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed conocido: Mercado Pago (ya integrado en el proyecto)
INSERT INTO public.payment_gateways (provider, display_name, mode, enabled, webhook_path, notes)
VALUES ('mercadopago', 'Mercado Pago', 'sandbox', true, '/api/public/webhooks/mercadopago',
  'Requiere secrets MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PUBLIC_KEY y MERCADOPAGO_WEBHOOK_SECRET.')
ON CONFLICT (provider) DO NOTHING;
