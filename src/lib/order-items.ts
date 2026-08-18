import type { Database } from "@/integrations/supabase/types";

export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderItemPackType =
  | "carcasa"
  | "carcasa+polera"
  | "carcasa+poleron"
  | "carcasa+polera+poleron";
export type OrderItemDesignStatus =
  | "draft"
  | "pending"
  | "uploading"
  | "ready"
  | "locked"
  | "failed";

export function isOrderItemsMutationBlocked(input: {
  paymentStatus: string;
  designStatus: string;
  hasActivePaymentAttempt: boolean;
}): boolean {
  return (
    ["approved", "refunded", "charged_back"].includes(input.paymentStatus) ||
    input.designStatus === "locked" ||
    input.hasActivePaymentAttempt
  );
}

export function classifyIdempotencyRequest(input: {
  existingKey: string | null;
  existingFingerprint: string | null;
  requestedKey: string;
  requestedFingerprint: string;
}): "new" | "replay" | "conflict" {
  if (input.existingKey !== input.requestedKey) return "new";
  return input.existingFingerprint === input.requestedFingerprint ? "replay" : "conflict";
}

type ItemAmounts = Pick<
  OrderItem,
  "base_price" | "unit_price" | "quantity" | "discount_amount"
>;

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

export function calculateItemLineTotal(item: ItemAmounts): number {
  assertNonNegativeSafeInteger(item.base_price, "base_price");
  assertNonNegativeSafeInteger(item.unit_price, "unit_price");
  assertNonNegativeSafeInteger(item.discount_amount, "discount_amount");
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
    throw new RangeError("quantity must be a positive safe integer");
  }

  if (item.unit_price > item.base_price) {
    throw new RangeError("unit_price cannot exceed base_price");
  }
  const lineTotal = item.unit_price * item.quantity;
  const expectedDiscount = (item.base_price - item.unit_price) * item.quantity;
  if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(expectedDiscount)) {
    throw new RangeError("item amount exceeds the supported range");
  }
  if (item.discount_amount !== expectedDiscount) {
    throw new RangeError("discount_amount is inconsistent with unit prices");
  }
  return lineTotal;
}

export function aggregateOrderSubtotal(
  items: readonly Pick<OrderItem, "base_price" | "unit_price" | "quantity" | "discount_amount" | "is_active">[],
): number {
  return items.reduce((total, item) => {
    if (!item.is_active) return total;
    const next = total + calculateItemLineTotal(item);
    if (!Number.isSafeInteger(next)) {
      throw new RangeError("order subtotal exceeds the supported range");
    }
    return next;
  }, 0);
}

export function orderItemsToShippingItems(
  items: readonly Pick<OrderItem, "pack_type" | "quantity" | "is_active">[],
): Array<{ kind: "case" | "polera" | "poleron"; qty: number }> {
  const totals = { case: 0, polera: 0, poleron: 0 };
  for (const item of items) {
    if (!item.is_active) continue;
    totals.case += item.quantity;
    if (["carcasa+polera", "carcasa+polera+poleron"].includes(item.pack_type)) {
      totals.polera += item.quantity;
    }
    if (["carcasa+poleron", "carcasa+polera+poleron"].includes(item.pack_type)) {
      totals.poleron += item.quantity;
    }
  }
  return (["case", "polera", "poleron"] as const)
    .filter((kind) => totals[kind] > 0)
    .map((kind) => ({ kind, qty: totals[kind] }));
}

export function aggregateDesignStatus(
  items: readonly Pick<OrderItem, "design_status" | "is_active">[],
): OrderItemDesignStatus {
  const statuses = items
    .filter((item) => item.is_active)
    .map((item) => item.design_status as OrderItemDesignStatus);

  if (statuses.length === 0) return "draft";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("locked")) return "locked";
  if (statuses.includes("uploading")) return "uploading";
  if (statuses.every((status) => status === "ready")) return "ready";
  if (statuses.includes("pending")) return "pending";
  return "draft";
}

export function sortOrderItems<T extends Pick<OrderItem, "position" | "created_at" | "id">>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.position - b.position ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

export function isOrderItemComplete(
  item: Pick<
    OrderItem,
    | "pack_type"
    | "phone_model_id"
    | "garment_id"
    | "garment_size"
    | "secondary_garment_id"
    | "secondary_garment_size"
    | "quantity"
    | "base_price"
    | "unit_price"
    | "discount_amount"
    | "line_total"
    | "design_status"
    | "is_active"
  >,
): boolean {
  if (!item.is_active || !item.phone_model_id || item.design_status !== "ready") return false;
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) return false;

  let expectedLineTotal: number;
  try {
    expectedLineTotal = calculateItemLineTotal(item);
  } catch {
    return false;
  }
  if (item.line_total !== expectedLineTotal) return false;

  switch (item.pack_type as OrderItemPackType) {
    case "carcasa":
      return !item.garment_id && !item.secondary_garment_id;
    case "carcasa+polera":
    case "carcasa+poleron":
      return !!item.garment_id && !!item.garment_size && !item.secondary_garment_id;
    case "carcasa+polera+poleron":
      return (
        !!item.garment_id &&
        !!item.garment_size &&
        !!item.secondary_garment_id &&
        !!item.secondary_garment_size &&
        item.garment_id !== item.secondary_garment_id
      );
    default:
      return false;
  }
}
