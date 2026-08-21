import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRIVATE_ROBOTS_DIRECTIVE } from "./seo.ts";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("robots declara sitemap canónico y no bloquea carrito/assets", () => {
  const robots = read("../../public/robots.txt");
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/pedido\//);
  assert.match(robots, /Sitemap: https:\/\/www\.visualskin\.cl\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/carrito/);
});

test("rutas privadas declaran noindex y pedidos usan X-Robots-Tag robusto", () => {
  for (const file of ["../routes/carrito.tsx", "../routes/pedido.$id.tsx"]) {
    assert.match(read(file), /noindex,nofollow/);
  }
  assert.equal(PRIVATE_ROBOTS_DIRECTIVE, "noindex, nofollow, noarchive");
  assert.match(read("./security-headers.ts"), /"X-Robots-Tag": PRIVATE_ROBOTS_DIRECTIVE/);
  const server = read("../server.ts");
  assert.match(server, /if \(adminScoped \|\| cartScoped\) return applyRobotsHeader\(normalized, PRIVATE_ROBOTS_DIRECTIVE\)|if \(adminScoped\) return applyAdminSecurityHeaders\(normalized\)/);
});

test("shell usa es-CL y sitemap no deriva el host del request", () => {
  assert.match(read("../routes/__root.tsx"), /<html lang="es-CL"/);
  const sitemap = read("../routes/sitemap[.]xml.ts");
  assert.doesNotMatch(sitemap, /request\.url|url\.host|url\.protocol/);
  assert.doesNotMatch(sitemap, /carrito|pedido|admin|\/api\//);
});

test("metadata privada no incorpora canonical, tokens ni JSON-LD", () => {
  const pedido = read("../routes/pedido.$id.tsx");
  const head = pedido.slice(pedido.indexOf("head:"), pedido.indexOf("function PedidoView"));
  assert.doesNotMatch(head, /canonical|og:url|application\/ld\+json|token/);
});
