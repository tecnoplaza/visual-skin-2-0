import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PromoPack } from "./cms.ts";
import { buildSeoHead } from "./seo.ts";
import {
  PRODUCT_SLUGS,
  canonicalPromoPackPricing,
  effectivePromoPackPrice,
  packTypeForProductSlug,
  productJsonLd,
  productPathForPack,
  productSitemapPaths,
  productSlugForPackType,
  publicProductImage,
  resolveActiveProduct,
  sitemapPathsWithProducts,
} from "./product-seo.ts";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

function pack(overrides: Partial<PromoPack> = {}): PromoPack {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Carcasa + Polera",
    description: "Pack personalizable real",
    price: 21990,
    sale_price: null,
    image_url: "https://cdn.example.com/pack.jpg",
    gradient: "",
    tag: "",
    pack_type: "carcasa+polera",
    includes: ["Carcasa", "Polera"],
    features: [],
    button_label: "Personalizar",
    button_url: "/personalizador",
    is_active: true,
    sort_order: 1,
    ...overrides,
  };
}

test("mapping slug y pack_type es explícito, reversible y único", () => {
  const entries = Object.entries(PRODUCT_SLUGS);
  assert.equal(new Set(entries.map(([, slug]) => slug)).size, entries.length);
  for (const [packType, slug] of entries) {
    assert.equal(productSlugForPackType(packType), slug);
    assert.equal(packTypeForProductSlug(slug), packType);
  }
  assert.equal(productSlugForPackType("pack-futuro"), null);
  assert.equal(packTypeForProductSlug("slug-inventado"), null);
});

test("resolución pública exige slug reconocido, pack activo y una sola fila", () => {
  const active = pack();
  const slug = PRODUCT_SLUGS[active.pack_type];
  assert.equal(resolveActiveProduct(slug, [active]), active);
  assert.equal(resolveActiveProduct("inexistente", [active]), null);
  assert.equal(resolveActiveProduct(slug, [pack({ is_active: false })]), null);
  assert.equal(resolveActiveProduct(slug, [active, pack({ id: "duplicate" })]), null);
});

test("metadata de producto canoniza sin query y usa imagen pública", () => {
  const item = pack();
  for (const query of ["utm_source=test", "fbclid=abc", "gclid=abc", "arbitrary=secret"]) {
    const pathname = `${productPathForPack(item)}?${query}`;
    const head = buildSeoHead({ pathname, title: `${item.name} | VISUALSKIN`, description: item.description, type: "product", image: item.image_url! });
    assert.equal(head.links[0].href, "https://www.visualskin.cl/productos/pack-carcasa-polera-personalizada");
    assert.match(JSON.stringify(head), /og:image/);
    assert.doesNotMatch(JSON.stringify(head), /test|abc|secret|\?/);
  }
});

test("Product y Offer usan el precio efectivo CLP sin afirmaciones inventadas", () => {
  const item = pack({ price: 21990.4, sale_price: 18990.4 });
  const schema = productJsonLd(item, productPathForPack(item)!);
  assert.equal(effectivePromoPackPrice(item), 18990);
  assert.equal(schema.offers?.price, 18990);
  assert.equal(schema.offers?.priceCurrency, "CLP");
  assert.equal(schema.offers?.url, schema.url);
  assert.equal(schema.name, item.name);
  assert.equal(schema.description, item.description);
  assert.equal(schema.image, item.image_url);
  const json = JSON.stringify(schema);
  assert.doesNotMatch(json, /availability|InStock|OutOfStock|aggregateRating|review|reviewCount|ratingValue|sku|gtin|mpn|itemCondition|brand/i);
});

test("precio SEO replica validación canónica del backend y omite Offer inválido", () => {
  assert.deepEqual(canonicalPromoPackPricing(pack({ price: 21990.4, sale_price: 18990.4 })), {
    basePrice: 21990,
    effectivePrice: 18990,
    hasSale: true,
  });
  for (const invalid of [
    pack({ price: 0 }),
    pack({ price: -1 }),
    pack({ price: Number.NaN }),
    pack({ price: Number.POSITIVE_INFINITY }),
    pack({ price: 100, sale_price: 101 }),
    pack({ price: Number.MAX_SAFE_INTEGER + 1 }),
  ]) {
    assert.equal(canonicalPromoPackPricing(invalid), null);
    assert.equal(effectivePromoPackPrice(invalid), null);
    assert.equal("offers" in productJsonLd(invalid, productPathForPack(invalid)!), false);
  }
});

test("imagen Product acepta media comercial pública y rechaza URLs privadas o esquemas inseguros", () => {
  assert.equal(publicProductImage("https://cdn.example.com/pack.jpg"), "https://cdn.example.com/pack.jpg");
  const cmsImage = "https://project-prod.lovable.cloud/storage/v1/object/sign/cms-media/packs/pack.jfif?token=public-cms-delivery";
  assert.equal(publicProductImage(cmsImage), cmsImage);
  const item = pack({ image_url: cmsImage, tag: "Envío Gratis" });
  assert.equal(productJsonLd(item, productPathForPack(item)!).image, cmsImage);
  const head = buildSeoHead({ pathname: productPathForPack(item)!, title: item.name, description: item.description, type: "product", image: publicProductImage(item.image_url) });
  assert.equal(head.meta.find((meta) => meta.property === "og:image")?.content, cmsImage);
  for (const image of [
    "/pack.jpg",
    "data:image/png;base64,abc",
    "javascript:alert(1)",
    "blob:https://visualskin.cl/id",
    "https://project.supabase.co/storage/v1/object/sign/private/file.png?token=secret",
    "https://project-prod.lovable.cloud/storage/v1/object/sign/design-assets/private.png?token=secret",
    "https://evil.example/storage/v1/object/sign/cms-media/packs/pack.png?token=secret",
    "https://cdn.example.com/file.png?signature=secret",
  ]) assert.equal(publicProductImage(image), undefined);
});

