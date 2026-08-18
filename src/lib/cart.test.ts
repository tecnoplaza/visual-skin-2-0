import assert from "node:assert/strict";
import test from "node:test";
import { activeCartItems, canContinueCart, cartItemCount, cartWriteMode, isMultiItemPaymentBlocked, type ActiveCart } from "./cart-core.ts";
import type { OrderItem } from "./order-items.ts";

function item(id: string, status = "ready"): OrderItem {
  return {
    id, order_id: "order", position: 0, quantity: 1,
    client_item_key: `key-${id}`, request_fingerprint: "a".repeat(64),
    pack_id: null, pack_type: "carcasa", brand_id: null, brand: "Marca",
    phone_model_id: "model", phone_model: "Modelo", garment_id: null,
    garment_size: null, garment_color: null, secondary_garment_id: null,
    secondary_garment_size: null, secondary_garment_color: null,
    base_price: 10000, unit_price: 9000, discount_amount: 1000,
    line_total: 9000, catalog_snapshot: {}, design_status: status,
    low_resolution_warning: false, is_active: true,
    created_at: "2026-08-17T00:00:00Z", updated_at: "2026-08-17T00:00:00Z",
  };
}

function cart(items: OrderItem[], status = "ready"): ActiveCart {
  return { order: { id: "order", order_number: "VS-1", subtotal_amount: 9000,
    discount_amount: 1000, shipping_amount: 1990, total_amount: 10990,
    currency: "CLP", design_status: status, payment_status: "pending" }, items };
}

test("carrito defensivamente vacío", () => {
  assert.equal(cartItemCount(null), 0);
  assert.equal(canContinueCart(cart([])), false);
});
test("contador usa items activos y no quantity", () => {
  assert.equal(cartItemCount(cart([item("1"), { ...item("2"), quantity: 4 }])), 2);
  assert.equal(activeCartItems(cart([{ ...item("1"), is_active: false }])).length, 0);
});
test("carrito listo requiere todos los diseños ready", () => {
  assert.equal(canContinueCart(cart([item("1")])), true);
  assert.equal(canContinueCart(cart([item("1"), item("2", "pending")], "pending")), false);
});
test("pago legacy queda bloqueado únicamente con más de un item", () => {
  assert.equal(isMultiItemPaymentBlocked(cart([item("1")])), false);
  assert.equal(isMultiItemPaymentBlocked(cart([item("1"), item("2")])), true);
});
test("segundo producto conserva orderId y usa add_item", () => {
  const active = cart([item("1")]);
  assert.equal(cartWriteMode(null), "create_order");
  assert.equal(cartWriteMode(active), "add_item");
  assert.equal(active.order.id, "order");
});
