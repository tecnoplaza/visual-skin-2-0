import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
const cart = readFileSync(new URL("../routes/carrito.tsx", import.meta.url), "utf8");
const orderPage = readFileSync(new URL("../routes/pedido.$id.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../routes/admin.orders.$id.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260819030000_order_item_previews.sql", import.meta.url), "utf8");

test("finalización hace upsert único por item y slot", () => {
  assert.match(orders, /upsert\(previewRows, \{ onConflict: "order_item_id,slot" \}\)/);
  assert.match(migration, /unique \(order_item_id, slot\)/);
});
test("firmado usa path de DB, namespace validado y nunca originales", () => {
  const resolver = orders.slice(orders.indexOf("async function resolveOrderItemPreviews"), orders.indexOf("async function getOrderItemsByOrderId"));
  assert.match(resolver, /from\("order_item_previews"\)/);
  assert.match(resolver, /path\.startsWith\(`\$\{orderId\}\/\$\{itemId\}\//);
  assert.match(resolver, /const path = String\(row\.storage_path[\s\S]*createSignedUrl\(path, PREVIEW_SIGNED_URL_TTL_SECONDS\)/);
  assert.doesNotMatch(resolver, /design_assets|customer_original/);
});
test("carrito, pedido post-pago y Admin consumen arrays normalizados", () => {
  assert.match(cart, /cartItemPreviewSlots\(item\)/);
  assert.match(orderPage, /order\?\.items \?\? activeCartItems/);
  assert.match(admin, /item\.previews/);
  assert.match(orders, /items: items\.map\(\(item\) => \(\{ \.\.\.item, previews:/);
});
test("fallback solo aparece con cero previews y tabla es privada", () => {
  assert.match(cart, /previews\.length === 0/);
  assert.match(orderPage, /previews\.length === 0/);
  assert.doesNotMatch(cart + orderPage, /customer_original|design_assets/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.order_item_previews from public, anon, authenticated/);
  assert.match(migration, /to_jsonb\(fd\)->>'case_preview_url'/);
});

test("DB acepta únicamente una pareja order/item real", () => {
  assert.match(migration, /before insert or update of order_id, order_item_id/);
  assert.match(migration, /where oi\.id = new\.order_item_id\s+and oi\.order_id = new\.order_id/);
  assert.match(migration, /errcode = '23503'/);
  assert.match(migration, /order_item_previews_order_item_mismatch/);
});

test("CHECK acepta solo el namespace exacto del pedido e item", () => {
  assert.match(migration, /storage_path like order_id::text \|\| '\/' \|\| order_item_id::text \|\| '\/%'/);
  assert.match(migration, /length\(storage_path\) between 1 and 300/);
  assert.match(migration, /storage_path not like '%\.\.%'/);
  assert.match(migration, /storage_path not like '%\/\/%'/);
});

test("backfill une order/item y excluye namespaces ambiguos", () => {
  const backfill = migration.slice(migration.indexOf("-- Safe backfill"));
  assert.match(backfill, /join public\.order_items oi\s+on oi\.id = fd\.order_item_id\s+and oi\.order_id = fd\.order_id/);
  assert.match(backfill, /preview\.storage_path like fd\.order_id::text \|\| '\/' \|\| fd\.order_item_id::text \|\| '\/%'/);
  assert.doesNotMatch(backfill, /design_assets|customer_original/);
});

test("UNIQUE impide duplicar slot y permisos directos siguen cerrados", () => {
  assert.match(migration, /unique \(order_item_id, slot\)/);
  assert.match(migration, /revoke all on public\.order_item_previews from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.order_item_previews to service_role/);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).*authenticated/);
});
