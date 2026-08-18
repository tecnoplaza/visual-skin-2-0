import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260817150000_order_items_engine.sql", import.meta.url),
  "utf8",
);
const stage1 = readFileSync(
  new URL("../../supabase/migrations/20260817140000_order_items_stage1.sql", import.meta.url),
  "utf8",
);

function body(name: string, nextName: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = sql.indexOf(`create or replace function public.${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} debe existir`);
  assert.notEqual(end, -1, `${nextName} debe existir después de ${name}`);
  return sql.slice(start, end);
}

test("creación inicial es una sola transacción PostgreSQL", () => {
  const source = body("create_order_with_first_item_v1", "update_order_item_v1");
  assert.match(source, /insert into public\.custom_orders/i);
  assert.match(source, /public\.add_order_item_v1\(/i);
  assert.match(source, /insert into public\.payment_sessions/i);
  assert.doesNotMatch(source, /exception[\s\S]*commit/i);
});

test("recalculate sincroniza primer item legacy e importes agregados", () => {
  const source = body("recalculate_order_from_items_v1", "add_order_item_v1");
  assert.match(source, /where order_id = p_order_id and is_active[\s\S]*order by position/i);
  assert.match(source, /subtotal_amount = v_subtotal/i);
  assert.match(source, /discount_amount = v_discount/i);
  assert.match(source, /total_amount = v_total/i);
});

test("finalización elimina diseños y assets solo por order_item_id", () => {
  const start = sql.indexOf("create or replace function public.finalize_order_item_designs_v1");
  const end = sql.indexOf("revoke all on function", start);
  const source = sql.slice(start, end);
  assert.match(source, /delete from public\.final_designs where order_item_id = p_order_item_id/i);
  assert.match(source, /delete from public\.design_assets where order_item_id = p_order_item_id/i);
  assert.doesNotMatch(source, /delete from public\.(?:final_designs|design_assets) where order_id/i);
  assert.match(source, /session_id = p_session_id/i);
});

test("cada item conserva diseños en una frontera independiente", () => {
  assert.match(stage1, /final_designs_order_item_id_uidx[\s\S]*order_item_id/i);
  const finalize = sql.slice(sql.indexOf("create or replace function public.finalize_order_item_designs_v1"));
  assert.match(finalize, /insert into public\.final_designs \([\s\S]*order_item_id/i);
  assert.match(finalize, /insert into public\.design_assets \(order_id, order_item_id/i);
});

test("Stage 1 repara columnas de prenda secundaria antes del motor", () => {
  assert.match(stage1, /alter table public\.final_designs[\s\S]*add column if not exists secondary_garment_id uuid[\s\S]*references public\.garments\(id\) on delete set null/i);
  assert.match(stage1, /add column if not exists secondary_garment_size text/i);
});

test("Stage 2 instala la reserva canónica e idempotente del webhook", () => {
  const reserve = body("reserve_webhook_delivery", "recalculate_order_from_items_v1");
  assert.match(sql, /create unique index if not exists payment_events_provider_delivery_uidx[\s\S]*on public\.payment_events\(provider, delivery_id\)/i);
  assert.match(reserve, /security definer[\s\S]*set search_path = public/i);
  assert.match(reserve, /on conflict \(provider, delivery_id\) do nothing/i);
  assert.match(reserve, /code', 'duplicate'/i);
  assert.match(reserve, /code', 'in_progress'/i);
  assert.match(sql, /revoke all on function public\.reserve_webhook_delivery\(text,text,text,text,text,text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.reserve_webhook_delivery\(text,text,text,text,text,text\)[\s\S]*to service_role/i);
});
