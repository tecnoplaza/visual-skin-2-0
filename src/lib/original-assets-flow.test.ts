import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
const customizer = readFileSync(new URL("../routes/personalizador.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../routes/admin.orders.$id.tsx", import.meta.url), "utf8");

test("original y preview usan paths distintos y design_assets recibe el original", () => {
  assert.match(customizer, /casePath = await uploadOrderItemDesign\([^\n]+caseDesign\.originalFile/);
  assert.match(customizer, /casePreviewPath = await uploadOrderItemDesign\([^\n]+caseBlob/);
  assert.match(orders, /p_case_path: data\.casePath/);
  assert.match(orders, /case_preview_url: data\.casePreviewPath/);
});

test("carcasa, polera y polerón conservan asociaciones independientes por item", () => {
  for (const kind of ["case", "garment", "secondary_garment"]) {
    assert.match(customizer, new RegExp(`orderItemId, "${kind}"`));
  }
  assert.match(orders, /eq\("order_item_id", data\.orderItemId\)/);
});

test("Admin firma por assetId resuelto en servidor, no acepta storage path", () => {
  assert.match(orders, /assetId: z\.string\(\)\.uuid\(\)/);
  assert.match(orders, /eq\("id", assetId\)\.eq\("order_id", orderId\)/);
  assert.match(orders, /requireAdmin\(context\)/);
  assert.doesNotMatch(admin, /adminGetOrderDesignSignedUrl\(\{ data: \{ orderId: id, path/);
});

test("pedidos históricos ambiguos no muestran preview como sustituto", () => {
  assert.match(orders, /asset_role === "customer_original"/);
});

test("preview del carrito se obtiene de final_designs, no design_assets", () => {
  const activeCart = orders.slice(orders.indexOf("export const getActiveCart"), orders.indexOf("export const updateOrderCustomerShipping"));
  assert.match(activeCart, /from\("final_designs"\)/);
  assert.doesNotMatch(activeCart, /from\("design_assets"\)/);
});
