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

test("personalizador agrega primer y siguientes productos sin modal informativo", () => {
  assert.doesNotMatch(customizer, /Completarás los datos de envío cuando termines/);
  assert.match(customizer, /void onSubmit\(\)\.catch/);
  assert.match(customizer, /orderId = activeCart\.order\.id/);
  assert.match(customizer, /navigate\(\{ to: "\/carrito"/);
});

test("botones agregar conservan precio dinámico y muestran spinner durante loading", () => {
  const buttons = customizer.match(/Agregar al carrito · \$\{price\.toLocaleString\("es-CL"\)\}[\s\S]*?showCheckout && <Loader2 className="h-4 w-4 animate-spin" \/>/g) ?? [];
  assert.equal(buttons.length, 2);
  assert.match(customizer, /disabled=\{!completeReady \|\| showCheckout\}/);
  assert.match(customizer, /disabled=\{showCheckout \|\| !caseDesign/);
  assert.match(customizer, /if \(!showCheckout\) setShowCheckout\(true\)/);
});

test("error libera loading y éxito lo mantiene hasta navegar al carrito", () => {
  const submitter = customizer.slice(customizer.indexOf("function CheckoutDialog"));
  assert.match(submitter, /\.catch\(\(error\) => \{[\s\S]*?onClose\(\)/);
  const successFlow = customizer.slice(customizer.indexOf("onSubmit={async () =>"), customizer.indexOf("function CheckoutDialog"));
  assert.match(successFlow, /navigate\(\{ to: "\/carrito"/);
  assert.doesNotMatch(successFlow, /setShowCheckout\(false\)/);
});

test("aceptación legal y Checkout Pro ocurren en un único click ordenado", () => {
  const route = orderRoute.slice(
    orderRoute.indexOf("const handleMercadoPagoCheckout"),
    orderRoute.indexOf("useEffect(() =>", orderRoute.indexOf("const handleMercadoPagoCheckout")),
  );
  const acceptanceRoute = orderRoute.slice(
    orderRoute.indexOf("const handleLegalCheckedChange"),
    orderRoute.indexOf("const handleShopifyCheckout"),
  );
  assert.match(acceptanceRoute, /await acceptOrderLegalDocuments/);
  assert.match(acceptanceRoute, /if \(!acceptance\.accepted\)[\s\S]*?return;/);
  assert.match(route, /submitLockRef\.current = true/);
  assert.match(acceptanceRoute, /legalSubmitLockRef\.current = true/);
  assert.match(route, /if \(!legalConfirmedThisVisit \|\| !order\.legal_accepted_at\)/);
  assert.match(route, /await createMercadoPagoCheckoutPro/);
  assert.doesNotMatch(route, /acceptOrderLegalDocuments/);
  assert.doesNotMatch(orderRoute, /Registrando y abriendo Mercado Pago/);
});

test("aceptación previa reintenta Checkout Pro sin exigir nuevamente checkbox", () => {
  const acceptanceRoute = orderRoute.slice(
    orderRoute.indexOf("const handleLegalCheckedChange"),
    orderRoute.indexOf("const handleShopifyCheckout"),
  );
  assert.match(acceptanceRoute, /if \(order\.legal_accepted_at\) \{[\s\S]*?setLegalConfirmedThisVisit\(true\);[\s\S]*?return;/);
  assert.match(orderRoute, /legalAccepted &&\s*legalConfirmedThisVisit/);
  assert.match(orderRoute, /Continuar al pago con Mercado Pago/);
});

test("pedido muestra cabecera UTF-8 y nunca expone fulfillment new", () => {
  assert.match(orderRoute, /Pedido · \{order\.order_number\}/);
  assert.doesNotMatch(orderRoute, /Pedido Â/);
  assert.doesNotMatch(orderRoute, /Producción:\s*new/);
});

test("pending muestra checkbox pero oculta pago hasta confirmación; approved oculta ambos", () => {
  assert.match(orderRoute, /const showLegalPrompt =[\s\S]*?!isApproved/);
  assert.match(orderRoute, /type="checkbox"/);
  assert.match(orderRoute, /const canRetry =[\s\S]*?legalConfirmedThisVisit/);
  assert.match(orderRoute, /\{canRetry && !order\.hasActiveAttempt/);
});
