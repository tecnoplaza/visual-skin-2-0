import assert from "node:assert/strict";
import test from "node:test";
import { productionDisplayLabel } from "./production-display.ts";

test("fulfillment aprobado se presenta con etiquetas amigables", () => {
  assert.equal(productionDisplayLabel("approved", "new"), "Pedido recibido");
  assert.equal(productionDisplayLabel("approved", "in_production"), "En producción");
  assert.equal(productionDisplayLabel("approved", "ready"), "Listo para despacho");
  assert.equal(productionDisplayLabel("approved", "shipped"), "Enviado");
  assert.equal(productionDisplayLabel("approved", "completed"), "Completado");
  assert.equal(productionDisplayLabel("approved", "cancelled"), "Producción cancelada");
  assert.notEqual(productionDisplayLabel("approved", "new"), "new");
});

test("un fulfillment desconocido no expone el valor interno", () => {
  assert.equal(productionDisplayLabel("approved", "internal_future_value"), "Pedido recibido");
});
