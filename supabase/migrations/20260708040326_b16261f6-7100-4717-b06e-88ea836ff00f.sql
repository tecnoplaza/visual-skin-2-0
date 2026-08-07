-- Aceptación legal previa al pago para pedidos VisualSkin.
-- Columnas mínimas y una restricción "presente-o-ausente" (inmutable).
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS legal_accepted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS legal_acceptance_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS legal_acceptance_hash text NULL;

ALTER TABLE public.custom_orders
  DROP CONSTRAINT IF EXISTS custom_orders_legal_acceptance_consistency;

ALTER TABLE public.custom_orders
  ADD CONSTRAINT custom_orders_legal_acceptance_consistency
  CHECK (
    (legal_accepted_at IS NULL
       AND legal_acceptance_snapshot IS NULL
       AND legal_acceptance_hash IS NULL)
    OR
    (legal_accepted_at IS NOT NULL
       AND legal_acceptance_snapshot IS NOT NULL
       AND legal_acceptance_hash IS NOT NULL)
  );