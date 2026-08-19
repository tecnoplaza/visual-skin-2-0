export type NotificationMessage = { subject: string; html: string; text: string };

type Payload = Record<string, unknown>;
type Product = { packType: string; quantity: number };
type EmailContent = {
  title: string;
  paragraphs: string[];
  cta: string;
  showOrderAmounts?: boolean;
  showTotal?: boolean;
  showProducts?: boolean;
  showAdminSummary?: boolean;
  showReason?: boolean;
};

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export function formatClp(value: unknown): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function productsFrom(payload: Payload): Product[] {
  if (!Array.isArray(payload.products)) return [];
  return payload.products.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const product = value as Payload;
    const quantity = Number(product.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return [];
    return [{ packType: String(product.pack_type ?? "Producto VisualSkin"), quantity }];
  });
}

function contentFor(eventType: string, order: string): EmailContent {
  switch (eventType) {
    case "order_received":
      return {
        title: "Pedido recibido",
        paragraphs: [
          `Recibimos correctamente tu pedido ${order}.`,
          "Tu pedido quedó registrado correctamente. Te avisaremos por correo cuando el pago sea confirmado.",
        ],
        cta: "Ver mi pedido",
        showProducts: true,
        showOrderAmounts: true,
      };
    case "payment_approved":
      return {
        title: "Pago confirmado",
        paragraphs: [
          `Recibimos correctamente el pago de tu pedido ${order}.`,
          "Estado: Pago aprobado",
          "Ya estamos preparando tu pedido.",
        ],
        cta: "Ver mi pedido",
        showTotal: true,
      };
    case "payment_rejected":
      return {
        title: "Pago rechazado",
        paragraphs: [
          "No pudimos confirmar el pago de tu pedido.",
          "Puedes volver a tu pedido para revisar el estado y reintentar el pago cuando esté disponible.",
        ],
        cta: "Revisar mi pedido",
      };
    case "payment_cancelled":
      return {
        title: "Pago cancelado",
        paragraphs: [
          "El proceso de pago de tu pedido fue cancelado.",
          "Tu pedido sigue disponible para que puedas revisarlo.",
        ],
        cta: "Revisar mi pedido",
      };
    case "production_started":
      return {
        title: "Tu pedido entró en producción",
        paragraphs: [
          "Tu diseño ya entró a producción.",
          "Estamos preparando tu pedido VisualSkin.",
        ],
        cta: "Ver mi pedido",
      };
    case "ready_for_shipping":
      return {
        title: "Tu pedido está listo para despacho",
        paragraphs: ["Tu pedido está terminado y preparado para ser despachado."],
        cta: "Ver mi pedido",
      };
    case "shipped":
      return {
        title: "Tu pedido fue enviado",
        paragraphs: ["Tu pedido ya salió de nuestras instalaciones y va camino a destino."],
        cta: "Ver mi pedido",
      };
    case "completed":
      return {
        title: "Pedido completado",
        paragraphs: ["Tu pedido ha sido completado.", "Gracias por elegir VisualSkin."],
        cta: "Ver mi pedido",
      };
    case "refunded":
      return {
        title: "Reembolso procesado",
        paragraphs: ["El reembolso asociado a tu pedido fue procesado."],
        cta: "Ver mi pedido",
        showTotal: true,
      };
    case "admin_new_paid_order":
      return {
        title: "Nuevo pedido pagado",
        paragraphs: ["Pago confirmado correctamente."],
        cta: "Ver pedido en Admin",
        showAdminSummary: true,
      };
    case "admin_manual_review":
      return {
        title: "Revisión manual requerida",
        paragraphs: ["Este pedido requiere revisión manual."],
        cta: "Revisar pedido",
        showReason: true,
      };
    case "admin_payment_reconciliation":
      return {
        title: "Conciliación de pago requerida",
        paragraphs: ["Un intento de pago requiere conciliación."],
        cta: "Revisar pedido",
        showReason: true,
      };
    case "admin_refund":
      return {
        title: "Reembolso procesado",
        paragraphs: ["El reembolso asociado a este pedido fue procesado."],
        cta: "Ver pedido",
        showTotal: true,
      };
    case "admin_chargeback":
      return {
        title: "ALERTA: Contracargo",
        paragraphs: [
          "Mercado Pago informó una reversa/contracargo asociado a este pedido. Requiere revisión.",
        ],
        cta: "Revisar pedido",
      };
    default:
      return {
        title: "Actualización de tu pedido",
        paragraphs: [`Hay una actualización disponible para tu pedido ${order}.`],
        cta: eventType.startsWith("admin_") ? "Ver pedido en Admin" : "Ver mi pedido",
      };
  }
}

