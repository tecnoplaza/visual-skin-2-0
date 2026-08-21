import assert from "node:assert/strict";
import test from "node:test";
import { groupPhoneBrands, normalizePhoneBrandName, phoneBrandGroupForId } from "./phone-brand-groups.ts";

test("agrupa marcas por nombre con trim y comparación case-insensitive", () => {
  const groups = groupPhoneBrands([
    { id: "samsung-a", name: " Samsung " },
    { id: "samsung-b", name: "sAmSuNg" },
    { id: "apple", name: "Apple" },
  ]);

  assert.deepEqual(groups, [
    { key: "apple", name: "Apple", brandIds: ["apple"] },
    { key: "samsung", name: "Samsung", brandIds: ["samsung-a", "samsung-b"] },
  ]);
  assert.equal(normalizePhoneBrandName("  SAMSUNG  "), "samsung");
});

test("mantiene marcas únicas y orden alfabético sin hardcode comercial", () => {
  assert.deepEqual(groupPhoneBrands([
    { id: "v", name: "Vivo" },
    { id: "l", name: "LG" },
    { id: "a", name: "Apple" },
  ]).map((group) => group.name), ["Apple", "LG", "Vivo"]);
});

test("un brand_id real duplicado resuelve al mismo grupo visual", () => {
  const groups = groupPhoneBrands([
    { id: "a", name: "Samsung" },
    { id: "b", name: " samsung " },
    { id: "other", name: "Sony" },
  ]);

  assert.equal(phoneBrandGroupForId(groups, "a")?.key, "samsung");
  assert.equal(phoneBrandGroupForId(groups, "b")?.key, "samsung");
  assert.equal(phoneBrandGroupForId(groups, "other")?.key, "sony");
  assert.equal(phoneBrandGroupForId(groups, "missing"), undefined);
});
