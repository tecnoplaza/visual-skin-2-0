ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS payment_environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS is_live_mode boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.custom_orders
    ADD CONSTRAINT custom_orders_payment_environment_chk
    CHECK (payment_environment IN ('test','production'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS payment_environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS is_live_mode boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.payment_attempts
    ADD CONSTRAINT payment_attempts_payment_environment_chk
    CHECK (payment_environment IN ('test','production'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS custom_orders_payment_environment_idx
  ON public.custom_orders(payment_environment);
CREATE INDEX IF NOT EXISTS payment_attempts_payment_environment_idx
  ON public.payment_attempts(payment_environment);