import test from "node:test";
import assert from "node:assert/strict";
import { ORIGINAL_SIGNED_URL_TTL_SECONDS, originalFilename, sanitizeOriginalFilename } from "./original-assets.ts";

test("sanitiza filename y elimina traversal", () => {
  assert.equal(sanitizeOriginalFilename("../../foto cliente?.PNG"), "foto cliente-.PNG");
  assert.equal(sanitizeOriginalFilename("..\\..\\logo.jpg"), "logo.jpg");
});

test("conserva el nombre original y nunca deriva una preview si falta", () => {
  assert.equal(originalFilename({ original_filename: "diseño.png" }, "x/case-preview.png"), "diseño.png");
  assert.equal(originalFilename({}, null), "archivo-original");
});

test("la URL firmada de originales es temporal", () => {
  assert.equal(ORIGINAL_SIGNED_URL_TTL_SECONDS, 300);
  assert.ok(ORIGINAL_SIGNED_URL_TTL_SECONDS < 3600);
});
