import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDesignStatus,
  aggregateOrderSubtotal,
  calculateItemLineTotal,
  classifyIdempotencyRequest,
  isOrderItemComplete,
  isOrderItemsMutationBlocked,
  orderItemsToShippingItems,
  sortOrderItems,
  type OrderItem,
} from "./order-items.ts";

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    order_id: "00000000-0000-4000-8000-000000000010",
    position: 0,
    quantity: 1,
    client_item_key: "client-key-1",
    request_fingerprint: "a".repeat(64),
    pack_id: null,
    pack_type: "carcasa",
    brand_id: null,
    brand: "Marca",
    phone_model_id: "00000000-0000-4000-8000-000000000020",
    phone_model: "Modelo",
    garment_id: null,
    garment_size: null,
    garment_color: null,
    secondary_garment_id: null,
    secondary_garment_size: null,
    secondary_garment_color: null,
    base_price: 12000,
    unit_price: 10000,
    discount_amount: 2000,
    line_total: 10000,
    catalog_snapshot: {},
    design_status: "ready",
    low_resolution_warning: false,
    is_active: true,
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

test("calcula un item y su descuento en CLP", () => {
  assert.equal(calculateItemLineTotal(item()), 10000);
});

test("quantity=2 multiplica precio efectivo y descuento unitario", () => {
  const doubled = item({ quantity: 2, discount_amount: 4000, line_total: 20000 });
  assert.equal(calculateItemLineTotal(doubled), 20000);
  assert.equal(aggregateOrderSubtotal([doubled]), 20000);
});

test("agrega subtotal de uno y dos items activos", () => {
  assert.equal(aggregateOrderSubtotal([item()]), 10000);
  assert.equal(aggregateOrderSubtotal([
    item(),
    item({ id: "2", unit_price: 12000, line_total: 12000, discount_amount: 0 }),
  ]), 22000);
});

test("dos carcasas se agregan antes de calcular un único shipping", () => {
  assert.deepEqual(orderItemsToShippingItems([
    item(), item({ id: "2" }),
  ]), [{ kind: "case", qty: 2 }]);
});

test("carcasa más pack produce una composición agregada para shipping", () => {
  assert.deepEqual(orderItemsToShippingItems([
    item(), item({ id: "2", pack_type: "carcasa+polera" }),
  ]), [
    { kind: "case", qty: 2 },
    { kind: "polera", qty: 1 },
  ]);
});

test("eliminar un item permite recalcular y ordenar los restantes", () => {
  const remaining = sortOrderItems([
    item({ id: "b", position: 2 }),
    item({ id: "a", position: 1 }),
  ].filter((candidate) => candidate.id !== "b"));
  assert.deepEqual(remaining.map((candidate) => candidate.id), ["a"]);
  assert.equal(aggregateOrderSubtotal(remaining), 10000);
});

test("clasifica replay y conflicto de idempotencia", () => {
  assert.equal(classifyIdempotencyRequest({
    existingKey: "same-key", existingFingerprint: "aaa",
    requestedKey: "same-key", requestedFingerprint: "aaa",
  }), "replay");
  assert.equal(classifyIdempotencyRequest({
    existingKey: "same-key", existingFingerprint: "aaa",
    requestedKey: "same-key", requestedFingerprint: "bbb",
  }), "conflict");
});

test("dos add conceptualmente concurrentes con la misma key convergen por idempotencia", () => {
  const first = classifyIdempotencyRequest({
    existingKey: null, existingFingerprint: null,
    requestedKey: "concurrent-key", requestedFingerprint: "same-payload",
  });
  const retryAfterUniqueWinner = classifyIdempotencyRequest({
    existingKey: "concurrent-key", existingFingerprint: "same-payload",
    requestedKey: "concurrent-key", requestedFingerprint: "same-payload",
  });
  assert.equal(first, "new");
  assert.equal(retryAfterUniqueWinner, "replay");
});

test("detecta pedido bloqueado", () => {
  assert.equal(isOrderItemsMutationBlocked({
    paymentStatus: "approved", designStatus: "ready", hasActivePaymentAttempt: false,
  }), true);
  assert.equal(isOrderItemsMutationBlocked({
    paymentStatus: "pending", designStatus: "ready", hasActivePaymentAttempt: true,
  }), true);
});

test("detecta item incompleto", () => {
  assert.equal(isOrderItemComplete(item({ design_status: "draft" })), false);
  assert.equal(isOrderItemComplete(item()), true);
});

test("agrega estados de diseño con precedencia segura", () => {
  assert.equal(aggregateDesignStatus([item(), item({ id: "2" })]), "ready");
  assert.equal(aggregateDesignStatus([item(), item({ id: "2", design_status: "uploading" })]), "uploading");
  assert.equal(aggregateDesignStatus([item(), item({ id: "2", design_status: "failed" })]), "failed");
});
