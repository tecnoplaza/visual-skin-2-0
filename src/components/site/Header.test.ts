import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("./Header.tsx", import.meta.url), "utf8");

test("Header global usa el query canónico y oculta el carrito en Admin", () => {
  assert.match(header, /activeCartQueryOptions\(\)/);
  assert.match(header, /cartItemCount\(cart\)/);
  assert.match(header, /!isAdmin\s*&&\s*\(\s*<button/);
  assert.match(header, /pathname\.startsWith\("\/admin\/"\)/);
});

test("mini carrito muestra previews canónicas y operaciones seguras", () => {
  assert.match(header, /cartItemPreviewSlots\(item\)/);
  assert.match(header, /removeOrderItem/);
  assert.match(header, /getOrderCsrfToken/);
  assert.match(header, /aria-modal="true"/);
  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /to="\/carrito"/);
});

test("mini carrito mantiene una sola zona scrollable y acciones responsive", () => {
  assert.match(header, /createPortal\(/);
  assert.match(header, /h-dvh w-full max-w-\[460px\] flex-col overflow-hidden/);
  assert.match(header, /min-h-0 flex-1 overflow-x-hidden overflow-y-auto/);
  assert.match(header, /shrink-0 border-t/);
  assert.match(header, /flex flex-wrap gap-2/);
  assert.match(header, /grid grid-cols-1 gap-2/);
});
