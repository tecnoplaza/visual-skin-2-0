import type { OrderItem } from "./order-items";

export type CartOrder = {
  id: string;
  order_number: string | null;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  design_status: string;
  payment_status: string;
};

export type CartPreviewKind = "case" | "garment" | "secondary_garment";
export type CartItemPreviewUrls = Partial<Record<CartPreviewKind, string | null>>;
export type CartItem = OrderItem & {
  preview_url?: string | null;
  preview_urls?: CartItemPreviewUrls;
};
export type ActiveCart = { order: CartOrder; items: CartItem[] };

export type CartPreviewSlot = {
  kind: CartPreviewKind;
  label: "Carcasa" | "Polera" | "Polerón";
  url: string | null;
};

export function cartItemPreviewSlots(item: CartItem): CartPreviewSlot[] {
  const urls = item.preview_urls ?? { case: item.preview_url ?? null };
  const slots: CartPreviewSlot[] = [
    { kind: "case", label: "Carcasa", url: urls.case ?? null },
  ];
  if (item.pack_type === "carcasa+polera") {
    slots.push({ kind: "garment", label: "Polera", url: urls.garment ?? null });
  } else if (item.pack_type === "carcasa+poleron") {
    slots.push({ kind: "garment", label: "Polerón", url: urls.garment ?? null });
  } else if (item.pack_type === "carcasa+polera+poleron") {
    slots.push(
      { kind: "garment", label: "Polera", url: urls.garment ?? null },
      { kind: "secondary_garment", label: "Polerón", url: urls.secondary_garment ?? null },
    );
  }
  return slots;
}

export function activeCartItems(cart: ActiveCart | null | undefined): CartItem[] {
  return (cart?.items ?? []).filter((item) => item.is_active);
}

export function cartItemCount(cart: ActiveCart | null | undefined): number {
  return activeCartItems(cart).length;
}

export function canContinueCart(cart: ActiveCart | null | undefined): boolean {
  const items = activeCartItems(cart);
  return items.length > 0 && cart?.order.design_status === "ready"
    && items.every((item) => item.design_status === "ready");
}

export function isMultiItemPaymentBlocked(cart: ActiveCart | null | undefined): boolean {
  return cartItemCount(cart) > 1;
}

export function cartWriteMode(cart: ActiveCart | null | undefined): "create_order" | "add_item" {
  return cart?.order.id ? "add_item" : "create_order";
}

export function cartPackLabel(packType: string): string {
  const labels: Record<string, string> = {
    carcasa: "Solo carcasa",
    "carcasa+polera": "Carcasa + Polera",
    "carcasa+poleron": "Carcasa + Polerón",
    "carcasa+polera+poleron": "Carcasa + Polera + Polerón",
  };
  return labels[packType] ?? packType;
}

export function designStatusLabel(status: string): string {
  if (status === "ready") return "Diseño listo";
  if (status === "uploading") return "Subiendo";
  if (status === "failed") return "Error en el diseño";
  return "Diseño pendiente";
}
