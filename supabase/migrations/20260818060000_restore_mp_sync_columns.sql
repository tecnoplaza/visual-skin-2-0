-- Restore Mercado Pago synchronization columns required by the
-- canonical payment application functions.
-- Idempotent because production environments may already contain them.

alter table public.custom_orders
  add column if not exists payment_status_updated_at timestamptz,
  add column if not exists last_mercado_pago_sync_at timestamptz;

update public.custom_orders
set payment_status_updated_at = coalesce(
  payment_status_updated_at,
  updated_at
)
where payment_status_updated_at is null;
