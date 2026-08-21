import assert from "node:assert/strict";
import test from "node:test";
import { genericOrderNotFoundHtml, shouldReturnGenericOrder404 } from "./order-page-http.ts";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

test("pedido sin acceso o con identificador inválido obtiene 404 genérico", () => {
  assert.equal(shouldReturnGenericOrder404(new URL("https://www.visualskin.cl/pedido/no-existe"), null), true);
  assert.equal(shouldReturnGenericOrder404(new URL(`https://www.visualskin.cl/pedido/${uuid}`), null), true);
  assert.equal(shouldReturnGenericOrder404(new URL(`https://www.visualskin.cl/pedido/${uuid}?token=corto`), null), true);
});

test("preflight permite credenciales plausibles sin validar ni enumerar el pedido", () => {
  assert.equal(shouldReturnGenericOrder404(new URL(`https://www.visualskin.cl/pedido/${uuid}?token=${"a".repeat(20)}`), null), false);
  assert.equal(shouldReturnGenericOrder404(new URL(`https://www.visualskin.cl/pedido/${uuid}`), "x=1; vs_order_sid=opaque; y=2"), false);
});

test("respuesta genérica no contiene tokens y mantiene noindex", () => {
  const html = genericOrderNotFoundHtml();
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /token|uuid|session/i);
});
