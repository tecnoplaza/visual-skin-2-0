import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { PromoPack } from "./cms.ts";
import { COMMERCIAL_LANDINGS, packsForLanding, type CommercialLandingSlug } from "./commercial-landings.ts";
import { buildSeoHead } from "./seo.ts";

const slugs = Object.keys(COMMERCIAL_LANDINGS) as CommercialLandingSlug[];
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

function pack(id: string, pack_type: PromoPack["pack_type"], is_active = true): PromoPack {
  return {
    id,
    pack_type,
    is_active,
    name: id,
    description: `Descripción ${id}`,
    price: 1,
    sale_price: null,
    image_url: null,
    gradient: "",
    tag: "",
    includes: [],
    features: [],
    button_label: "",
    button_url: "",
    sort_order: 0,
  };
}

test("existen las cuatro rutas SSR con metadata canónica de Fase 1", () => {
  for (const slug of slugs) {
    const relative = `../routes/${slug}.tsx`;
    assert.equal(existsSync(new URL(relative, import.meta.url)), true);
    const route = read(relative);
    assert.match(route, /promoPacksQueryOptions\(true\)/);
    assert.match(route, /loader:/);
    assert.match(route, new RegExp(`pathname: \"/${slug}\"`));
    const config = COMMERCIAL_LANDINGS[slug];
    const head = buildSeoHead({ pathname: `/${slug}?token=secret`, title: config.title, description: config.description });
    assert.equal(head.links[0].href, `https://www.visualskin.cl/${slug}`);
    assert.doesNotMatch(JSON.stringify(head), /secret|\?/);
  }
});

test("cada landing tiene un H1 y contenido comercial propio", () => {
  assert.equal(COMMERCIAL_LANDINGS["carcasas-personalizadas"].heading, "Carcasas personalizadas");
  assert.equal(COMMERCIAL_LANDINGS["poleras-personalizadas"].heading, "Poleras personalizadas");
  assert.equal(COMMERCIAL_LANDINGS["polerones-personalizados"].heading, "Polerones personalizados");
  assert.equal(COMMERCIAL_LANDINGS["packs-personalizados"].heading, "Packs personalizados");
  assert.equal(new Set(slugs.map((slug) => COMMERCIAL_LANDINGS[slug].introduction)).size, 4);
  const component = read("../components/seo/CommercialLanding.tsx");
  assert.match(component, /<h1[^>]*>\{config\.heading\}<\/h1>/);
  assert.match(component, /initialPacks/);
  assert.match(component, /pack\.name/);
  assert.match(component, /pack\.description/);
  assert.match(component, /sale_price \?\? pack\.price/);
});

test("los filtros usan exclusivamente tipos reales y no inventan prendas individuales", () => {
  const packs = [
    pack("case", "carcasa"),
    pack("shirt", "carcasa+polera"),
    pack("hoodie", "carcasa+poleron"),
    pack("complete", "carcasa+polera+poleron"),
    pack("inactive", "carcasa+polera", false),
  ];
  assert.deepEqual(packsForLanding("poleras-personalizadas", packs).map((item) => item.id), ["shirt", "complete"]);
  assert.deepEqual(packsForLanding("polerones-personalizados", packs).map((item) => item.id), ["hoodie", "complete"]);
  assert.deepEqual(packsForLanding("packs-personalizados", packs).map((item) => item.id), ["case", "shirt", "hoodie", "complete"]);
  assert.match(COMMERCIAL_LANDINGS["poleras-personalizadas"].introduction, /dentro de packs/);
  assert.match(COMMERCIAL_LANDINGS["polerones-personalizados"].introduction, /parte de packs/);
});

test("sitemap y Footer enlazan las cuatro páginas sin queries", () => {
  const sitemap = read("../routes/sitemap[.]xml.ts");
  const footer = read("../components/site/Footer.tsx");
  for (const slug of slugs) {
    assert.match(sitemap, new RegExp(`path: \"/${slug}\"`));
    assert.match(footer, new RegExp(`to=\"/${slug}\"`));
  }
  assert.doesNotMatch(sitemap, /personalizadas\?/);
});

test("FAQ visible y JSON-LD comparten la misma fuente sin schemas inventados", () => {
  const component = read("../components/seo/CommercialLanding.tsx");
  assert.match(component, /config\.faqs\.map\(\(faq\)/);
  assert.match(component, /\"@type\": \"FAQPage\"/);
  assert.match(component, /serializeJsonLd\(structuredData\)/);
  assert.match(component, /\"@type\": \"ItemList\"/);
  assert.doesNotMatch(component, /\"@type\": \"(?:Product|Offer|Review|AggregateRating)\"|availability|rating|stock|sku|gtin|mpn/i);
});