test("sitemap incluye activos reconocidos y excluye inactivos, desconocidos y ambiguos", () => {
  const casePack = pack({ id: "case", pack_type: "carcasa" });
  const shirtPack = pack({ id: "shirt" });
  const paths = productSitemapPaths([casePack, shirtPack, pack({ id: "inactive", pack_type: "carcasa+poleron", is_active: false }), pack({ id: "unknown", pack_type: "future" as any })]);
  assert.deepEqual(paths.map((entry) => entry.path), [
    "/productos/carcasa-personalizada",
    "/productos/pack-carcasa-polera-personalizada",
  ]);
  assert.deepEqual(productSitemapPaths([shirtPack, pack({ id: "duplicate" })]), []);
});

test("si Supabase falla, el sitemap base permanece intacto", () => {
  const base = [{ path: "/", changefreq: "weekly", priority: "1.0" }, { path: "/catalogo", changefreq: "weekly", priority: "0.9" }];
  assert.deepEqual(sitemapPathsWithProducts(base, undefined), base);
  assert.notEqual(sitemapPathsWithProducts(base, undefined), base);
  const route = read("../routes/sitemap[.]xml.ts");
  assert.match(route, /const paths = \[\.\.\.BASE_PATHS\]/);
  assert.match(route, /catch \{[\s\S]*base sitemap still returned/);
  assert.match(route, /const xml = renderSitemap\(paths\)/);
});

test("og:type distingue productos de páginas website", () => {
  const product = buildSeoHead({ pathname: "/productos/carcasa-personalizada", title: "Producto", description: "Producto", type: "product" });
  const website = buildSeoHead({ pathname: "/catalogo", title: "Catálogo", description: "Catálogo" });
  assert.equal(product.meta.find((meta) => meta.property === "og:type")?.content, "product");
  assert.equal(website.meta.find((meta) => meta.property === "og:type")?.content, "website");
});

test("ruta SSR conserva 404 real, breadcrumbs, JSON-LD y CTA al personalizador", () => {
  const route = read("../routes/productos.$slug.tsx");
  assert.match(route, /createFileRoute\("\/productos\/\$slug"\)/);
  assert.match(route, /throw notFound\(\)/);
  assert.match(route, /packTypeForProductSlug\(params\.slug\)/);
  assert.doesNotMatch(route, /ensureQueryData[\s\S]*?\.catch\(/);
  assert.match(route, /<h1[^>]*>\{pack\.name\}<\/h1>/);
  assert.match(route, /breadcrumbJsonLd\(breadcrumbs\)/);
  assert.match(route, /productJsonLd\(pack, pathname\)/);
  assert.match(route, /to="\/personalizador"/);
  assert.match(route, /pack: pack\.pack_type, id: pack\.id/);
  const customizer = read("../routes/personalizador.tsx");
  assert.match(customizer, /type Search = \{ pack\?: PackId; id\?: string/);
  assert.match(route, /pricing &&/);
  assert.match(route, /<img src=\{image\} alt=\{pack\.name\}/);
  assert.match(route, /h-full w-full rounded-3xl object-contain object-center/);
  assert.match(route, /aspect-\[4\/5\][^"`]*bg-black/);
  assert.doesNotMatch(route, /object-cover|bg-gradient-to-br \$\{pack\.gradient/);
  assert.match(route, /const tag = pack\.tag\?\.trim\(\)/);
  assert.match(route, /\{tag && <p[^>]*>\{tag\}<\/p>\}/);
  assert.doesNotMatch(route, /Pack personalizable/i);
  assert.doesNotMatch(route, /preview_url|original|design_assets|final_designs/);
});

test("catálogo y landings enlazan producto sin reemplazar Personalizar", () => {
  for (const file of ["../routes/catalogo.tsx", "../components/seo/CommercialLanding.tsx"]) {
    const source = read(file);
    assert.match(source, /productPathForPack/);
    assert.match(source, /to="\/personalizador"/);
  }
  const catalog = read("../routes/catalogo.tsx");
  const createPack = read("../routes/crear-mi-pack.tsx");
  const landing = read("../components/seo/CommercialLanding.tsx");
  assert.match(catalog, /filtered\.map[\s\S]*?<div key=\{p\.id\}/);
  assert.match(createPack, /function PackCard[\s\S]*?return \([\s\S]*?<div className=/);
  assert.match(landing, /function CommercialPackCard[\s\S]*?return \([\s\S]*?<article/);
  assert.match(landing, /url: canonicalUrl\(productPathForPack\(pack\)/);
});
