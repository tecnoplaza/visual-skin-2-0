export type CheckoutCartItem = {
  id: string;
  position: number;
  pack_type: string;
  pack_id: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  phone_model_id: string | null;
  brand_id: string | null;
  brand: string | null;
  phone_model: string | null;
  garment_id: string | null;
  garment_size: string | null;
  garment_color: string | null;
  secondary_garment_id: string | null;
  secondary_garment_size: string | null;
  secondary_garment_color: string | null;
};

export type CanonicalCheckoutCart = {
  schema: 1;
  order_id: string;
  currency: "CLP";
  items: CheckoutCartItem[];
  subtotal_amount: number;
  shipping_amount: number;
  total_amount: number;
};

export type MercadoPagoLine = {
  id: string;
  title: string;
  quantity: number;
  currency_id: "CLP";
  unit_price: number;
};

const PACK_TITLES: Record<string, string> = {
  carcasa: "Carcasa personalizada VisualSkin",
  "carcasa+polera": "Pack carcasa y polera VisualSkin",
  "carcasa+poleron": "Pack carcasa y polerón VisualSkin",
  "carcasa+polera+poleron": "Pack completo VisualSkin",
};

export function canonicalizeCheckoutCart(input: Omit<CanonicalCheckoutCart, "schema">): CanonicalCheckoutCart {
  const items = [...input.items]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      position: item.position,
      pack_type: item.pack_type,
      pack_id: item.pack_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      line_total: item.line_total,
      phone_model_id: item.phone_model_id,
      brand_id: item.brand_id,
      brand: item.brand,
      phone_model: item.phone_model,
      garment_id: item.garment_id,
      garment_size: item.garment_size,
      garment_color: item.garment_color,
      secondary_garment_id: item.secondary_garment_id,
      secondary_garment_size: item.secondary_garment_size,
      secondary_garment_color: item.secondary_garment_color,
    }));
  return {
    schema: 1,
    order_id: input.order_id,
    currency: "CLP",
    items,
    subtotal_amount: input.subtotal_amount,
    shipping_amount: input.shipping_amount,
    total_amount: input.total_amount,
  };
}

export function serializeCanonicalCheckoutCart(cart: CanonicalCheckoutCart): string {
  // The object is built above with fixed property insertion order; items are
  // sorted explicitly and contain no arbitrary nested objects.
  return JSON.stringify(cart);
}

export function buildMercadoPagoLines(cart: CanonicalCheckoutCart): MercadoPagoLine[] {
  const lines = cart.items.map((item) => ({
    id: item.id,
    title: PACK_TITLES[item.pack_type] ?? "Producto personalizado VisualSkin",
    quantity: item.quantity,
    currency_id: "CLP" as const,
    unit_price: item.unit_price,
  }));
  if (cart.shipping_amount > 0) {
    lines.push({ id: "shipping", title: "Envío", quantity: 1, currency_id: "CLP", unit_price: cart.shipping_amount });
  }
  return lines;
}

export function assertCheckoutEconomy(cart: CanonicalCheckoutCart, lines: MercadoPagoLine[]): void {
  if (!cart.items.length) throw new Error("empty_cart");
  let subtotal = 0;
  for (const item of cart.items) {
    if (![item.quantity, item.unit_price, item.discount_amount, item.line_total].every(Number.isSafeInteger)) {
      throw new Error("invalid_cart_amount");
    }
    if (item.quantity < 1 || item.unit_price < 0 || item.discount_amount < 0 || item.line_total !== item.unit_price * item.quantity) {
      throw new Error("invalid_cart_amount");
    }
    subtotal += item.line_total;
  }
  const lineSum = lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal !== cart.subtotal_amount || cart.total_amount !== subtotal + cart.shipping_amount || lineSum !== cart.total_amount || cart.total_amount <= 0) {
    throw new Error("checkout_total_mismatch");
  }
}
