# VisualSkin â€” Shopify Checkout migration

This project has been prepared so the existing VisualSkin order/design flow stays in place and the card form is replaced by Shopify Checkout.

## Flow

VisualSkin contact/customer data -> order + design -> legal acceptance -> **Pagar** -> Shopify Checkout -> Shopify payment -> `orders/paid` webhook -> VisualSkin marks the order as `approved`.

The Storefront API `cartCreate` returns Shopify's `checkoutUrl`, which is the URL used for the redirect.

## Required Shopify setup

1. Create the Shopify product/variants that correspond to the four VisualSkin pack types.
2. Make the Shopify variant prices match the VisualSkin **subtotal**.
3. Create a Storefront API token with the scopes required to create carts/checkouts.
4. Set the variables in `.env` using `.env.example`.
5. Register an HTTPS Shopify webhook for `orders/paid` pointing to:
   `https://visualskin.cl/api/public/webhooks/shopify`
6. The webhook secret must match `SHOPIFY_WEBHOOK_SECRET`.
7. Ensure the Shopify store has Chile configured and its shipping/pickup amount matches VisualSkin's canonical shipping amount. The paid webhook rejects an order whose subtotal or total differs from VisualSkin.

## Important

The code verifies the Shopify variant subtotal and currency against the canonical VisualSkin order before redirecting. The paid webhook verifies the configured variant, currency, subtotal, and total again before approving the order. Any mismatch is rejected rather than silently accepting a different charge.

The webhook is the source of truth for payment approval; the browser returning from checkout is not trusted.

## Supabase

Apply the migration:

`supabase/migrations/20260813103000_shopify_checkout.sql`

It adds `shopify_cart_id` and `shopify_checkout_url` to `custom_orders`.

## Current state

Mercado Pago code is still present in the repository for rollback. The order page no longer needs to render the Mercado Pago card form once the Shopify changes are enabled.
