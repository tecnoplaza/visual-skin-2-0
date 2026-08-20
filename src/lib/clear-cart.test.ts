import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/site/Header.tsx", import.meta.url), "utf8");
const cart = readFileSync(new URL("../routes/carrito.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260819040000_clear_active_cart.sql", import.meta.url), "utf8");
const checkoutMigration = readFileSync(new URL("../../supabase/migrations/20260817160000_checkout_pro_multi_item.sql", import.meta.url), "utf8");

test("el último item se deriva al clear RPC y no al bloqueo legacy", () => {
  assert.match(orders, /activeItems.*select\("id"\)/s);
  assert.match(orders, /activeItems\?\.\[0\]\?\.id === data\.orderItemId/);
  assert.match(orders, /rpc\("clear_active_cart_v1"/);
  assert.doesNotMatch(orders.slice(orders.indexOf("export const removeOrderItem"), orders.indexOf("export const getCart")), /last_active_item_required/);
});

test("clear exige sesión/CSRF y no modifica pedidos cerrados", () => {
  assert.match(orders, /export const clearActiveCart/);
  assert.match(orders.slice(orders.indexOf("export const clearActiveCart"), orders.indexOf("export const getCart")), /requireOrderSessionAndCsrf/);
  assert.match(migration, /approved.*refunded.*charged_back/);
  assert.match(migration, /design_status = 'locked'/);
  assert.match(migration, /status in \('processing','pending','awaiting_reconciliation'\)/);
});

test("drawer y carrito ofrecen vaciado con confirmación y actualización", () => {
  assert.match(header, /clearActiveCart/);
  assert.match(header, /Vaciar carrito/);
  assert.match(header, /window\.confirm/);
  assert.match(header, /items: \[\]/);
  assert.match(cart, /clearActiveCart/);
  assert.match(cart, /Vaciar carrito/);
  assert.match(cart, /window\.confirm/);
});

test("clear hace soft delete, conserva diseños y deja totales cero", () => {
  assert.match(migration, /update public\.order_items\s+set is_active = false/s);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.order_items/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(order_item_previews|design_assets|final_designs)/i);
  assert.doesNotMatch(migration, /storage\.(remove|delete)/i);
  assert.match(migration, /get diagnostics v_removed = row_count/);
  assert.match(migration, /subtotal_amount = 0/);
  assert.match(migration, /discount_amount = 0/);
  assert.match(migration, /shipping_amount = 0/);
  assert.match(migration, /total_amount = 0/);
  assert.match(migration, /design_status = 'draft'/);
  assert.match(readFileSync(new URL("./cart-core.ts", import.meta.url), "utf8"), /items\.length > 0/);
});

test("soft delete invalida la revisiÃ³n canÃ³nica y evita reutilizar snapshots viejos", () => {
  assert.match(checkoutMigration, /update of is_active[\s\S]*on public\.order_items/);
  assert.match(checkoutMigration, /cart_version = cart_version \+ 1/);
  assert.match(checkoutMigration, /cart_fingerprint = null/);
  assert.match(checkoutMigration, /where order_id=p_order_id and is_active/);
  assert.match(checkoutMigration, /v_order\.cart_version<>v_snapshot\.cart_version/);
  assert.match(checkoutMigration, /v_order\.cart_fingerprint<>v_snapshot\.cart_fingerprint/);
  assert.match(checkoutMigration, /code','items_not_ready'/);
});
