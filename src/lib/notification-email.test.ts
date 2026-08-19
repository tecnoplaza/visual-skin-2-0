import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsSensitiveNotificationData,
  formatClp,
  renderNotificationEmail,
} from "./notification-email.ts";

describe("notification email rendering", () => {
  const payload = {
    order_id: "00000000-0000-0000-0000-000000000001",
    order_number: "VS-100",
    customer_name: "Ana",
    total_amount: 19990,
    currency: "CLP",
    item_count: 3,
  };
  it("uses the canonical backend total and approved copy", () => {
    const email = renderNotificationEmail("payment_approved", payload, "https://visualskin.cl");
    assert.match(email.text, new RegExp(formatClp(19990).replace(/[$.]/g, "\\$&")));
    assert.match(email.text, /Pago aprobado/);
    assert.doesNotMatch(email.text, /tarjeta|cvv/i);
  });
  it("renders the correct multi-item count for admin", () => {
    assert.match(
      renderNotificationEmail("admin_new_paid_order", payload, "https://visualskin.cl").text,
      /Productos: 3/,
    );
  });
  it("generates customer and admin links without credentials", () => {
    assert.match(
      renderNotificationEmail("shipped", payload, "https://visualskin.cl").text,
      /\/pedido\/00000000/,
    );
    assert.match(
      renderNotificationEmail("admin_chargeback", payload, "https://visualskin.cl").text,
      /\/admin\/orders\/00000000/,
    );
  });
  it("detects forbidden secret-shaped payload fields", () => {
    assert.equal(containsSensitiveNotificationData({ access_token: "secret" }), true);
    assert.equal(containsSensitiveNotificationData(payload), false);
  });
});
