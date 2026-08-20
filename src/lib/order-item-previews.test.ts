import assert from "node:assert/strict";
import test from "node:test";
import { groupSignedOrderItemPreviews, previewSlotLabel } from "./order-item-previews.ts";

test("agrupa por item sin cruces y admite múltiples slots", () => {
  const grouped = groupSignedOrderItemPreviews([
    { order_item_id: "one", slot: "case", url: "signed-one" },
    { order_item_id: "two", slot: "case", url: "signed-two" },
    { order_item_id: "one", slot: "garment", url: "signed-shirt" },
  ]);
  assert.deepEqual(grouped.get("one"), [{ slot: "case", url: "signed-one" }, { slot: "garment", url: "signed-shirt" }]);
  assert.deepEqual(grouped.get("two"), [{ slot: "case", url: "signed-two" }]);
});
test("slots futuros reciben etiqueta genérica y filas vacías se descartan", () => {
  assert.equal(previewSlotLabel("front_panel"), "Front panel");
  assert.equal(groupSignedOrderItemPreviews([{ order_item_id: "one", slot: "case", url: "" }]).size, 0);
});
