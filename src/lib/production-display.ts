// Deriva el texto de estado de producción según el estado de pago.
// Regla: production_status sólo debe mostrarse cuando payment_status === "approved".
// En cualquier otro caso, se muestra un mensaje coherente con el pago.

const FULFILLMENT_LABELS: Record<string, string> = {
  new: "Pedido recibido",
  in_production: "En producción",
  ready: "Listo para despacho",
  shipped: "Enviado",
  completed: "Completado",
  cancelled: "Producción cancelada",
};

export function productionDisplayLabel(
  paymentStatus: string | null | undefined,
  fulfillmentStatus: string | null | undefined,
): string {
  switch (paymentStatus) {
    case "approved":
      return FULFILLMENT_LABELS[fulfillmentStatus ?? "new"] ?? "Pedido recibido";
    case "pending":
    case "in_process":
      return "Producción pendiente de pago";
    case "rejected":
      return "Producción no iniciada";
    case "cancelled":
      return "Producción cancelada";
    case "refunded":
    case "charged_back":
      return "Producción detenida";
    default:
      return "Producción no iniciada";
  }
}

export function shouldShowProductionControls(
  paymentStatus: string | null | undefined,
): boolean {
  return paymentStatus === "approved";
}
