import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../supabase/migrations/20260817160000_checkout_pro_multi_item.sql", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../../supabase/functions/mercadopago-webhook/index.ts", import.meta.url), "utf8");

test("snapshot is unique per exact cart revision and preference", () => {
  assert.match(sql, /unique index[\s\S]*\(order_id,cart_version,cart_fingerprint\)[\s\S]*status in \('claiming','ready'\)/i);
  assert.match(sql, /unique \(preference_id\)/i);
  assert.match(sql, /expected_total bigint/i);
});

test("claim locks the order and derives all prices from active order_items", () => {
  assert.match(sql, /where id=p_order_id for update/i);
  assert.match(sql, /from public\.order_items where order_id=p_order_id and is_active/i);
  assert.match(sql, /v_subtotal <> v_item_sum/i);
  assert.doesNotMatch(sql, /using\s*\(true\)/i);
});

test("double checkout uses one snapshot and logical attempt", () => {
  assert.match(sql, /payment_checkout_snapshots_current_revision_uidx/i);
  assert.match(sql, /'mp-checkout:'\|\|p_snapshot_id::text/i);
  assert.match(sql, /on conflict\(idempotency_key\)/i);
});

test("stale cart or old amount cannot be applied", () => {
  assert.match(sql, /v_attempt\.cart_fingerprint is distinct from v_order\.cart_fingerprint/i);
  assert.match(sql, /v_attempt\.expected_total is distinct from p_transaction_amount/i);
  assert.match(sql, /checkout_snapshot_mismatch/i);
});

test("webhook resolves immutable snapshot and remains idempotent", () => {
  assert.match(webhook, /payment_checkout_snapshots/);
  assert.match(webhook, /attach_checkout_pro_snapshot_payment_v1/);
  assert.match(webhook, /apply_checkout_pro_snapshot_payment_v1/);
  assert.match(webhook, /reserveWebhookDelivery/);
});

test("browser cannot supply unit price or total to checkout", () => {
  const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
  assert.match(orders, /CheckoutProOrderInput = z\.object\(\{ orderId:/);
  assert.doesNotMatch(orders, /CheckoutProOrderInput[\s\S]{0,100}(unit_price|total_amount)/);
});
