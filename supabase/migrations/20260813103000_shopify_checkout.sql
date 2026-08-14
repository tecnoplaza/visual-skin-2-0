-- Shopify checkout migration for VisualSkin.
-- Stores the cart/checkout reference so repeated clicks reuse the same
-- checkout instead of creating multiple carts.
ALTER TABLE public.custom_orders
  ADD COLUMN IF NOT EXISTS shopify_cart_id TEXT,
  ADD COLUMN IF NOT EXISTS shopify_checkout_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS custom_orders_shopify_order_id_idx
  ON public.custom_orders (shopify_order_id)
  WHERE shopify_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS custom_orders_shopify_cart_id_idx
  ON public.custom_orders (shopify_cart_id)
  WHERE shopify_cart_id IS NOT NULL;
