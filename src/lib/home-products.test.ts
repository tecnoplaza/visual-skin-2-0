import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PromoPack } from "./cms.ts";
import { PRODUCT_SLUGS, productPathForPack, uniqueActiveProductPacks } from "./product-seo.ts";

const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");

function pack(id: string, pack_type: PromoPack["pack_type"], overrides: Partial<PromoPack> = {}): PromoPack {
  return {
    id,
    pack_type,
    name: id,
    description: `Descripción ${id}`,
    price: 10000,
    sale_price: null,
    image_url: "https://cdn.example.com/pack.png",
    gradient: "",
    tag: "Envío Gratis",
    includes: [],
    features: [],
    button_label: "Personalizar",
    button_url: "/personalizador",
    is_active: true,
    sort_order: 0,
    ...overrides,
  };
}

test("Home puede representar los cuatro productos canónicos sin límite de tres", () => {
  const packs = (Object.keys(PRODUCT_SLUGS) as PromoPack["pack_type"][]).map((type, index) => pack(String(index), type, { sort_order: index }));
  assert.equal(uniqueActiveProductPacks(packs).length, 4);
  assert.doesNotMatch(home, /heroPacks\.slice\(0,\s*3\)|packs\.slice\(0,\s*3\)/);
  assert.match(home, /heroPacks\.map/);
});

test("Home reutiliza el mapping SEO sin UUID ni queries", () => {
  const expected = {
    carcasa: "/productos/carcasa-personalizada",
    "carcasa+polera": "/productos/pack-carcasa-polera-personalizada",
    "carcasa+poleron": "/productos/pack-carcasa-poleron-personalizado",
    "carcasa+polera+poleron": "/productos/pack-completo-personalizado",
  } as const;
  for (const [type, pathname] of Object.entries(expected)) {
    const item = pack("00000000-0000-4000-8000-000000000001", type as PromoPack["pack_type"]);
    assert.equal(productPathForPack(item), pathname);
    assert.doesNotMatch(pathname, /\?|00000000/);
  }
  assert.match(home, /productPathForPack\(pack\)/);
  assert.doesNotMatch(home, /pack-carcasa-polera-personalizada|pack-carcasa-poleron-personalizado|pack-completo-personalizado/);
});

test("selección Home excluye inactivos, desconocidos y tipos activos ambiguos", () => {
  const valid = pack("valid", "carcasa");
  const duplicateA = pack("a", "carcasa+polera");
  const duplicateB = pack("b", "carcasa+polera");
  const selected = uniqueActiveProductPacks([
    valid,
    duplicateA,
    duplicateB,
    pack("inactive", "carcasa+poleron", { is_active: false }),
    pack("unknown", "future" as PromoPack["pack_type"]),
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["valid"]);
});

test("card Home usa datos reales, imagen completa, tag opcional, precio canónico y Link accesible", () => {
  assert.match(home, /publicProductImage\(pack\.image_url\)/);
  assert.match(home, /alt=\{pack\.name\}/);
  assert.match(home, /object-contain/);
  assert.match(home, /aspect-\[4\/5\][^"`]*bg-black/);
  assert.doesNotMatch(home, /aspect-\[4\/5\][^\n]*pack\.gradient/);
  assert.match(home, /const tag = pack\.tag\?\.trim\(\)/);
  assert.match(home, /\{tag && <span[^>]*>\{tag\}<\/span>\}/);
  assert.doesNotMatch(home, /tag \|\| ["']Pack["']|Pack personalizable/i);
  assert.match(home, /canonicalPromoPackPricing\(pack\)/);
  assert.match(home, /<h2[^>]*>\{pack\.name\}<\/h2>/);
  assert.match(home, /Ver producto/);
  assert.match(home, /focus-visible:ring-2/);
  assert.match(home, /grid-cols-1[\s\S]*sm:grid-cols-2[\s\S]*xl:grid-cols-4/);
});

test("el bloque inferior conserva su destino transaccional existente", () => {
  assert.match(home, /href=\{p\.button_url\}/);
  assert.match(home, /button_url: `\/personalizador\?pack=/);
});