export function renderNotificationEmail(
  eventType: string,
  payload: Payload,
  siteOrigin: string,
): NotificationMessage {
  const order = String(payload.order_number ?? "Pedido");
  const name = String(payload.customer_name ?? "cliente");
  const isAdmin = eventType.startsWith("admin_");
  const content = contentFor(eventType, order);
  const href = `${siteOrigin}${isAdmin ? "/admin/orders/" : "/pedido/"}${encodeURIComponent(String(payload.order_id ?? ""))}`;
  const subject = `${content.title}  ${order}`;
  const products = productsFrom(payload);
  const hasTotal = typeof payload.total_amount === "number" && Number.isFinite(payload.total_amount);
  const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : null;

  const textLines = [`Hola ${name},`, "", ...content.paragraphs];
  if (content.showProducts) {
    textLines.push("", "Productos:");
    textLines.push(...(products.length ? products.map((p) => `- ${p.quantity} × ${p.packType}`) : ["- Sin detalle disponible"]));
  }
  if (content.showOrderAmounts) {
    textLines.push(
      "",
      `Subtotal: ${formatClp(payload.subtotal_amount)}`,
      `Despacho: ${formatClp(payload.shipping_amount)}`,
      `Total: ${formatClp(payload.total_amount)}`,
    );
  } else if (content.showTotal && hasTotal) {
    textLines.push("", `${eventType === "payment_approved" ? "Total pagado" : "Total"}: ${formatClp(payload.total_amount)}`);
  }
  if (content.showAdminSummary) {
    textLines.push(
      "",
      `Cliente: ${name}`,
      `Número de pedido: ${order}`,
      `Total: ${formatClp(payload.total_amount)}`,
      `Cantidad de productos: ${Number(payload.item_count ?? 0)}`,
    );
  }
  if (content.showReason && reason) textLines.push("", `Motivo: ${reason}`);
  textLines.push("", `${content.cta}: ${href}`, "", "VisualSkin");

  const productHtml = content.showProducts
    ? `<div style="margin:24px 0"><p style="margin:0 0 8px;font-weight:700">Productos</p><ul style="margin:0;padding-left:20px">${
        products.length
          ? products.map((p) => `<li style="margin:4px 0">${esc(p.quantity)} × ${esc(p.packType)}</li>`).join("")
          : '<li style="margin:4px 0">Sin detalle disponible</li>'
      }</ul></div>`
    : "";
  const amountsHtml = content.showOrderAmounts
    ? `<div style="margin:24px 0;padding:16px;background:#f3f4f6;border-radius:10px"><p style="margin:0 0 8px">Subtotal: <strong>${esc(formatClp(payload.subtotal_amount))}</strong></p><p style="margin:0 0 8px">Despacho: <strong>${esc(formatClp(payload.shipping_amount))}</strong></p><p style="margin:0;font-size:18px">Total: <strong>${esc(formatClp(payload.total_amount))}</strong></p></div>`
    : content.showTotal && hasTotal
      ? `<p style="margin:24px 0;font-size:18px">${eventType === "payment_approved" ? "Total pagado" : "Total"}: <strong>${esc(formatClp(payload.total_amount))}</strong></p>`
      : "";
  const adminSummaryHtml = content.showAdminSummary
    ? `<div style="margin:24px 0;padding:16px;background:#f3f4f6;border-radius:10px"><p style="margin:0 0 8px">Cliente: <strong>${esc(name)}</strong></p><p style="margin:0 0 8px">Número de pedido: <strong>${esc(order)}</strong></p><p style="margin:0 0 8px">Total: <strong>${esc(formatClp(payload.total_amount))}</strong></p><p style="margin:0">Cantidad de productos: <strong>${esc(Number(payload.item_count ?? 0))}</strong></p></div>`
    : "";
  const reasonHtml = content.showReason && reason ? `<p style="margin:20px 0"><strong>Motivo:</strong> ${esc(reason)}</p>` : "";
  const paragraphsHtml = content.paragraphs.map((paragraph) => `<p style="margin:0 0 14px;line-height:1.6">${esc(paragraph)}</p>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827"><div style="max-width:600px;margin:0 auto;padding:24px"><div style="background:#111827;color:#ffffff;padding:20px;border-radius:14px 14px 0 0;font-size:22px;font-weight:700">VisualSkin</div><div style="background:#ffffff;padding:28px;border-radius:0 0 14px 14px"><h1 style="margin:0 0 22px;font-size:24px;line-height:1.25">${esc(content.title)}</h1><p style="margin:0 0 18px">Hola ${esc(name)},</p>${paragraphsHtml}${productHtml}${amountsHtml}${adminSummaryHtml}${reasonHtml}<a href="${esc(href)}" style="display:inline-block;margin-top:12px;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700">${esc(content.cta)}</a><p style="margin:30px 0 0;color:#6b7280;font-size:13px">VisualSkin</p></div></div></body></html>`;

  return { subject, html, text: textLines.join("\n") };
}

export function containsSensitiveNotificationData(value: unknown): boolean {
  return /access[_ -]?token|service[_ -]?role|card[_ -]?token|webhook[_ -]?signature|authorization|cvv|security[_ -]?code/i.test(
    JSON.stringify(value),
  );
}
