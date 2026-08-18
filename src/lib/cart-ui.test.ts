import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cartRoute = readFileSync(new URL("../routes/carrito.tsx", import.meta.url), "utf8");
const customizer = readFileSync(new URL("../routes/personalizador.tsx", import.meta.url), "utf8");
const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
const orderRoute = readFileSync(new URL("../routes/pedido.$id.tsx", import.meta.url), "utf8");

test("eliminar refresca la query canónica del carrito", () => {
  assert.match(cartRoute, /removeOrderItem/);
  assert.match(cartRoute, /invalidateQueries\(\{ queryKey: CART_QUERY_KEY \}\)/);
});

test("agregar un segundo producto usa addOrderItem y conserva el orderId activo", () => {
  assert.match(customizer, /orderId = activeCart\.order\.id/);
  assert.match(customizer, /await addOrderItem/);
  assert.match(customizer, /cartWriteMode\(activeCart\) === "add_item"/);
});

test("alta adicional no crea un segundo custom_order", () => {
  const addBranches = customizer.match(/if \(cartWriteMode\(activeCart\) === "add_item" && activeCart\)[\s\S]*?\} else \{/g) ?? [];
  assert.equal(addBranches.length, 2);
  for (const branch of addBranches) assert.doesNotMatch(branch, /createSecureOrder/);
});

test("Checkout Pro usa el snapshot canónico y admite carritos multi-item", () => {
  const start = orders.indexOf("export const createMercadoPagoCheckoutPro");
  const end = orders.indexOf("export const reconcileMercadoPagoCheckoutProReturn", start);
  const source = orders.slice(start, end);
  assert.match(source, /claim_checkout_pro_cart_v1/);
  assert.match(source, /items: claimed\.lines/);
  assert.doesNotMatch(source, /activeItemCount/);
});

test("previews del carrito quedan aisladas por order_item_id y kind", () => {
  const start = orders.indexOf("export const getActiveCart");
  const end = orders.indexOf("export const updateOrderCustomerShipping", start);
  const source = orders.slice(start, end);
  assert.match(source, /\.in\("order_item_id", itemIds\)/);
  assert.match(source, /`\$\{asset\.order_item_id\}:\$\{asset\.kind\}`/);
  assert.match(source, /createSignedUrl\(asset\.file_path, 10 \* 60\)/);
  assert.doesNotMatch(source, /\.eq\("kind", "case"\)/);
});

test("resumen y pago representa todos los order_items activos", () => {
  assert.match(orderRoute, /cartItems\.map\(\(item, index\) => <OrderItemSummaryCard/);
  assert.match(orderRoute, /const previews = cartItemPreviewSlots\(item\)/);
  assert.match(orderRoute, /activeCartQuery\.refetch\(\)/);
  assert.doesNotMatch(orderRoute, /src=\{order\.case_design_url\}/);
});
