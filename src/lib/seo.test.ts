import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_ORIGIN,
  buildSeoHead,
  canonicalUrl,
  normalizeSeoPathname,
  renderSitemap,
  serializeJsonLd,
  websiteJsonLd,
} from "./seo.ts";

test("canonical siempre usa el origen de producción y elimina query/hash", () => {
  assert.equal(CANONICAL_ORIGIN, "https://www.visualskin.cl");
  assert.equal(canonicalUrl("https://preview.vercel.app/catalogo?token=secret&utm_source=x#x"), "https://www.visualskin.cl/catalogo");
  assert.equal(canonicalUrl("/personalizador?pack=carcasa&editItem=secret"), "https://www.visualskin.cl/personalizador");
  assert.equal(canonicalUrl("/"), "https://www.visualskin.cl/");
  assert.equal(normalizeSeoPathname("//catalogo///"), "/catalogo");
});

test("sitemap solo emite URLs limpias del host canónico", () => {
  const xml = renderSitemap([
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/personalizador?pack=carcasa", changefreq: "monthly", priority: "0.7" },
  ]);
  assert.match(xml, /https:\/\/www\.visualskin\.cl\/personalizador/);
  const locations = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), (match) => match[1]);
  assert.equal(locations.length, 2);
  for (const location of locations) assert.doesNotMatch(location, /\?|vercel|token|utm_/i);
});

test("metadata no filtra tokens y contiene canonical/OG limpios", () => {
  const head = buildSeoHead({ pathname: "/pedido/id?token=secret", title: "T", description: "D" });
  const serialized = JSON.stringify(head);
  assert.doesNotMatch(serialized, /secret|token|vercel/i);
  assert.match(serialized, /https:\/\/www\.visualskin\.cl\/pedido\/id/);
});

test("WebSite usa solo datos canónicos y JSON-LD neutraliza cierres de script", () => {
  assert.deepEqual(websiteJsonLd(), {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "VISUALSKIN",
    url: "https://www.visualskin.cl/",
  });
  const json = serializeJsonLd({ value: "</script><script>alert(1)</script>&" });
  assert.doesNotMatch(json, /<\/script>|<script>|&/);
  assert.match(json, /\\u003c/);
});
