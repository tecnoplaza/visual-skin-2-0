import assert from "node:assert/strict";
import test from "node:test";
import { assertCheckoutEconomy, buildMercadoPagoLines, canonicalizeCheckoutCart, serializeCanonicalCheckoutCart } from "./checkout-cart.ts";

const item = (overrides: Partial<Parameters<typeof canonicalizeCheckoutCart>[0]["items"][number]> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001", position: 0, pack_type: "carcasa", quantity: 1,
  pack_id: null, unit_price: 8990, discount_amount: 0, line_total: 8990, phone_model_id: null,
  brand_id: null, brand: null, phone_model: null,
  garment_id: null, garment_size: null, garment_color: null, secondary_garment_id: null,
  secondary_garment_size: null, secondary_garment_color: null, ...overrides,
});

test("one case plus shipping sums exactly", () => {
  const cart = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [item()], subtotal_amount: 8990, shipping_amount: 3990, total_amount: 12980 });
  const lines = buildMercadoPagoLines(cart);
  assert.deepEqual(lines.map((line) => line.unit_price), [8990, 3990]);
  assert.doesNotThrow(() => assertCheckoutEconomy(cart, lines));
});

test("multiple items are distinct lines and sorted deterministically", () => {
  const second = item({ id: "00000000-0000-4000-8000-000000000002", position: 1, pack_type: "carcasa+polera", unit_price: 21990, line_total: 21990 });
  const cart = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [second, item()], subtotal_amount: 30980, shipping_amount: 3990, total_amount: 34970 });
  assert.deepEqual(buildMercadoPagoLines(cart).map((line) => line.id), [item().id, second.id, "shipping"]);
  assert.doesNotThrow(() => assertCheckoutEconomy(cart, buildMercadoPagoLines(cart)));
});

test("effective unit price is not discounted twice", () => {
  const discounted = item({ unit_price: 24990, discount_amount: 5000, line_total: 24990 });
  const cart = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [discounted], subtotal_amount: 24990, shipping_amount: 0, total_amount: 24990 });
  assert.equal(buildMercadoPagoLines(cart)[0].unit_price, 24990);
  assert.doesNotThrow(() => assertCheckoutEconomy(cart, buildMercadoPagoLines(cart)));
});

test("quantity two uses effective unit price twice", () => {
  const doubled = item({ quantity: 2, discount_amount: 2000, line_total: 17980 });
  const cart = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [doubled], subtotal_amount: 17980, shipping_amount: 0, total_amount: 17980 });
  assert.equal(buildMercadoPagoLines(cart)[0].quantity, 2);
  assert.doesNotThrow(() => assertCheckoutEconomy(cart, buildMercadoPagoLines(cart)));
});

test("canonical serialization changes for an economic or structural mutation", () => {
  const base = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [item()], subtotal_amount: 8990, shipping_amount: 0, total_amount: 8990 });
  const changed = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [item({ phone_model_id: "m2" })], subtotal_amount: 8990, shipping_amount: 0, total_amount: 8990 });
  assert.notEqual(serializeCanonicalCheckoutCart(base), serializeCanonicalCheckoutCart(changed));
});

test("rejects totals that would charge a stale amount", () => {
  const cart = canonicalizeCheckoutCart({ order_id: "o", currency: "CLP", items: [item()], subtotal_amount: 8990, shipping_amount: 0, total_amount: 7990 });
  assert.throws(() => assertCheckoutEconomy(cart, buildMercadoPagoLines(cart)), /checkout_total_mismatch/);
});
