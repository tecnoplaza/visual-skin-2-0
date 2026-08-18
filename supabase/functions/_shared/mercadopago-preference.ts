export type PreferenceResolution =
  | { ok: true; preferenceId: string; source: "payment" | "merchant_order" }
  | { ok: false; kind: "transient" | "invalid"; code: string };

type ResolvePreferenceInput = {
  payment: Record<string, unknown>;
  paymentId: string;
  visualSkinOrderId: string;
  transactionAmount: number;
  accessToken: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
};

function numericId(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function finiteAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function resolveMercadoPagoPreferenceId(
  input: ResolvePreferenceInput,
): Promise<PreferenceResolution> {
  const direct = typeof input.payment.preference_id === "string"
    ? input.payment.preference_id.trim()
    : "";
  if (direct) return { ok: true, preferenceId: direct, source: "payment" };

  const paymentOrder = input.payment.order as Record<string, unknown> | null | undefined;
  const merchantOrderId = numericId(paymentOrder?.id);
  if (!merchantOrderId) return { ok: false, kind: "invalid", code: "missing_merchant_order_id" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  try {
    response = await (input.fetchFn ?? globalThis.fetch)(
      `https://api.mercadopago.com/merchant_orders/${merchantOrderId}`,
      { headers: { Authorization: `Bearer ${input.accessToken}` }, signal: controller.signal },
    );
  } catch {
    return { ok: false, kind: "transient", code: "merchant_order_network" };
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return { ok: false, kind: "transient", code: "merchant_order_http" };

  let merchantOrder: Record<string, unknown>;
  try {
    merchantOrder = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, kind: "transient", code: "merchant_order_invalid_json" };
  }

  if (numericId(merchantOrder.id) !== merchantOrderId) {
    return { ok: false, kind: "invalid", code: "merchant_order_id_mismatch" };
  }
  const preferenceId = typeof merchantOrder.preference_id === "string"
    ? merchantOrder.preference_id.trim()
    : "";
  if (!preferenceId) return { ok: false, kind: "invalid", code: "merchant_order_missing_preference" };

  const paymentExternalReference = typeof input.payment.external_reference === "string"
    ? input.payment.external_reference
    : null;
  if (paymentExternalReference !== input.visualSkinOrderId ||
      merchantOrder.external_reference !== paymentExternalReference) {
    return { ok: false, kind: "invalid", code: "merchant_order_external_reference_mismatch" };
  }

  const totalAmount = finiteAmount(merchantOrder.total_amount);
  const paidAmount = finiteAmount(merchantOrder.paid_amount);
  if (totalAmount !== input.transactionAmount) {
    return { ok: false, kind: "invalid", code: "merchant_order_total_mismatch" };
  }
  if (paidAmount === null || paidAmount < input.transactionAmount || paidAmount > totalAmount) {
    return { ok: false, kind: "invalid", code: "merchant_order_paid_amount_mismatch" };
  }

  const payments = Array.isArray(merchantOrder.payments) ? merchantOrder.payments : [];
  const matching = payments.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return numericId((entry as Record<string, unknown>).id) === input.paymentId;
  });
  if (matching.length !== 1) {
    return { ok: false, kind: "invalid", code: "merchant_order_payment_missing" };
  }
  const merchantPaymentAmount = finiteAmount((matching[0] as Record<string, unknown>).transaction_amount);
  if (merchantPaymentAmount !== input.transactionAmount) {
    return { ok: false, kind: "invalid", code: "merchant_order_payment_amount_mismatch" };
  }

  return { ok: true, preferenceId, source: "merchant_order" };
}
