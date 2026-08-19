import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  containsSensitiveNotificationData,
  formatClp,
  renderNotificationEmail,
} from "./notification-email.ts";

const origin = "https://visualskin.cl";
const payload = {
  order_id: "00000000-0000-0000-0000-000000000001",
  order_number: "VS-100",
  customer_name: "Ana",
  subtotal_amount: 17990,
  shipping_amount: 2000,
  total_amount: 19990,
  currency: "CLP",
  item_count: 3,
  products: [
    { pack_type: "carcasa", quantity: 1 },
    { pack_type: "carcasa+polera", quantity: 2 },
  ],
};

describe("notification email rendering", () => {
  it("contains no mojibake in source or rendered messages", () => {
    const source = readFileSync(new URL("./notification-email.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /Â|Ã|â/);
    for (const event of [
      "order_received", "payment_approved", "payment_rejected", "payment_cancelled",
      "production_started", "ready_for_shipping", "shipped", "completed", "refunded",
      "admin_new_paid_order", "admin_manual_review", "admin_payment_reconciliation",
      "admin_refund", "admin_chargeback",
    ]) {
      const message = renderNotificationEmail(event, payload, origin);
      assert.doesNotMatch(`${message.subject}${message.html}${message.text}`, /Â|Ã|â/);
    }
  });

  it("uses the correct subject for every transactional event", () => {
    const expected: Record<string, string> = {
      order_received: "Pedido recibido  VS-100",
      payment_approved: "Pago confirmado  VS-100",
      payment_rejected: "Pago rechazado  VS-100",
      payment_cancelled: "Pago cancelado  VS-100",
      production_started: "Tu pedido entró en producción  VS-100",
      ready_for_shipping: "Tu pedido está listo para despacho  VS-100",
      shipped: "Tu pedido fue enviado  VS-100",
      completed: "Pedido completado  VS-100",
      refunded: "Reembolso procesado  VS-100",
      admin_new_paid_order: "Nuevo pedido pagado  VS-100",
      admin_manual_review: "Revisión manual requerida  VS-100",
      admin_payment_reconciliation: "Conciliación de pago requerida  VS-100",
      admin_refund: "Reembolso procesado  VS-100",
      admin_chargeback: "ALERTA: Contracargo  VS-100",
    };
    for (const [event, subject] of Object.entries(expected)) {
      assert.equal(renderNotificationEmail(event, payload, origin).subject, subject);
    }
  });

  it("order received includes products and every canonical amount", () => {
    const message = renderNotificationEmail("order_received", payload, origin);
    assert.match(message.text, /1 × carcasa/);
    assert.match(message.text, /2 × carcasa\+polera/);
    assert.match(message.text, new RegExp(`Subtotal: ${escapeRegex(formatClp(17990))}`));
    assert.match(message.text, new RegExp(`Despacho: ${escapeRegex(formatClp(2000))}`));
    assert.match(message.text, new RegExp(`Total: ${escapeRegex(formatClp(19990))}`));
    assert.match(message.text, /Tu pedido quedó registrado correctamente/);
    assert.doesNotMatch(message.text, /Aún no afirmamos/);
  });

  it("payment approved contains approved status and canonical paid total", () => {
    const message = renderNotificationEmail("payment_approved", payload, origin);
    assert.match(message.text, /Pago aprobado/);
    assert.match(message.text, new RegExp(`Total pagado: ${escapeRegex(formatClp(19990))}`));
    assert.doesNotMatch(message.text, /tarjeta|cvv/i);
  });

  it("production and shipping lifecycle emails do not highlight totals", () => {
    for (const event of ["production_started", "ready_for_shipping", "shipped", "completed"]) {
      const message = renderNotificationEmail(event, payload, origin);
      assert.doesNotMatch(message.text, /Total:/);
      assert.doesNotMatch(message.html, /Total:/);
    }
  });

  it("shipped does not invent carrier or tracking information", () => {
    const message = renderNotificationEmail("shipped", payload, origin);
    assert.match(message.text, /va camino a destino/);
    assert.doesNotMatch(`${message.html}${message.text}`, /tracking|transportista|número de seguimiento/i);
  });

  it("admin paid order includes customer, total and product count", () => {
    const message = renderNotificationEmail("admin_new_paid_order", payload, origin);
    assert.match(message.text, /Cliente: Ana/);
    assert.match(message.text, new RegExp(`Total: ${escapeRegex(formatClp(19990))}`));
    assert.match(message.text, /Cantidad de productos: 3/);
    assert.match(message.text, /Pago confirmado correctamente/);
  });

  it("admin chargeback is an explicit review alert", () => {
    const message = renderNotificationEmail("admin_chargeback", payload, origin);
    assert.match(message.subject, /^ALERTA: Contracargo/);
    assert.match(message.text, /Requiere revisión/);
  });

  it("escapes every dynamic customer and order value in HTML", () => {
    const message = renderNotificationEmail("payment_approved", {
      ...payload,
      customer_name: '<Ana & "Equipo">',
      order_number: "VS-<script>alert(1)</script>",
    }, origin);
    assert.match(message.html, /&lt;Ana &amp; &quot;Equipo&quot;&gt;/);
    assert.match(message.html, /VS-&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(message.html, /<script>/);
  });

  it("plain text contains the CTA and credential-free URL", () => {
    const customer = renderNotificationEmail("payment_rejected", payload, origin);
    const admin = renderNotificationEmail("admin_manual_review", payload, origin);
    assert.match(customer.text, /Revisar mi pedido: https:\/\/visualskin\.cl\/pedido\/00000000/);
    assert.match(admin.text, /Revisar pedido: https:\/\/visualskin\.cl\/admin\/orders\/00000000/);
    assert.doesNotMatch(`${customer.text}${admin.text}`, /token=|authorization|service.role/i);
  });

  it("includes sanitized reasons only for review emails", () => {
    const reviewPayload = { ...payload, reason: "Monto requiere validación" };
    assert.match(renderNotificationEmail("admin_manual_review", reviewPayload, origin).text, /Motivo: Monto requiere validación/);
    assert.doesNotMatch(renderNotificationEmail("payment_approved", reviewPayload, origin).text, /Motivo:/);
  });

  it("detects forbidden secret-shaped payload fields", () => {
    for (const key of ["access_token", "service_role", "authorization", "card_token", "cvv", "webhook_signature"]) {
      assert.equal(containsSensitiveNotificationData({ [key]: "secret" }), true);
    }
    assert.equal(containsSensitiveNotificationData(payload), false);
  });

  it("uses VisualSkin Chile branding in HTML and plain text", () => {
    const message = renderNotificationEmail("payment_approved", payload, origin);
    assert.match(message.html, />VisualSkin Chile</);
    assert.match(message.text, /\nVisualSkin Chile$/);
    assert.doesNotMatch(`${message.html}${message.text}`, /Â|Ã|â/);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
