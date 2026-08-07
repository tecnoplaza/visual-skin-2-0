// Deriva el texto de estado de producción según el estado de pago.
// Regla: production_status sólo debe mostrarse cuando payment_status === "approved".
// En cualquier otro caso, se muestra un mensaje coherente con el pago.

export function productionDisplayLabel(
  paymentStatus: string | null | undefined,
  fulfillmentStatus: string | null | undefined,
): string {
  switch (paymentStatus) {
    case "approved":
      return (fulfillmentStatus ?? "new").toString();
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
