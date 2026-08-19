export type NotificationMessage = { subject: string; html: string; text: string };

type Payload = Record<string, unknown>;

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export function formatClp(value: unknown): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

const labels: Record<string, { customer: string; admin?: string }> = {
  order_received: { customer: "Pedido recibido" },
  payment_approved: { customer: "Pago confirmado" },
  payment_rejected: { customer: "Pago rechazado" },
  payment_cancelled: { customer: "Pago cancelado" },
  production_started: { customer: "Tu pedido entró en producción" },
  ready_for_shipping: { customer: "Tu pedido está listo para despacho" },
  shipped: { customer: "Tu pedido fue enviado" },
  completed: { customer: "Pedido completado" },
  refunded: { customer: "Reembolso procesado" },
  admin_new_paid_order: { customer: "Nuevo pedido pagado" },
  admin_manual_review: { customer: "Pedido en revisión manual" },
  admin_payment_reconciliation: { customer: "Pago pendiente de conciliación" },
  admin_refund: { customer: "Reembolso procesado" },
  admin_chargeback: { customer: "Alerta de contracargo" },
};

export function renderNotificationEmail(
  eventType: string,
  payload: Payload,
  siteOrigin: string,
): NotificationMessage {
  const order = String(payload.order_number ?? "Pedido");
  const name = String(payload.customer_name ?? "cliente");
  const total = formatClp(payload.total_amount);
  const isAdmin = eventType.startsWith("admin_");
  const heading = labels[eventType]?.customer ?? "Actualización de tu pedido";
  const href = `${siteOrigin}${isAdmin ? "/admin/orders/" : "/pedido/"}${encodeURIComponent(String(payload.order_id ?? ""))}`;
  const subject = `${heading} · ${order}`;
  let body = `Hola ${name},\n\n${heading} para tu pedido ${order}.`;
  if (eventType === "order_received")
    body += `\n\nSubtotal: ${formatClp(payload.subtotal_amount)}\nDespacho: ${formatClp(payload.shipping_amount)}\nTotal: ${total}\n\nAún no afirmamos que el pago esté confirmado.`;
  if (eventType === "order_received" && Array.isArray(payload.products))
    body += `\nProductos: ${payload.products.map((p) => `${Number((p as Payload).quantity ?? 0)} × ${String((p as Payload).pack_type ?? "producto")}`).join(", ")}`;
  if (eventType === "payment_approved")
    body += `\n\nTotal: ${total}\nEstado: Pago aprobado\n\nYa estamos preparando tu pedido.`;
  if (eventType === "admin_new_paid_order")
    body += `\n\nCliente: ${name}\nTotal: ${total}\nProductos: ${Number(payload.item_count ?? 0)}`;
  if (payload.reason) body += `\n\nMotivo: ${String(payload.reason)}`;
  body += `\n\n${isAdmin ? "Ver pedido en Admin" : "Ver mi pedido"}: ${href}\n\nVisualSkin`;
  const detail =
    eventType === "payment_approved"
      ? "<p><strong>Estado:</strong> Pago aprobado</p><p>Ya estamos preparando tu pedido.</p>"
      : eventType === "order_received"
        ? "<p>Recibimos tu pedido. La confirmación del pago se informará por separado.</p>"
        : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827"><div style="max-width:600px;margin:auto;padding:24px"><div style="background:#111827;color:white;padding:20px;border-radius:14px 14px 0 0;font-size:22px;font-weight:bold">VisualSkin</div><div style="background:white;padding:28px;border-radius:0 0 14px 14px"><h1 style="font-size:22px">${esc(heading)}</h1><p>Hola ${esc(name)},</p><p>Actualizamos tu pedido <strong>${esc(order)}</strong>.</p><p style="font-size:18px"><strong>${esc(total)}</strong></p>${detail}${payload.reason ? `<p>Motivo: ${esc(payload.reason)}</p>` : ""}<a href="${esc(href)}" style="display:inline-block;margin-top:16px;background:#2563eb;color:white;text-decoration:none;padding:12px 18px;border-radius:8px">${isAdmin ? "Ver pedido en Admin" : "Ver mi pedido"}</a><p style="margin-top:28px;color:#6b7280;font-size:13px">VisualSkin</p></div></div></body></html>`;
  return { subject, html, text: body };
}

export function containsSensitiveNotificationData(value: unknown): boolean {
  return /access[_ -]?token|service[_ -]?role|card[_ -]?token|webhook[_ -]?signature|authorization|cvv|security[_ -]?code/i.test(
    JSON.stringify(value),
  );
}
