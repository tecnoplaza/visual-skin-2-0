// Secure order lifecycle server functions.
// All order creation, price calculation, payment attempt handling and
// state-machine transitions happen here. The browser never sends amounts
// nor handles secrets.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getCookie,
  setCookie,
  deleteCookie,
  setResponseHeaders,
} from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { getRequest } from "@tanstack/react-start/server";
import {
  assertSameOrigin,
  assertCsrfToken,
  generateCsrfToken,
  hashCsrfToken,
} from "@/lib/csrf";
import {
  getServerConfig,
  getMercadoPagoConfig,
  tryGetMercadoPagoConfig,
  getPaymentsGateSummary,
  assertProductionPaymentsConfigured,
} from "@/lib/server-config";
import { detectAndValidateImage, IMAGE_LIMITS } from "@/lib/image-parser";
import {
  enforceRateLimit,
  hashBucketKey,
  ipHashFromRequest,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import type { OrderItem } from "@/lib/order-items";
import { assertCheckoutEconomy, type CanonicalCheckoutCart, type MercadoPagoLine } from "@/lib/checkout-cart";

// ------------------------------------------------------------------
// Constants / helpers
// ------------------------------------------------------------------

const SESSION_COOKIE = "vs_order_sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h sliding
const SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d max
const SESSION_RENEW_THRESHOLD_S = 60 * 30; // renew if <30m remaining

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function constantTimeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function getSiteOrigin(): string {
  try {
    return getServerConfig().siteOrigin;
  } catch {
    return "";
  }
}

// Cálculo canónico de despacho (servidor). Lee shipping_config desde site_content
// vía service-role y aplica la función pura. Falla cerrado si no hay configuración.
async function computeCanonicalShipping(
  packType: string,
  deliveryMethod: "shipping" | "pickup",
): Promise<{ amount: number; rule: string }> {
  if (deliveryMethod === "pickup") return { amount: 0, rule: "shipping_disabled" };
  const {
    SHIPPING_CONFIG_KEY,
    normalizeShippingConfig,
    packTypeToItems,
    calculateShippingAmount,
  } = await import("@/lib/shipping");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("site_content")
    .select("value")
    .eq("key", SHIPPING_CONFIG_KEY)
    .maybeSingle();
  if (error) {
    throw new Error("No pudimos calcular el despacho. Inténtalo nuevamente.");
  }
  if (!data) {
    throw new Error("No pudimos calcular el despacho. Inténtalo nuevamente.");
  }
  const cfg = normalizeShippingConfig(
    (data.value ?? null) as Parameters<typeof normalizeShippingConfig>[0],
  );
  const result = calculateShippingAmount(packTypeToItems(packType), cfg);
  return result;
}


// Common no-store headers for any endpoint that touches order-scoped data.
function applyNoStoreHeaders() {
  setResponseHeaders({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  } as any);
}

// Canonical design storage path: {orderId}/{kind}-{uuid}.{ext}
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_PATH_RE =
  /^([0-9a-f-]{36})\/(case|garment|secondary_garment)-([0-9a-f-]{36})\.(png|jpg|webp)$/i;

type DesignKind = "case" | "garment" | "secondary_garment";

function assertCanonicalDesignPath(
  path: string,
  orderId: string,
  kind: DesignKind,
): void {
  if (path.length > 200) throw new Error("Ruta de diseño inválida");
  if (/[\\\u0000-\u001f]/.test(path)) throw new Error("Ruta de diseño inválida");
  if (path.includes("..") || path.includes("//")) {
    throw new Error("Ruta de diseño inválida");
  }
  const m = CANONICAL_PATH_RE.exec(path);
  if (!m) throw new Error("Ruta de diseño inválida");
  if (m[1] !== orderId) throw new Error("Ruta no corresponde al pedido");
  if (m[2].toLowerCase() !== kind) throw new Error("Tipo de diseño no coincide");
  if (!UUID_RE.test(m[3])) throw new Error("Identificador de ruta inválido");
}

// Design JSON schema — bounded, no HTML/URLs, finite numbers only.
// Required top-level: editor_schema_version, template_version, modelId, moldId.
// Values are validated against the order server-side (see validateDesignJson).
const layerNumber = z.number().finite().min(-100000).max(100000);
const DesignLayer = z
  .object({
    x: layerNumber.default(0),
    y: layerNumber.default(0),
    rotate: z.number().finite().min(-3600).max(3600).default(0),
    scale: z.number().finite().min(0.01).max(100).default(1),
    width: z.number().finite().min(0).max(100000).optional(),
    height: z.number().finite().min(0).max(100000).optional(),
    assetRef: z.string().max(200).optional(),
  })
  .strict();

const DesignJsonSchema = z
  .object({
    editor_schema_version: z.string().min(1).max(40),
    template_version: z.string().min(1).max(40),
    modelId: z.string().uuid(),
    moldId: z.string().uuid(),
    case: DesignLayer.optional(),
    shirt: DesignLayer.optional(),
    garment: DesignLayer.optional(),
    secondary_garment: DesignLayer.optional(),
  })
  .strict();

async function validateDesignJson(
  input: unknown,
  expected: {
    orderId: string;
    orderItemId?: string;
    modelId: string;
    allowGarment: boolean;
    allowSecondaryGarment: boolean;
  },
): Promise<{ clean: Record<string, unknown>; versions: { editor: string; template: string; mold: string } }> {
  const serialized = JSON.stringify(input ?? {});
  if (serialized.length > 100 * 1024) {
    throw new Error("Diseño demasiado grande");
  }
  if (/<script|<\/script|blob:|data:|javascript:|https?:\/\//i.test(serialized)) {
    throw new Error("Diseño contiene contenido no permitido");
  }
  if (/[<>]/.test(serialized)) {
    throw new Error("Diseño contiene marcado no permitido");
  }
  const parsed = DesignJsonSchema.parse(input);
  if (parsed.modelId !== expected.modelId) {
    throw new Error("El diseño no corresponde al modelo del pedido");
  }
  if (!expected.allowGarment && (parsed.shirt || parsed.garment)) {
    throw new Error("Este pack no admite diseño de prenda");
  }
  if (!expected.allowSecondaryGarment && parsed.secondary_garment) {
    throw new Error("Este pack no admite segunda prenda");
  }

  // §6/§9 assetRef must correspond to an authorization uploaded/finalized for
  // this order and matching kind.
  const layerRefs: Array<{ kind: DesignKind; ref: string }> = [];
  if (parsed.case?.assetRef) layerRefs.push({ kind: "case", ref: parsed.case.assetRef });
  if (parsed.shirt?.assetRef) layerRefs.push({ kind: "garment", ref: parsed.shirt.assetRef });
  if (parsed.garment?.assetRef) layerRefs.push({ kind: "garment", ref: parsed.garment.assetRef });
  if (parsed.secondary_garment?.assetRef) layerRefs.push({ kind: "secondary_garment", ref: parsed.secondary_garment.assetRef });
  if (layerRefs.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let authQuery = supabaseAdmin
      .from("order_upload_authorizations")
      .select("storage_path,kind,status,expires_at")
      .eq("order_id", expected.orderId)
      .in("storage_path", layerRefs.map((r) => r.ref));
    if (expected.orderItemId) authQuery = authQuery.eq("order_item_id", expected.orderItemId);
    const { data: auths } = await authQuery;
    const now = Date.now();
    for (const r of layerRefs) {
      const row = (auths ?? []).find((a: any) => a.storage_path === r.ref);
      if (!row) throw new Error(`assetRef no autorizado: ${r.kind}`);
      if (row.kind !== r.kind) throw new Error(`assetRef con tipo incorrecto: ${r.kind}`);
      if (!["uploaded", "finalized"].includes(row.status as string)) {
        throw new Error(`assetRef no subido: ${r.kind}`);
      }
      if (new Date(row.expires_at as string).getTime() < now && row.status !== "finalized") {
        throw new Error(`assetRef expirado: ${r.kind}`);
      }
    }
  }

  return {
    clean: { ...parsed, validated_at: new Date().toISOString() },
    versions: {
      editor: parsed.editor_schema_version,
      template: parsed.template_version,
      mold: parsed.moldId,
    },
  };
}




// ------------------------------------------------------------------

export type PaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  rejected: ["pending", "cancelled"],
  cancelled: ["pending"],
  approved: ["refunded", "charged_back"],
  refunded: [],
  charged_back: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function mapMpStatus(s: string): PaymentStatus {
  switch (s) {
    case "approved":
      return "approved";
    case "in_process":
    case "pending":
    case "authorized":
      return "pending";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    default:
      return "pending";
  }
}

// ------------------------------------------------------------------
// Input schemas
// ------------------------------------------------------------------

const PackType = z.enum([
  "carcasa",
  "carcasa+polera",
  "carcasa+poleron",
  "carcasa+polera+poleron",
]);

const CustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(4).max(40),
  address: z.string().trim().min(3).max(255),
  comuna: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).optional().default(""),
});

const OrderItemSelectionInput = z.object({
  packId: z.string().uuid().nullable().optional(),
  packType: PackType,
  phoneModelId: z.string().uuid(),
  brand: z.string().max(120).nullable().optional(),
  garmentId: z.string().uuid().nullable().optional(),
  garmentSize: z.string().max(20).nullable().optional(),
  garmentColor: z.string().max(60).nullable().optional(),
  secondaryGarmentId: z.string().uuid().nullable().optional(),
  secondaryGarmentSize: z.string().max(20).nullable().optional(),
  secondaryGarmentColor: z.string().max(60).nullable().optional(),
});

const CreateOrderInput = OrderItemSelectionInput;

const UpdateOrderCustomerInput = z.object({
  orderId: z.string().uuid(),
  customer: CustomerSchema,
});

type OrderItemSelection = z.infer<typeof OrderItemSelectionInput>;

type CanonicalOrderItemPayload = {
  pack_id: string;
  pack_type: z.infer<typeof PackType>;
  brand_id: string;
  brand: string;
  phone_model_id: string;
  phone_model: string;
  garment_id: string | null;
  garment_size: string | null;
  garment_color: string | null;
  secondary_garment_id: string | null;
  secondary_garment_size: string | null;
  secondary_garment_color: string | null;
  base_price: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  catalog_snapshot: Record<string, unknown>;
};

function fingerprintOrderItem(payload: CanonicalOrderItemPayload): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

async function resolveCanonicalOrderItem(
  selection: OrderItemSelection,
): Promise<CanonicalOrderItemPayload> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isValidGarmentPrintArea } = await import("@/lib/garment-model");

  let packQuery = supabaseAdmin
    .from("promo_packs")
    .select("id,pack_type,price,sale_price,is_active")
    .eq("is_active", true);
  packQuery = selection.packId
    ? packQuery.eq("id", selection.packId)
    : packQuery.eq("pack_type", selection.packType).order("sort_order").limit(1);
  const { data: pack } = await packQuery.maybeSingle();
  if (!pack || pack.pack_type !== selection.packType) throw new Error("Pack no disponible");

  const { data: model } = await supabaseAdmin
    .from("phone_models")
    .select("id,name,slug,is_active,mold_status,brand_id,print_area,mockup_url")
    .eq("id", selection.phoneModelId)
    .maybeSingle();
  if (
    !model || !model.is_active || model.mold_status !== "listo" ||
    !model.print_area || typeof model.print_area !== "object" || !model.mockup_url
  ) throw new Error("Modelo no disponible");

  const { data: brand } = await supabaseAdmin
    .from("brands")
    .select("id,name,is_active")
    .eq("id", model.brand_id)
    .maybeSingle();
  if (!brand || !brand.is_active) throw new Error("Marca no disponible");

  type Garment = {
    id: string; type: string; name: string; color: string; sizes: string[];
    is_active: boolean; mold_status: string; view: string; mockup_url: string | null;
    base_url: string | null; overlay_url: string | null; preview_url: string | null;
    print_area: unknown; source_width: number | null; source_height: number | null;
  };
  async function garment(
    id: string,
    expectedType: "polera" | "poleron",
    requestedSize: string | null | undefined,
  ): Promise<{ row: Garment; size: string }> {
    const { data } = await supabaseAdmin.from("garments")
      .select("id,type,name,color,sizes,is_active,mold_status,view,mockup_url,base_url,overlay_url,preview_url,print_area,source_width,source_height")
      .eq("id", id).maybeSingle();
    const row = data as Garment | null;
    if (
      !row || row.type !== expectedType || !row.is_active || row.mold_status !== "listo" ||
      row.view !== "front" || !row.mockup_url || !isValidGarmentPrintArea(row.print_area)
    ) throw new Error("Prenda no disponible");
    const index = row.sizes.map((size) => size.trim().toUpperCase())
      .indexOf((requestedSize ?? "").trim().toUpperCase());
    if (index < 0) throw new Error("Talla de prenda inválida");
    return { row, size: row.sizes[index] };
  }

  let primary: { row: Garment; size: string } | null = null;
  let secondary: { row: Garment; size: string } | null = null;
  if (selection.packType === "carcasa") {
    if (selection.garmentId || selection.secondaryGarmentId) throw new Error("Este pack no admite prendas");
  } else if (selection.packType === "carcasa+polera+poleron") {
    if (!selection.garmentId || !selection.secondaryGarmentId) throw new Error("Faltan prendas del pack");
    if (selection.garmentId === selection.secondaryGarmentId) throw new Error("Las prendas deben ser diferentes");
    primary = await garment(selection.garmentId, "polera", selection.garmentSize);
    secondary = await garment(selection.secondaryGarmentId, "poleron", selection.secondaryGarmentSize);
  } else {
    if (!selection.garmentId || selection.secondaryGarmentId) throw new Error("Selección de prendas inválida");
    primary = await garment(
      selection.garmentId,
      selection.packType === "carcasa+polera" ? "polera" : "poleron",
      selection.garmentSize,
    );
  }

  const basePrice = Math.round(Number(pack.price));
  const effectivePrice = Math.round(Number(pack.sale_price ?? pack.price));
  if (!Number.isSafeInteger(basePrice) || !Number.isSafeInteger(effectivePrice)
      || basePrice <= 0 || effectivePrice <= 0 || effectivePrice > basePrice) {
    throw new Error("Precio canónico inválido");
  }
  const discount = Math.max(0, basePrice - effectivePrice);
  const snapshotGarment = (selected: typeof primary) => selected ? {
    id: selected.row.id, type: selected.row.type, name: selected.row.name,
    color: selected.row.color, size: selected.size, view: selected.row.view,
    print_area: selected.row.print_area, base_url: selected.row.base_url,
    overlay_url: selected.row.overlay_url, mockup_url: selected.row.mockup_url,
    preview_url: selected.row.preview_url, source_width: selected.row.source_width,
    source_height: selected.row.source_height,
  } : null;

  return {
    pack_id: pack.id,
    pack_type: selection.packType,
    brand_id: brand.id,
    brand: brand.name,
    phone_model_id: model.id,
    phone_model: model.name,
    garment_id: primary?.row.id ?? null,
    garment_size: primary?.size ?? null,
    garment_color: primary?.row.color ?? null,
    secondary_garment_id: secondary?.row.id ?? null,
    secondary_garment_size: secondary?.size ?? null,
    secondary_garment_color: secondary?.row.color ?? null,
    base_price: basePrice,
    unit_price: effectivePrice,
    discount_amount: discount,
    line_total: effectivePrice,
    catalog_snapshot: {
      pack: { id: pack.id, type: pack.pack_type, price: basePrice, sale_price: pack.sale_price },
      brand: { id: brand.id, name: brand.name },
      model: { id: model.id, name: model.name, slug: model.slug, mold_status: model.mold_status, print_area: model.print_area },
      garment: snapshotGarment(primary),
      secondaryGarment: snapshotGarment(secondary),
      captured_at: new Date().toISOString(),
    },
  };
}

// ------------------------------------------------------------------
// createSecureOrder — creates the order and opens the HttpOnly cookie
// session in the same call. No token in the URL.
// ------------------------------------------------------------------

export const createSecureOrder = createServerFn({ method: "POST" })
  .inputValidator((i) => CreateOrderInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const req = getRequest();
    await enforceRateLimit(
      "create_order",
      hashBucketKey("create_order_ip", ipHashFromRequest(req)),
      RATE_LIMITS.create_order.limit,
      RATE_LIMITS.create_order.window,
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type PackRow = {
      id: string;
      pack_type: string;
      price: number;
      sale_price: number | null;
      is_active: boolean;
    };
    let packRow: PackRow | null = null;

    if (data.packId) {
      const { data: p } = await supabaseAdmin
        .from("promo_packs")
        .select("id,pack_type,price,sale_price,is_active")
        .eq("id", data.packId)
        .maybeSingle();
      if (!p) throw new Error("Pack no encontrado");
      packRow = p as PackRow;
    } else {
      const { data: p } = await supabaseAdmin
        .from("promo_packs")
        .select("id,pack_type,price,sale_price,is_active")
        .eq("pack_type", data.packType)
        .eq("is_active", true)
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      if (!p) throw new Error("Pack no disponible");
      packRow = p as PackRow;
    }
    if (!packRow.is_active) throw new Error("Pack no disponible");
    if (packRow.pack_type !== data.packType)
      throw new Error("Tipo de pack no coincide");

    // §8 Full catalog resolution — never trust client text.
    const { data: model } = await supabaseAdmin
      .from("phone_models")
      .select("id,name,slug,is_active,mold_status,brand_id,print_area,mockup_url,mask_url,overlay_url")
      .eq("id", data.phoneModelId)
      .maybeSingle();
    if (!model) throw new Error("Modelo no encontrado");
    if (!model.is_active) throw new Error("Modelo inactivo");
    if (model.mold_status !== "listo") throw new Error("Molde del modelo no está listo");
    if (!model.print_area || typeof model.print_area !== "object") {
      throw new Error("El modelo no tiene área de impresión configurada");
    }
    if (!model.mockup_url) throw new Error("El modelo no tiene mockup configurado");

    const { data: brandRow } = await supabaseAdmin
      .from("brands")
      .select("id,name,is_active")
      .eq("id", model.brand_id)
      .maybeSingle();
    if (!brandRow) throw new Error("Marca no encontrada");

    // Pack compatibility: only "carcasa" allows no garment. Anything else
    // requires a valid, active garment matching the pack type.
    const isCaseOnly = packRow.pack_type === "carcasa";
    const isCompletePack = packRow.pack_type === "carcasa+polera+poleron";
    type GarmentRow = {
      id: string; type: string; name: string; color: string; sizes: string[];
      price: number; is_active: boolean; mold_status: string; view: string;
      mockup_url: string | null; base_url: string | null; overlay_url: string | null;
      preview_url: string | null; print_area: unknown;
      source_width: number | null; source_height: number | null;
    };
    const { isValidGarmentPrintArea } = await import("@/lib/garment-model");
    async function resolveGarmentById(
      garmentId: string,
      expectedType: "polera" | "poleron",
      requestedSize: string | null | undefined,
      fieldPrefix: "GARMENT" | "SECONDARY_GARMENT",
    ): Promise<{ row: GarmentRow; canonicalSize: string }> {
      const { data: g } = await supabaseAdmin
        .from("garments")
        .select("id,type,name,color,sizes,price,is_active,mold_status,view,mockup_url,base_url,overlay_url,preview_url,print_area,source_width,source_height")
        .eq("id", garmentId)
        .maybeSingle();
      if (!g) throw new Error(`${fieldPrefix}_NOT_AVAILABLE`);
      const gr = g as GarmentRow;
      if (
        gr.id !== garmentId ||
        gr.type !== expectedType ||
        !gr.is_active ||
        gr.mold_status !== "listo" ||
        gr.view !== "front" ||
        !gr.mockup_url ||
        !isValidGarmentPrintArea(gr.print_area)
      ) {
        throw new Error(`${fieldPrefix}_NOT_AVAILABLE`);
      }
      const sizesNorm = gr.sizes.map((s) => s.trim().toUpperCase());
      const rawSize = (requestedSize ?? "").trim();
      if (!rawSize) throw new Error(`INVALID_${fieldPrefix}_SIZE`);
      const sizeIdx = sizesNorm.indexOf(rawSize.toUpperCase());
      if (sizeIdx === -1) throw new Error(`INVALID_${fieldPrefix}_SIZE`);
      return { row: gr, canonicalSize: gr.sizes[sizeIdx] };
    }

    let garmentRow: GarmentRow | null = null;
    let secondaryGarmentRow: GarmentRow | null = null;
    let canonicalGarmentSize: string | null = null;
    let canonicalSecondarySize: string | null = null;

    const hasAnyGarmentField =
      data.garmentId != null || data.garmentSize != null || data.garmentColor != null;
    const hasAnySecondaryField =
      data.secondaryGarmentId != null ||
      data.secondaryGarmentSize != null ||
      data.secondaryGarmentColor != null;

    if (isCaseOnly) {
      if (hasAnyGarmentField || hasAnySecondaryField) {
        throw new Error("INVALID_GARMENT_FIELDS_FOR_CASE_ONLY_PACK");
      }
    } else if (isCompletePack) {
      if (hasAnySecondaryField && !data.secondaryGarmentId) {
        throw new Error("SECONDARY_GARMENT_ID_REQUIRED");
      }
      if (!data.garmentId) throw new Error("GARMENT_ID_REQUIRED");
      if (!data.secondaryGarmentId) throw new Error("SECONDARY_GARMENT_ID_REQUIRED");
      if (data.garmentId === data.secondaryGarmentId) {
        throw new Error("GARMENT_IDS_MUST_DIFFER");
      }
      const primary = await resolveGarmentById(
        data.garmentId, "polera", data.garmentSize, "GARMENT",
      );
      const secondary = await resolveGarmentById(
        data.secondaryGarmentId, "poleron", data.secondaryGarmentSize, "SECONDARY_GARMENT",
      );
      garmentRow = primary.row;
      canonicalGarmentSize = primary.canonicalSize;
      secondaryGarmentRow = secondary.row;
      canonicalSecondarySize = secondary.canonicalSize;
      data.garmentSize = canonicalGarmentSize;
      data.garmentColor = garmentRow.color;
      data.secondaryGarmentSize = canonicalSecondarySize;
      data.secondaryGarmentColor = secondaryGarmentRow.color;
    } else {
      // carcasa+polera or carcasa+poleron
      if (hasAnySecondaryField) {
        throw new Error("INVALID_SECONDARY_GARMENT_FIELDS");
      }
      const expectedType = packRow.pack_type === "carcasa+polera" ? "polera" : "poleron";
      if (!data.garmentId) throw new Error("GARMENT_ID_REQUIRED");
      const primary = await resolveGarmentById(
        data.garmentId, expectedType, data.garmentSize, "GARMENT",
      );
      garmentRow = primary.row;
      canonicalGarmentSize = primary.canonicalSize;
      data.garmentSize = canonicalGarmentSize;
      data.garmentColor = garmentRow.color;
    }

    const basePrice = Number(packRow.price);
    const effective =
      packRow.sale_price != null ? Number(packRow.sale_price) : basePrice;
    const subtotal = Math.round(effective);
    const discount = Math.max(0, Math.round(basePrice - effective));
    const shippingResult = await computeCanonicalShipping(data.packType, "shipping");
    const shipping = shippingResult.amount;
    const total = subtotal + shipping;
    if (total <= 0) throw new Error("Total inválido");

    const { data: numRow } = await supabaseAdmin.rpc("next_order_number");
    if (!numRow) throw new Error("No se pudo generar el número de pedido");
    const orderNumber = numRow as unknown as string;
    const publicToken = generateOpaqueToken();
    const tokenHash = hashToken(publicToken);

    function garmentSnapshot(row: GarmentRow | null, size: string | null) {
      if (!row) return null;
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        color: row.color,
        size,
        view: row.view,
        print_area: row.print_area,
        base_url: row.base_url,
        overlay_url: row.overlay_url,
        mockup_url: row.mockup_url,
        preview_url: row.preview_url,
        source_width: row.source_width,
        source_height: row.source_height,
      };
    }

    const catalogSnapshot = {
      pack: {
        id: packRow.id,
        type: packRow.pack_type,
        price: basePrice,
        sale_price: packRow.sale_price ?? null,
      },
      brand: { id: brandRow.id, name: brandRow.name },
      model: {
        id: model.id,
        name: model.name,
        slug: model.slug,
        mold_status: model.mold_status,
        print_area: model.print_area,
      },
      garment: garmentSnapshot(garmentRow, canonicalGarmentSize),
      secondaryGarment: garmentSnapshot(secondaryGarmentRow, canonicalSecondarySize),
      shipping: { rule: shippingResult.rule, amount: shipping },
      captured_at: new Date().toISOString(),
    };

    const orderPayload = {
        order_number: orderNumber,
        public_access_token_hash: tokenHash,
        pack_id: packRow.id,
        pack_type: data.packType,
        brand: brandRow.name,
        brand_id: brandRow.id,
        phone_model: model.name,
        phone_model_id: model.id,
        garment_id: garmentRow?.id ?? null,
        garment_size: garmentRow ? canonicalGarmentSize : null,
        garment_color: garmentRow ? garmentRow.color : null,
        secondary_garment_id: secondaryGarmentRow?.id ?? null,
        secondary_garment_size: secondaryGarmentRow ? canonicalSecondarySize : null,
        secondary_garment_color: secondaryGarmentRow ? secondaryGarmentRow.color : null,
        // customer_email is NOT NULL in the current schema. An empty value is
        // the draft sentinel; no customer identity is fabricated before checkout.
        customer_name: null,
        customer_email: "",
        customer_phone: null,
        shipping_address: { delivery_method: "shipping" },
        notes: null,
        subtotal_amount: subtotal,
        discount_amount: discount,
        shipping_amount: shipping,
        total_amount: total,
        currency: "CLP",
        status: "pendiente_pago",
        payment_status: "pending",
        fulfillment_status: "new",
        payment_provider: "shopify",
        design_status: "pending",
        catalog_snapshot: catalogSnapshot,
        payment_environment: getServerConfig().mpEnv,
        is_live_mode: getServerConfig().isLiveMode,
      };

    // Transitional dual-write: legacy product columns remain populated above,
    // while the first active product is also persisted as order_items position 0.
    const initialItem: CanonicalOrderItemPayload = {
      pack_id: packRow.id,
      pack_type: data.packType,
      brand_id: brandRow.id,
      brand: brandRow.name,
      phone_model_id: model.id,
      phone_model: model.name,
      garment_id: garmentRow?.id ?? null,
      garment_size: garmentRow ? canonicalGarmentSize : null,
      garment_color: garmentRow?.color ?? null,
      secondary_garment_id: secondaryGarmentRow?.id ?? null,
      secondary_garment_size: secondaryGarmentRow ? canonicalSecondarySize : null,
      secondary_garment_color: secondaryGarmentRow?.color ?? null,
      base_price: Math.round(basePrice),
      unit_price: subtotal,
      discount_amount: discount,
      line_total: subtotal,
      catalog_snapshot: catalogSnapshot,
    };
    const sessionToken = generateOpaqueToken(32);
    const sessionHash = hashToken(sessionToken);
    const csrfToken = generateCsrfToken();
    const csrfHash = hashCsrfToken(csrfToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const absExp = new Date(Date.now() + SESSION_ABSOLUTE_TTL_SECONDS * 1000);
    const { data: created, error: createError } = await (supabaseAdmin as any).rpc(
      "create_order_with_first_item_v1",
      {
        p_order: orderPayload,
        p_client_item_key: "initial-order-item",
        p_request_fingerprint: fingerprintOrderItem(initialItem),
        p_item: initialItem,
        p_session_token_hash: sessionHash,
        p_csrf_token_hash: csrfHash,
        p_session_expires_at: expiresAt.toISOString(),
        p_session_absolute_expires_at: absExp.toISOString(),
      },
    );
    const createdRow = created as {
      order_id?: string;
      order_number?: string | null;
      session_id?: string;
      item?: { id?: string };
    } | null;
    if (createError || !createdRow?.order_id || !createdRow.session_id || !createdRow.item?.id) {
      console.error("[createSecureOrder] atomic create failed", createError?.message);
      throw new Error("No se pudo crear el pedido");
    }
    setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    const { issueSignedCsrfToken } = await import("@/lib/csrf-signed");
    const signedCsrf = issueSignedCsrfToken(
      createdRow.session_id,
      createdRow.order_id,
    );

    return {
      id: createdRow.order_id,
      orderItemId: createdRow.item.id,
      orderNumber: createdRow.order_number,
      csrfToken: signedCsrf,
    };
  });

// ------------------------------------------------------------------
// Design upload lifecycle: signed URLs into a private bucket,
// session-scoped, path-validated.
// ------------------------------------------------------------------

const DESIGN_BUCKET = "order-designs";
const PREVIEW_SIGNED_URL_TTL_SECONDS = 60 * 60;
const DESIGN_MAX_BYTES = 15 * 1024 * 1024;
const DESIGN_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const DESIGN_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const RequestUploadInput = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(["case", "garment", "secondary_garment"]),
  contentType: z.string().max(80),
  size: z.number().int().positive().max(DESIGN_MAX_BYTES),
});

// Design is mutable only when the order is not in a locked payment state,
// the design itself is not locked (payment attempt in progress), and there is
// no active/awaiting_reconciliation payment attempt.
async function assertDesignMutable(orderId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("custom_orders")
    .select("id,payment_status,design_status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error("Pedido no encontrado");
  const ps = order.payment_status as PaymentStatus;
  if (ps === "approved" || ps === "refunded" || ps === "charged_back") {
    throw new Error("Pedido en estado bloqueado; el diseño no puede modificarse");
  }
  const ds = (order as any).design_status as string;
  if (ds === "locked") {
    throw new Error("Diseño bloqueado por un pago en curso");
  }
  const { data: active } = await supabaseAdmin
    .from("payment_attempts")
    .select("id")
    .eq("order_id", orderId)
    .in("status", ["processing", "pending", "awaiting_reconciliation"])
    .maybeSingle();
  if (active) throw new Error("Hay un intento de pago activo; el diseño no puede modificarse");
}

export const requestDesignUpload = createServerFn({ method: "POST" })
  .inputValidator((i) => RequestUploadInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;
    await enforceRateLimit(
      "request_upload",
      hashBucketKey("request_upload_order", orderId),
      RATE_LIMITS.request_upload.limit,
      RATE_LIMITS.request_upload.window,
    );
    if (!DESIGN_ALLOWED_MIME.has(data.contentType)) {
      throw new Error("Tipo de archivo no permitido");
    }
    await assertDesignMutable(orderId);
    const ext = DESIGN_EXT[data.contentType]!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const path = `${orderId}/${data.kind}-${randomUUID()}.${ext}`;

    // §6 Record the authorization BEFORE issuing the signed URL — the
    // finalize step will verify this row and refuse any path not present.
    const { data: authIdRaw, error: authErr } = await supabaseAdmin.rpc(
      "issue_upload_authorization" as any,
      {
        p_order_id: orderId,
        p_session_id: sess.sessionId,
        p_kind: data.kind,
        p_storage_path: path,
        p_declared_mime: data.contentType,
        p_declared_size: data.size,
        p_ttl_seconds: 30 * 60,
      } as any,
    );
    if (authErr || !authIdRaw) {
      console.error("[requestDesignUpload] auth insert", authErr?.message);
      throw new Error("No se pudo autorizar la subida");
    }

    const { data: signed, error } = await (supabaseAdmin.storage
      .from(DESIGN_BUCKET) as any).createSignedUploadUrl(path);
    if (error || !signed) {
      console.error("[requestDesignUpload] sign failed", error?.message);
      await supabaseAdmin.rpc("reject_upload_authorization" as any, {
        p_storage_path: path,
        p_reason: "sign_failed",
      } as any);
      await supabaseAdmin
        .from("custom_orders")
        .update({ design_status: "failed" } as any)
        .eq("id", orderId);
      throw new Error("No se pudo autorizar la subida");
    }

    await supabaseAdmin
      .from("custom_orders")
      .update({ design_status: "uploading" } as any)
      .eq("id", orderId);

    return {
      path: signed.path as string,
      token: signed.token as string,
      bucket: DESIGN_BUCKET,
    };
  });

const FinalizeInput = z.object({
  orderId: z.string().uuid(),
  casePath: z.string().min(1).max(300),
  garmentPath: z.string().min(1).max(300).nullable().optional(),
  secondaryGarmentPath: z.string().min(1).max(300).nullable().optional(),
  designJson: z.record(z.unknown()).optional().default({}),
});

export const finalizeOrderDesigns = createServerFn({ method: "POST" })
  .inputValidator((i) => FinalizeInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;
    await enforceRateLimit(
      "finalize_design",
      hashBucketKey("finalize_design_order", orderId),
      RATE_LIMITS.finalize_design.limit,
      RATE_LIMITS.finalize_design.window,
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve pack_type securely BEFORE choosing the RPC route.
    const { data: orderRow } = await supabaseAdmin
      .from("custom_orders")
      .select("id,phone_model_id,pack_type")
      .eq("id", orderId)
      .maybeSingle();
    if (!orderRow) throw new Error("Pedido no encontrado");
    const packType = (orderRow as any).pack_type as string;
    const isCompletePack = packType === "carcasa+polera+poleron";
    const allowGarment = packType !== "carcasa";
    const allowSecondaryGarment = isCompletePack;

    // Canonical structure: {orderId}/{kind}-{uuid}.{ext}
    assertCanonicalDesignPath(data.casePath, orderId, "case");
    if (data.garmentPath) {
      assertCanonicalDesignPath(data.garmentPath, orderId, "garment");
    }
    if (data.secondaryGarmentPath) {
      assertCanonicalDesignPath(data.secondaryGarmentPath, orderId, "secondary_garment");
    }

    if (!allowGarment && data.garmentPath) {
      throw new Error("Este pack no admite prenda");
    }
    if (!allowSecondaryGarment && data.secondaryGarmentPath) {
      throw new Error("Este pack no admite segunda prenda");
    }
    if (isCompletePack) {
      if (!data.garmentPath) throw new Error("GARMENT_PATH_REQUIRED");
      if (!data.secondaryGarmentPath) throw new Error("SECONDARY_GARMENT_PATH_REQUIRED");
    }
    if (
      data.garmentPath &&
      (data.garmentPath === data.casePath ||
        data.garmentPath === data.secondaryGarmentPath)
    ) {
      throw new Error("Rutas de diseño duplicadas");
    }
    if (
      data.secondaryGarmentPath &&
      data.secondaryGarmentPath === data.casePath
    ) {
      throw new Error("Rutas de diseño duplicadas");
    }

    // Rejects if the design is locked or there is an active payment attempt.
    await assertDesignMutable(orderId);

    type DetectedDims = { width: number; height: number; format: string };
    let lowResolution = false;
    const detected: Record<DesignKind, DetectedDims | null> = {
      case: null,
      garment: null,
      secondary_garment: null,
    };

    async function ensureObject(path: string, kind: DesignKind) {
      const parts = path.split("/");
      const filename = parts.pop()!;
      const dir = parts.join("/");
      const { data: list, error } = await supabaseAdmin.storage
        .from(DESIGN_BUCKET)
        .list(dir, { limit: 100, search: filename });
      if (error) throw new Error("No se pudo verificar la subida");
      const row = list?.find((r) => r.name === filename);
      if (!row) throw new Error("Archivo no encontrado en el bucket");
      const meta = row.metadata as { size?: number; mimetype?: string } | null;
      const declaredMime = meta?.mimetype ?? "";
      if (meta?.size && meta.size > IMAGE_LIMITS.MAX_BYTES) {
        throw new Error("Archivo demasiado grande");
      }
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from(DESIGN_BUCKET)
        .download(path);
      if (dlErr || !blob) throw new Error("No se pudo verificar el contenido");
      const totalBytes = (blob as Blob).size ?? 0;
      const head = new Uint8Array(await (blob as Blob).arrayBuffer());
      const ext = (path.split(".").pop() ?? "").toLowerCase();
      const result = detectAndValidateImage(head, totalBytes, declaredMime, ext);

      if (!result.ok) {
        throw new Error(`image_${result.code}`);
      }
      detected[kind] = {
        width: result.image.width,
        height: result.image.height,
        format: result.image.format,
      };
      if (result.warnings.lowResolution) lowResolution = true;

      const { data: consumed, error: cErr } = await supabaseAdmin.rpc(
        "consume_upload_authorization" as any,
        {
          p_storage_path: path,
          p_order_id: orderId,
          p_kind: kind,
          p_detected_format: result.image.format,
          p_detected_width: result.image.width,
          p_detected_height: result.image.height,
        } as any,
      );
      if (cErr) throw new Error("No se pudo consumir la autorización");
      const cRes = consumed as { ok: boolean; code?: string };
      if (!cRes?.ok) throw new Error(`auth_${cRes?.code ?? "unknown"}`);
    }

    async function rejectAndCleanup(reason: string) {
      const toRemove = [data.casePath];
      if (data.garmentPath) toRemove.push(data.garmentPath);
      if (data.secondaryGarmentPath) toRemove.push(data.secondaryGarmentPath);
      await supabaseAdmin.storage.from(DESIGN_BUCKET).remove(toRemove).catch(() => {});
      for (const p of toRemove) {
        await supabaseAdmin.rpc("reject_upload_authorization" as any, {
          p_storage_path: p,
          p_reason: reason,
        } as any);
      }
      await supabaseAdmin
        .from("custom_orders")
        .update({ design_status: "failed" } as any)
        .eq("id", orderId);
    }

    try {
      await ensureObject(data.casePath, "case");
      if (data.garmentPath) await ensureObject(data.garmentPath, "garment");
      if (data.secondaryGarmentPath) {
        await ensureObject(data.secondaryGarmentPath, "secondary_garment");
      }
    } catch (e) {
      await rejectAndCleanup((e as Error)?.message ?? "validation_failed");
      throw e;
    }

    let cleanDesign: Record<string, unknown>;
    let versions: { editor: string; template: string; mold: string };
    try {
      const validated = await validateDesignJson(data.designJson, {
        orderId,
        modelId: (orderRow as any).phone_model_id ?? "",
        allowGarment,
        allowSecondaryGarment,
      });
      cleanDesign = validated.clean;
      versions = validated.versions;
    } catch (e) {
      await rejectAndCleanup(`design_json_${(e as Error)?.message ?? "invalid"}`.slice(0, 200));
      throw e;
    }

    const caseDesign = (cleanDesign as any)?.case ?? null;
    const garmentDesign =
      (cleanDesign as any)?.shirt ?? (cleanDesign as any)?.garment ?? null;
    const secondaryGarmentDesign =
      (cleanDesign as any)?.secondary_garment ?? null;
    const metadata: Record<string, unknown> = {
      editor_schema_version: versions.editor,
      template_version: versions.template,
      mold_version: versions.mold,
      low_resolution_warning: lowResolution,
      case_dimensions: detected.case ?? {},
      garment_dimensions: detected.garment ?? {},
    };
    if (isCompletePack) {
      metadata.secondary_garment_dimensions = detected.secondary_garment ?? {};
    }

    if (isCompletePack) {
      const { data: finRaw, error: finErr } = await supabaseAdmin.rpc(
        "finalize_order_designs_v3" as any,
        {
          p_order_id: orderId,
          p_case_path: data.casePath,
          p_garment_path: data.garmentPath ?? null,
          p_secondary_garment_path: data.secondaryGarmentPath ?? null,
          p_case_design: caseDesign,
          p_garment_design: garmentDesign,
          p_secondary_garment_design: secondaryGarmentDesign,
          p_bucket: DESIGN_BUCKET,
          p_metadata: metadata,
        } as any,
      );
      if (finErr || !(finRaw as any)?.ok) {
        console.error("[finalizeOrderDesigns v3] rpc", finErr?.message);
        throw new Error("No se pudo finalizar el pedido");
      }
    } else {
      const { data: finRaw, error: finErr } = await supabaseAdmin.rpc(
        "finalize_order_designs" as any,
        {
          p_order_id: orderId,
          p_case_path: data.casePath,
          p_garment_path: data.garmentPath ?? null,
          p_case_design: caseDesign,
          p_garment_design: garmentDesign,
          p_bucket: DESIGN_BUCKET,
          p_metadata: metadata,
        } as any,
      );
      if (finErr || !(finRaw as any)?.ok) {
        console.error("[finalizeOrderDesigns] rpc", finErr?.message);
        throw new Error("No se pudo finalizar el pedido");
      }
    }

    return { ok: true as const, lowResolution };
  });

const RequestOrderItemUploadInput = RequestUploadInput.extend({
  orderItemId: z.string().uuid(),
});

function assertCanonicalOrderItemDesignPath(
  path: string,
  orderId: string,
  orderItemId: string,
  kind: DesignKind,
): void {
  const pattern = new RegExp(
    `^${orderId}/${orderItemId}/${kind}-[0-9a-f-]{36}\\.(png|jpg|webp)$`,
    "i",
  );
  if (!pattern.test(path) || path.includes("..") || path.includes("//")) {
    throw new Error("Ruta de diseño inválida");
  }
}

export const requestOrderItemDesignUpload = createServerFn({ method: "POST" })
  .inputValidator((input) => RequestOrderItemUploadInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceRateLimit(
      "request_upload",
      hashBucketKey("request_item_upload", session.orderId, data.orderItemId),
      RATE_LIMITS.request_upload.limit,
      RATE_LIMITS.request_upload.window,
    );
    if (!DESIGN_ALLOWED_MIME.has(data.contentType)) throw new Error("Tipo de archivo no permitido");
    await assertDesignMutable(session.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await supabaseAdmin.from("order_items")
      .select("id,order_id,pack_type,is_active")
      .eq("id", data.orderItemId).eq("order_id", session.orderId).maybeSingle();
    if (!item || !item.is_active) throw new Error("Producto no encontrado");
    if (data.kind === "garment" && item.pack_type === "carcasa") throw new Error("Este producto no admite prenda");
    if (data.kind === "secondary_garment" && item.pack_type !== "carcasa+polera+poleron") {
      throw new Error("Este producto no admite segunda prenda");
    }

    const ext = DESIGN_EXT[data.contentType]!;
    const path = `${session.orderId}/${data.orderItemId}/${data.kind}-${randomUUID()}.${ext}`;
    const { data: authId, error: authError } = await (supabaseAdmin as any).rpc(
      "issue_order_item_upload_authorization_v1",
      {
        p_order_id: session.orderId,
        p_order_item_id: data.orderItemId,
        p_session_id: session.sessionId,
        p_kind: data.kind,
        p_storage_path: path,
        p_declared_mime: data.contentType,
        p_declared_size: data.size,
        p_ttl_seconds: 30 * 60,
      },
    );
    if (authError || !authId) throw new Error("No se pudo autorizar la subida");
    const { data: signed, error: signError } = await (supabaseAdmin.storage
      .from(DESIGN_BUCKET) as any).createSignedUploadUrl(path);
    if (signError || !signed) throw new Error("No se pudo autorizar la subida");

    return { path: signed.path as string, token: signed.token as string, bucket: DESIGN_BUCKET };
  });

const FinalizeOrderItemInput = FinalizeInput.extend({
  orderItemId: z.string().uuid(),
  casePreviewPath: z.string().min(1).max(300),
  garmentPreviewPath: z.string().min(1).max(300).nullable().optional(),
  secondaryGarmentPreviewPath: z.string().min(1).max(300).nullable().optional(),
  originalFilenames: z.object({
    case: z.string().min(1).max(255),
    garment: z.string().min(1).max(255).optional(),
    secondary_garment: z.string().min(1).max(255).optional(),
  }),
});

export const finalizeOrderItemDesigns = createServerFn({ method: "POST" })
  .inputValidator((input) => FinalizeOrderItemInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceRateLimit(
      "finalize_design",
      hashBucketKey("finalize_item_design", session.orderId, data.orderItemId),
      RATE_LIMITS.finalize_design.limit,
      RATE_LIMITS.finalize_design.window,
    );
    await assertDesignMutable(session.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await supabaseAdmin.from("order_items")
      .select("id,order_id,pack_type,phone_model_id,is_active")
      .eq("id", data.orderItemId).eq("order_id", session.orderId).maybeSingle();
    if (!item || !item.is_active) throw new Error("Producto no encontrado");
    const allowGarment = item.pack_type !== "carcasa";
    const allowSecondaryGarment = item.pack_type === "carcasa+polera+poleron";
    assertCanonicalOrderItemDesignPath(data.casePath, session.orderId, data.orderItemId, "case");
    if (data.garmentPath) assertCanonicalOrderItemDesignPath(data.garmentPath, session.orderId, data.orderItemId, "garment");
    if (data.secondaryGarmentPath) {
      assertCanonicalOrderItemDesignPath(data.secondaryGarmentPath, session.orderId, data.orderItemId, "secondary_garment");
    }
    assertCanonicalOrderItemDesignPath(data.casePreviewPath, session.orderId, data.orderItemId, "case");
    if (data.garmentPreviewPath) assertCanonicalOrderItemDesignPath(data.garmentPreviewPath, session.orderId, data.orderItemId, "garment");
    if (data.secondaryGarmentPreviewPath) assertCanonicalOrderItemDesignPath(data.secondaryGarmentPreviewPath, session.orderId, data.orderItemId, "secondary_garment");
    if (!allowGarment && data.garmentPath) throw new Error("Este producto no admite prenda");
    if (allowGarment && !data.garmentPath) throw new Error("Falta el diseño de la prenda");
    if (!allowSecondaryGarment && data.secondaryGarmentPath) throw new Error("Segunda prenda no permitida");
    if (allowSecondaryGarment && !data.secondaryGarmentPath) throw new Error("Falta el diseño de la segunda prenda");

    const paths: Array<{ path: string; kind: DesignKind }> = [
      { path: data.casePath, kind: "case" },
      ...(data.garmentPath ? [{ path: data.garmentPath, kind: "garment" as const }] : []),
      ...(data.secondaryGarmentPath ? [{ path: data.secondaryGarmentPath, kind: "secondary_garment" as const }] : []),
    ];
    if (new Set(paths.map((entry) => entry.path)).size !== paths.length) throw new Error("Rutas de diseño duplicadas");

    let lowResolution = false;
    const detected: Record<DesignKind, { width: number; height: number; format: string } | null> = {
      case: null, garment: null, secondary_garment: null,
    };
    try {
      for (const entry of paths) {
        const blobResult = await supabaseAdmin.storage.from(DESIGN_BUCKET).download(entry.path);
        if (blobResult.error || !blobResult.data) throw new Error("Archivo no encontrado en el bucket");
        const blob = blobResult.data as Blob;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const ext = (entry.path.split(".").pop() ?? "").toLowerCase();
        const validation = detectAndValidateImage(bytes, blob.size, blob.type, ext);
        if (!validation.ok) throw new Error(`image_${validation.code}`);
        detected[entry.kind] = {
          width: validation.image.width,
          height: validation.image.height,
          format: validation.image.format,
        };
        if (validation.warnings.lowResolution) lowResolution = true;
        const { data: consumed, error } = await (supabaseAdmin as any).rpc(
          "consume_order_item_upload_authorization_v1",
          {
            p_order_id: session.orderId,
            p_order_item_id: data.orderItemId,
            p_session_id: session.sessionId,
            p_kind: entry.kind,
            p_storage_path: entry.path,
            p_detected_format: validation.image.format,
            p_detected_width: validation.image.width,
            p_detected_height: validation.image.height,
          },
        );
        if (error || !consumed?.ok) throw new Error("No se pudo consumir la autorización");
      }

      const previewEntries: Array<{ path: string; kind: DesignKind }> = [
        { path: data.casePreviewPath, kind: "case" },
        ...(data.garmentPreviewPath ? [{ path: data.garmentPreviewPath, kind: "garment" as const }] : []),
        ...(data.secondaryGarmentPreviewPath ? [{ path: data.secondaryGarmentPreviewPath, kind: "secondary_garment" as const }] : []),
      ];
      for (const entry of previewEntries) {
        const downloaded = await supabaseAdmin.storage.from(DESIGN_BUCKET).download(entry.path);
        if (downloaded.error || !downloaded.data) throw new Error("Preview no encontrada en el bucket");
        const previewBlob = downloaded.data as Blob;
        const previewBytes = new Uint8Array(await previewBlob.arrayBuffer());
        const previewExt = (entry.path.split(".").pop() ?? "").toLowerCase();
        const previewValidation = detectAndValidateImage(previewBytes, previewBlob.size, previewBlob.type, previewExt);
        if (!previewValidation.ok) throw new Error(`preview_${previewValidation.code}`);
        const { data: consumed, error } = await (supabaseAdmin as any).rpc(
          "consume_order_item_upload_authorization_v1",
          {
            p_order_id: session.orderId, p_order_item_id: data.orderItemId,
            p_session_id: session.sessionId, p_kind: entry.kind, p_storage_path: entry.path,
            p_detected_format: previewValidation.image.format,
            p_detected_width: previewValidation.image.width,
            p_detected_height: previewValidation.image.height,
          },
        );
        if (error || !consumed?.ok) throw new Error("No se pudo consumir la preview");
      }

      const validated = await validateDesignJson(data.designJson, {
        orderId: session.orderId,
        orderItemId: data.orderItemId,
        modelId: item.phone_model_id ?? "",
        allowGarment,
        allowSecondaryGarment,
      });
      const clean = validated.clean as any;
      const metadata = {
        editor_schema_version: validated.versions.editor,
        template_version: validated.versions.template,
        mold_version: validated.versions.mold,
        low_resolution_warning: lowResolution,
        case_dimensions: detected.case ?? {},
        garment_dimensions: detected.garment ?? {},
        secondary_garment_dimensions: detected.secondary_garment ?? {},
      };
      const { data: result, error } = await (supabaseAdmin as any).rpc(
        "finalize_order_item_designs_v1",
        {
          p_order_id: session.orderId,
          p_order_item_id: data.orderItemId,
          p_session_id: session.sessionId,
          p_case_path: data.casePath,
          p_garment_path: data.garmentPath ?? null,
          p_secondary_garment_path: data.secondaryGarmentPath ?? null,
          p_case_design: clean.case ?? null,
          p_garment_design: clean.shirt ?? clean.garment ?? null,
          p_secondary_garment_design: clean.secondary_garment ?? null,
          p_bucket: DESIGN_BUCKET,
          p_metadata: metadata,
        },
      );
      if (error || !result?.ok) throw new Error("No se pudo finalizar el producto");
      const { sanitizeOriginalFilename } = await import("@/lib/original-assets");
      const originals = [
        { kind: "case", path: data.casePath, filename: data.originalFilenames.case },
        ...(data.garmentPath ? [{ kind: "garment", path: data.garmentPath, filename: data.originalFilenames.garment! }] : []),
        ...(data.secondaryGarmentPath ? [{ kind: "secondary_garment", path: data.secondaryGarmentPath, filename: data.originalFilenames.secondary_garment! }] : []),
      ];
      for (const original of originals) {
        const auth = await supabaseAdmin.from("order_upload_authorizations")
          .select("declared_mime,declared_size").eq("order_id", session.orderId)
          .eq("order_item_id", data.orderItemId).eq("storage_path", original.path).maybeSingle();
        await supabaseAdmin.from("design_assets").update({
          file_size_bytes: auth.data?.declared_size ?? null,
          metadata: {
            bucket: DESIGN_BUCKET,
            original_filename: sanitizeOriginalFilename(original.filename),
            original_mime: auth.data?.declared_mime ?? null,
            asset_role: "customer_original",
          },
        } as any).eq("order_id", session.orderId).eq("order_item_id", data.orderItemId)
          .eq("kind", original.kind).eq("file_path", original.path);
      }
      const previewPaths = [data.casePreviewPath, data.garmentPreviewPath, data.secondaryGarmentPreviewPath].filter(Boolean) as string[];
      const previewRows = [
        ["case", data.casePreviewPath],
        ["garment", data.garmentPreviewPath],
        ["secondary_garment", data.secondaryGarmentPreviewPath],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([slot, storagePath]) => ({
        order_id: session.orderId,
        order_item_id: data.orderItemId,
        slot,
        storage_path: storagePath,
      }));
      const { error: previewError } = await (supabaseAdmin as any).from("order_item_previews")
        .upsert(previewRows, { onConflict: "order_item_id,slot" });
      if (previewError) throw new Error("No se pudieron persistir las previews del producto");
      // Keep the legacy columns populated during the compatibility window.
      await supabaseAdmin.from("final_designs").update({
        case_preview_url: data.casePreviewPath,
        garment_preview_url: data.garmentPreviewPath ?? null,
        secondary_garment_preview_url: data.secondaryGarmentPreviewPath ?? null,
      } as any).eq("order_id", session.orderId).eq("order_item_id", data.orderItemId);
      await supabaseAdmin.from("order_upload_authorizations").update({ status: "finalized", finalized_at: new Date().toISOString() } as any)
        .eq("order_id", session.orderId).eq("order_item_id", data.orderItemId).in("storage_path", previewPaths);
      return { ok: true as const, lowResolution };
    } catch (error) {
      // Best effort only; the RPC refuses to mutate an item if payment became
      // active between browser validation and this failure path.
      await (supabaseAdmin as any).rpc("mark_order_item_design_failed_v1", {
        p_order_id: session.orderId,
        p_order_item_id: data.orderItemId,
      });
      throw error;
    }
  });


const MarkFailedInput = z.object({ orderId: z.string().uuid() });
export const markOrderDesignFailed = createServerFn({ method: "POST" })
  .inputValidator((i) => MarkFailedInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;
    await enforceRateLimit(
      "mark_failed",
      hashBucketKey("mark_failed_order", orderId),
      RATE_LIMITS.mark_failed.limit,
      RATE_LIMITS.mark_failed.window,
    );
    await assertDesignMutable(orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("custom_orders")
      .update({ design_status: "failed" } as any)
      .eq("id", orderId);
    return { ok: true as const };
  });

const UnlockDesignInput = z.object({ orderId: z.string().uuid() });
export const unlockOrderDesign = createServerFn({ method: "POST" })
  .inputValidator((i) => UnlockDesignInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rpc, error } = await supabaseAdmin.rpc(
      "unlock_order_design" as any,
      { p_order_id: orderId } as any,
    );
    if (error) {
      console.error("[unlockOrderDesign]", error.message);
      throw new Error("No se pudo desbloquear el diseño");
    }
    return rpc as { ok: boolean; code: string; design_status?: string };
  });

// ------------------------------------------------------------------
// Session exchange (cookie-based)
// ------------------------------------------------------------------
// The client opens /pedido/:id?token=XXX once. This function verifies the
// token, creates a short-lived session bound to that single order, sets an
// HttpOnly cookie and returns. The client then removes the token from the URL.

const ExchangeInput = z.object({
  orderId: z.string().uuid(),
  token: z.string().min(20).max(200),
});

// Persistent rate limits now via public.rate_limits + consume_rate_limit.
// (In-memory helpers removed — they were per-worker and could be bypassed.)

export const exchangeOrderToken = createServerFn({ method: "POST" })
  .inputValidator((i) => ExchangeInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    await enforceRateLimit(
      "exchange_token",
      hashBucketKey("exchange_token_order", data.orderId),
      RATE_LIMITS.exchange_token.limit,
      RATE_LIMITS.exchange_token.window,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("custom_orders")
      .select("id,public_access_token_hash")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order?.public_access_token_hash) throw new Error("Token inválido");
    const provided = hashToken(data.token);
    const { verifyOrderEmailAccessToken } = await import("@/lib/order-email-access");
    const validPublicToken = constantTimeEq(order.public_access_token_hash, provided);
    const validEmailToken = verifyOrderEmailAccessToken(
      data.token, order.id, order.public_access_token_hash,
    );
    if (!validPublicToken && !validEmailToken) {
      throw new Error("Token inválido");
    }

    const sessionToken = generateOpaqueToken(32);
    const sessionHash = hashToken(sessionToken);
    const csrfToken = generateCsrfToken();
    const csrfHash = hashCsrfToken(csrfToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const absExp = new Date(Date.now() + SESSION_ABSOLUTE_TTL_SECONDS * 1000);

    const { data: sessRow, error: insErr } = await supabaseAdmin
      .from("payment_sessions")
      .insert({
        order_id: order.id,
        session_token_hash: sessionHash,
        csrf_token_hash: csrfHash,
        expires_at: expiresAt.toISOString(),
        absolute_expires_at: absExp.toISOString(),
      } as any)
      .select("id")
      .single();
    if (insErr || !sessRow) throw new Error("No se pudo iniciar la sesión del pedido");

    setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    const { issueSignedCsrfToken } = await import("@/lib/csrf-signed");
    const signedCsrf = issueSignedCsrfToken(
      (sessRow as { id: string }).id,
      order.id,
    );
    return { ok: true as const, orderId: order.id, csrfToken: signedCsrf };
  });

// Resolve a valid session for a given orderId. Returns id + csrf hash.
async function requireOrderSessionWithId(
  orderId: string,
): Promise<{ orderId: string; sessionId: string; csrfTokenHash: string | null }> {
  const raw = getCookie(SESSION_COOKIE);
  if (!raw) throw new Error("Sesión no encontrada");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const hash = hashToken(raw);
  const { data: session } = await supabaseAdmin
    .from("payment_sessions")
    .select(
      "id,order_id,expires_at,absolute_expires_at,revoked_at,csrf_token_hash",
    )
    .eq("session_token_hash", hash)
    .maybeSingle();
  if (!session) throw new Error("Sesión inválida");
  const s = session as any;
  if (s.revoked_at) throw new Error("Sesión revocada");
  const now = Date.now();
  if (new Date(s.expires_at).getTime() < now) throw new Error("Sesión expirada");
  if (s.absolute_expires_at && new Date(s.absolute_expires_at).getTime() < now) {
    throw new Error("Sesión expirada");
  }
  if (s.order_id !== orderId) throw new Error("Sesión no autorizada");

  // Sliding renewal, capped by absolute_expires_at.
  const remaining = new Date(s.expires_at).getTime() - now;
  const absCap = s.absolute_expires_at
    ? new Date(s.absolute_expires_at).getTime()
    : now + SESSION_ABSOLUTE_TTL_SECONDS * 1000;
  const patch: Record<string, string> = { last_seen_at: new Date(now).toISOString() };
  if (remaining < SESSION_RENEW_THRESHOLD_S * 1000) {
    const newExp = Math.min(now + SESSION_TTL_SECONDS * 1000, absCap);
    patch.expires_at = new Date(newExp).toISOString();
  }
  await supabaseAdmin.from("payment_sessions").update(patch as any).eq("id", s.id);
  return {
    orderId: s.order_id,
    sessionId: s.id,
    csrfTokenHash: (s.csrf_token_hash as string | null) ?? null,
  };
}

async function requireOrderSession(orderId: string): Promise<string> {
  const s = await requireOrderSessionWithId(orderId);
  return s.orderId;
}

const AnalyticsPurchaseInput = z.object({
  orderId: z.string().uuid(),
  sessionId: z.string().regex(/^vs_s_[A-Za-z0-9_-]{16,80}$/),
  anonymousId: z.string().regex(/^vs_a_[A-Za-z0-9_-]{16,80}$/),
});

// Analytics-only bridge: reuses the canonical HttpOnly order session and never
// trusts browser payment state, amount, currency or line items.
export const claimApprovedPurchase = createServerFn({ method: "POST" })
  .inputValidator((i) => AnalyticsPurchaseInput.parse(i))
  .handler(async ({ data }) => {
    await requireOrderSession(data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc(
      "claim_approved_purchase_event" as any,
      { p_order_id: data.orderId, p_session_id: data.sessionId, p_anonymous_id: data.anonymousId } as any,
    );
    if (error) throw new Error("No se pudo registrar la compra");
    return result as any;
  });

/** Convenience: load session + enforce CSRF header for mutating fns. */
async function requireOrderSessionAndCsrf(
  orderId: string,
): Promise<{ orderId: string; sessionId: string }> {
  const s = await requireOrderSessionWithId(orderId);
  assertCsrfToken(s.csrfTokenHash, { sessionId: s.sessionId, orderId: s.orderId });
  return { orderId: s.orderId, sessionId: s.sessionId };
}


const OrderIdInput = z.object({ orderId: z.string().uuid() });

export const clearOrderSession = createServerFn({ method: "POST" })
  .handler(async () => {
    applyNoStoreHeaders();
    // Revoke session server-side, not just delete the cookie.
    const raw = getCookie(SESSION_COOKIE);
    if (raw) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const hash = hashToken(raw);
      const { data: s } = await supabaseAdmin
        .from("payment_sessions")
        .select("id")
        .eq("session_token_hash", hash)
        .maybeSingle();
      if (s?.id) {
        await supabaseAdmin.rpc("revoke_session" as any, { p_session_id: s.id } as any);
      }
    }
    deleteCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

/**
 * Returns a signed CSRF token bound to (sessionId, orderId). Stateless — does
 * not rotate any per-session hash, so multiple tabs and reloads coexist.
 * Cookie-only auth; no header required.
 */
export const getOrderCsrfToken = createServerFn({ method: "POST" })
  .inputValidator((i) => OrderIdInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionWithId(data.orderId);
    const { issueSignedCsrfToken } = await import("@/lib/csrf-signed");
    const csrfToken = issueSignedCsrfToken(sess.sessionId, data.orderId);
    return { csrfToken };
  });

// Multi-item cart engine. Mutations are session + CSRF scoped; the browser
// supplies selections only, never prices or totals.
const AddOrderItemInput = OrderItemSelectionInput.extend({
  orderId: z.string().uuid(),
  clientItemKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
});
const UpdateOrderItemInput = OrderItemSelectionInput.extend({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid(),
});
const RemoveOrderItemInput = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid(),
});

async function enforceCartMutationLimit(orderId: string): Promise<void> {
  await enforceRateLimit(
    "cart_mutation",
    hashBucketKey("cart_mutation_order", orderId),
    RATE_LIMITS.cart_mutation.limit,
    RATE_LIMITS.cart_mutation.window,
  );
}

export const addOrderItem = createServerFn({ method: "POST" })
  .inputValidator((input) => AddOrderItemInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceCartMutationLimit(session.orderId);
    const payload = await resolveCanonicalOrderItem(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("add_order_item_v1", {
      p_order_id: session.orderId,
      p_client_item_key: data.clientItemKey,
      p_request_fingerprint: fingerprintOrderItem(payload),
      p_item: payload,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const updateOrderItem = createServerFn({ method: "POST" })
  .inputValidator((input) => UpdateOrderItemInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceCartMutationLimit(session.orderId);
    const payload = await resolveCanonicalOrderItem(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("update_order_item_v1", {
      p_order_id: session.orderId,
      p_order_item_id: data.orderItemId,
      p_request_fingerprint: fingerprintOrderItem(payload),
      p_item: payload,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const removeOrderItem = createServerFn({ method: "POST" })
  .inputValidator((input) => RemoveOrderItemInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceCartMutationLimit(session.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: activeItems, error: activeItemsError } = await supabaseAdmin
      .from("order_items").select("id").eq("order_id", session.orderId).eq("is_active", true);
    if (activeItemsError) throw new Error("No se pudo consultar el carrito");
    if ((activeItems ?? []).length === 1 && activeItems?.[0]?.id === data.orderItemId) {
      const { data: cleared, error: clearError } = await (supabaseAdmin as any).rpc("clear_active_cart_v1", {
        p_order_id: session.orderId,
      });
      if (clearError) throw new Error(clearError.message);
      return cleared as any;
    }
    const { data: result, error } = await (supabaseAdmin as any).rpc("remove_order_item_v1", {
      p_order_id: session.orderId,
      p_order_item_id: data.orderItemId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const clearActiveCart = createServerFn({ method: "POST" })
  .inputValidator((input) => OrderIdInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const session = await requireOrderSessionAndCsrf(data.orderId);
    await enforceCartMutationLimit(session.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("clear_active_cart_v1", {
      p_order_id: session.orderId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const getCart = createServerFn({ method: "POST" })
  .inputValidator((input) => OrderIdInput.parse(input))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const orderId = await requireOrderSession(data.orderId);
    await enforceRateLimit(
      "order_read",
      hashBucketKey("order_read", orderId),
      RATE_LIMITS.order_read.limit,
      RATE_LIMITS.order_read.window,
    );
    const items = await getOrderItemsByOrderId(orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin.from("custom_orders")
      .select("id,subtotal_amount,discount_amount,shipping_amount,total_amount,currency,design_status,payment_status")
      .eq("id", orderId).maybeSingle();
    if (error || !order) throw new Error("Pedido no encontrado");
    return { order, items };
  });

/** Resolves the active cart exclusively from the HttpOnly order session. */
export const getActiveCart = createServerFn({ method: "GET" })
  .handler(async () => {
    applyNoStoreHeaders();
    const raw = getCookie(SESSION_COOKIE);
    if (!raw) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session } = await supabaseAdmin.from("payment_sessions")
      .select("order_id,expires_at,absolute_expires_at,revoked_at")
      .eq("session_token_hash", hashToken(raw)).maybeSingle();
    if (!session || session.revoked_at) return null;
    const now = Date.now();
    if (new Date(session.expires_at).getTime() <= now) return null;
    if (session.absolute_expires_at && new Date(session.absolute_expires_at).getTime() <= now) return null;
    const orderId = await requireOrderSession(session.order_id);
    await enforceRateLimit(
      "order_read",
      hashBucketKey("active_cart", orderId),
      RATE_LIMITS.order_read.limit,
      RATE_LIMITS.order_read.window,
    );
    const { data: order, error } = await supabaseAdmin.from("custom_orders")
      .select("id,order_number,subtotal_amount,discount_amount,shipping_amount,total_amount,currency,design_status,payment_status")
      .eq("id", orderId).maybeSingle();
    if (error || !order) return null;
    if (["approved", "refunded", "charged_back"].includes(order.payment_status)) return null;
    const items = await getOrderItemsByOrderId(orderId);
    const itemIds = items.filter((item) => item.is_active).map((item) => item.id);
    const previews = await resolveOrderItemPreviews(supabaseAdmin, orderId, itemIds);
    return {
      order,
      items: items.map((item) => ({
        ...item,
        previews: previews.get(item.id) ?? [],
      })),
    };
  });

export const updateOrderCustomerShipping = createServerFn({ method: "POST" })
  .inputValidator((i) => UpdateOrderCustomerInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    await requireOrderSessionAndCsrf(data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: readError } = await supabaseAdmin
      .from("custom_orders")
      .select("id,payment_status,legal_accepted_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (readError || !order) throw new Error("Pedido no encontrado");
    if (order.payment_status !== "pending" || order.legal_accepted_at) {
      throw new Error("Este pedido ya no permite modificar los datos de envío");
    }
    const { error } = await supabaseAdmin
      .from("custom_orders")
      .update({
        customer_name: data.customer.name,
        customer_email: data.customer.email,
        customer_phone: data.customer.phone,
        shipping_address: {
          address: data.customer.address,
          comuna: data.customer.comuna,
          region: data.customer.region,
          notes: data.customer.notes,
          delivery_method: "shipping",
        },
        notes: data.customer.notes || null,
      })
      .eq("id", data.orderId);
    if (error) throw new Error("No se pudieron guardar los datos de envío");
    return { ok: true };
  });


// ------------------------------------------------------------------
// Shopify Checkout — server-side cart creation
// ------------------------------------------------------------------

type ShopifyPackType =
  | "carcasa"
  | "carcasa+polera"
  | "carcasa+poleron"
  | "carcasa+polera+poleron";

function normalizeShopifyPhone(phone: unknown): string | undefined {
  if (typeof phone !== "string" || !phone.trim()) return undefined;

  const compact = phone.trim().replace(/[\s\-()./]+/g, "");
  if (/^\+56[2-9]\d{8}$/.test(compact)) return compact;
  if (/^56[2-9]\d{8}$/.test(compact)) return `+${compact}`;
  if (/^9\d{8}$/.test(compact)) return `+56${compact}`;
  return undefined;
}

function getShopifyConfig() {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const token = (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ?? "").trim();
  const apiVersion = (process.env.SHOPIFY_STOREFRONT_API_VERSION ?? "2026-07").trim();
  const variants: Record<ShopifyPackType, string> = {
    carcasa: (process.env.SHOPIFY_VARIANT_CARCASA ?? "").trim(),
    "carcasa+polera": (process.env.SHOPIFY_VARIANT_CARCASA_POLERA ?? "").trim(),
    "carcasa+poleron": (process.env.SHOPIFY_VARIANT_CARCASA_POLERON ?? "").trim(),
    "carcasa+polera+poleron": (process.env.SHOPIFY_VARIANT_CARCASA_POLERA_POLERON ?? "").trim(),
  };
  return { domain, token, apiVersion, variants };
}

function assertValidShopifyConfig(cfg: ReturnType<typeof getShopifyConfig>) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(cfg.domain) || !cfg.token) {
    throw new Error("SHOPIFY_NOT_CONFIGURED");
  }
}

async function shopifyStorefrontRequest<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const cfg = getShopifyConfig();
  assertValidShopifyConfig(cfg);
  const response = await fetch(
    `https://${cfg.domain}/api/${encodeURIComponent(cfg.apiVersion)}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Shopify-Storefront-Private-Token": cfg.token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[Shopify] Storefront API HTTP error", response.status, body.slice(0, 300));
    throw new Error("SHOPIFY_API_ERROR");
  }
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    console.error("[Shopify] GraphQL error", json.errors.map((e) => e.message ?? "unknown").join(" | "));
    throw new Error("SHOPIFY_GRAPHQL_ERROR");
  }
  if (!json.data) throw new Error("SHOPIFY_EMPTY_RESPONSE");
  return json.data;
}

const CreateShopifyCheckoutInput = z.object({
  orderId: z.string().uuid(),
});

export const createShopifyCheckout = createServerFn({ method: "POST" })
  .inputValidator((i) => CreateShopifyCheckoutInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();

    const orderId = await requireOrderSession(data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error } = await (supabaseAdmin as any)
      .from("custom_orders")
      .select(
        "id,order_number,pack_type,customer_name,customer_email,customer_phone,shipping_address,subtotal_amount,shipping_amount,total_amount,currency,payment_status,design_status,legal_accepted_at,shopify_cart_id,shopify_checkout_url,shopify_order_id",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) throw new Error("Pedido no encontrado");

    if (order.payment_status === "approved") {
      return { ok: false as const, code: "already_paid" as const };
    }
    if (order.payment_status === "refunded" || order.payment_status === "charged_back") {
      return { ok: false as const, code: "order_locked" as const };
    }
    if (order.design_status !== "ready") {
      throw new Error("El diseño todavía no está listo para pagar");
    }
    if (!order.legal_accepted_at) {
      throw new Error("Debes aceptar las condiciones de compra antes de pagar");
    }

    // Reuse a previously validated cart for this immutable, ready-to-pay order.
    if (order.shopify_checkout_url) {
      return {
        ok: true as const,
        checkoutUrl: order.shopify_checkout_url as string,
        reused: true as const,
      };
    }

    const cfg = getShopifyConfig();
    assertValidShopifyConfig(cfg);
    const variant = cfg.variants[order.pack_type as ShopifyPackType];
    if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variant ?? "")) {
      throw new Error(`SHOPIFY_VARIANT_NOT_CONFIGURED:${order.pack_type}`);
    }

    // Resolve the canonical customer data again from the database. Never trust
    // payment amounts or customer information sent by the browser.
    const shippingAddress = (order.shipping_address ?? {}) as Record<string, unknown>;
    const deliveryMethod =
      typeof shippingAddress.delivery_method === "string"
        ? shippingAddress.delivery_method
        : "shipping";

    const attributes = [
      { key: "visualskin_order_id", value: order.id },
      { key: "visualskin_order_number", value: order.order_number },
      { key: "visualskin_pack_type", value: order.pack_type },
      { key: "visualskin_delivery_method", value: deliveryMethod },
    ];
    const shopifyPhone = normalizeShopifyPhone(order.customer_phone);

    const deliveryAddress =
      deliveryMethod === "shipping" && typeof shippingAddress.address === "string"
        ? {
            selected: true,
            oneTimeUse: true,
            address: {
              deliveryAddress: {
                firstName: String(order.customer_name ?? "").split(/\s+/)[0] || undefined,
                lastName:
                  String(order.customer_name ?? "").split(/\s+/).slice(1).join(" ") || undefined,
                ...(shopifyPhone ? { phone: shopifyPhone } : {}),
                address1: shippingAddress.address,
                city:
                  typeof shippingAddress.comuna === "string"
                    ? shippingAddress.comuna
                    : undefined,
                countryCode: "CL",
              },
            },
          }
        : undefined;

    const query = `
      mutation CartCreate($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            id
            checkoutUrl
            cost {
              subtotalAmount { amount currencyCode }
              totalAmount { amount currencyCode }
            }
          }
          userErrors { field message code }
          warnings { message code target }
        }
      }
    `;

    const input: Record<string, unknown> = {
      lines: [{ merchandiseId: variant, quantity: 1 }],
      buyerIdentity: {
        email: order.customer_email,
        ...(shopifyPhone ? { phone: shopifyPhone } : {}),
        countryCode: "CL",
      },
      attributes,
      note: `VisualSkin ${order.order_number}`,
    };
    if (deliveryAddress) input.delivery = { addresses: [deliveryAddress] };

    type CartCreateData = {
      cartCreate: {
        cart: {
          id: string;
          checkoutUrl: string;
          cost?: {
            subtotalAmount?: { amount: string; currencyCode: string };
            totalAmount?: { amount: string; currencyCode: string };
          };
        } | null;
        userErrors: Array<{ message: string; code?: string | null }>;
        warnings: Array<{ message: string }>;
      };
    };

    const result = await shopifyStorefrontRequest<CartCreateData>(query, { input });
    const payload = result.cartCreate;
    if (payload.userErrors.length || !payload.cart?.checkoutUrl) {
      console.error("[Shopify] cartCreate user errors", payload.userErrors);
      throw new Error("SHOPIFY_CHECKOUT_CREATE_FAILED");
    }

    const shopifySubtotal = Number(payload.cart.cost?.subtotalAmount?.amount ?? NaN);
    const canonicalSubtotal = Number(order.subtotal_amount);
    const shopifyCurrency = payload.cart.cost?.subtotalAmount?.currencyCode;
    if (!Number.isFinite(shopifySubtotal) || !Number.isFinite(canonicalSubtotal)) {
      throw new Error("SHOPIFY_INVALID_PRICE_RESPONSE");
    }
    if (shopifyCurrency !== order.currency) {
      throw new Error("SHOPIFY_CURRENCY_MISMATCH");
    }
    if (Math.round(shopifySubtotal) !== Math.round(canonicalSubtotal)) {
      // Do not let a misconfigured Shopify variant silently charge a different
      // product price than the VisualSkin order.
      console.error("[Shopify] subtotal mismatch", {
        orderId: order.id,
        canonicalSubtotal,
        shopifySubtotal,
      });
      throw new Error("SHOPIFY_PRICE_MISMATCH");
    }
    const { error: updateError } = await (supabaseAdmin as any)
      .from("custom_orders")
      .update({
        shopify_cart_id: payload.cart.id,
        shopify_checkout_url: payload.cart.checkoutUrl,
        payment_provider: "shopify",
        ...(order.payment_status === "rejected" || order.payment_status === "cancelled"
          ? { payment_status: "pending" }
          : {}),
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("[Shopify] failed to persist cart", updateError.message);
      throw new Error("SHOPIFY_CHECKOUT_PERSIST_FAILED");
    }

    return {
      ok: true as const,
      checkoutUrl: payload.cart.checkoutUrl,
      reused: false as const,
    };
  });

// ------------------------------------------------------------------
// getOrderBySession — read via cookie
// ------------------------------------------------------------------

export const getOrderBySession = createServerFn({ method: "POST" })
  .inputValidator((i) => OrderIdInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const orderId = await requireOrderSession(data.orderId);
    await enforceRateLimit(
      "order_read",
      hashBucketKey("order_read", orderId),
      RATE_LIMITS.order_read.limit,
      RATE_LIMITS.order_read.window,
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("custom_orders")
      .select(
        "id,order_number,pack_type,brand,phone_model,garment_size,garment_color,customer_name,customer_email,customer_phone,shipping_address,case_design_url,garment_design_url,case_file_path,garment_file_path,secondary_garment_size,secondary_garment_color,secondary_garment_design_url,secondary_garment_file_path,design_status,notes,subtotal_amount,discount_amount,shipping_amount,total_amount,currency,payment_status,fulfillment_status,mp_payment_id,payment_environment,is_live_mode,created_at,catalog_snapshot,legal_accepted_at,legal_acceptance_hash",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) throw new Error("Pedido no encontrado");

    // §4 Active attempt now INCLUDES awaiting_reconciliation.
    const { data: active } = await supabaseAdmin
      .from("payment_attempts")
      .select("id,status")
      .eq("order_id", orderId)
      .in("status", ["processing", "pending", "awaiting_reconciliation"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Sign short-lived read URLs for private design paths. Fall back to
    // legacy public URL columns only when no path is stored (old orders).
    async function signPath(path: string | null): Promise<string | null> {
      if (!path) return null;
      const { data: s } = await (supabaseAdmin.storage
        .from(DESIGN_BUCKET) as any).createSignedUrl(path, 60 * 10);
      return (s?.signedUrl as string) ?? null;
    }
    const orderRow = order as any;
    const caseUrl =
      (await signPath(orderRow.case_file_path ?? null)) ??
      orderRow.case_design_url ?? null;
    const garmentUrl =
      (await signPath(orderRow.garment_file_path ?? null)) ??
      orderRow.garment_design_url ?? null;
    const secondaryGarmentUrl =
      (await signPath(orderRow.secondary_garment_file_path ?? null)) ??
      orderRow.secondary_garment_design_url ?? null;
    const items = (await getOrderItemsByOrderId(orderId)).filter((item) => item.is_active);
    const itemPreviews = await resolveOrderItemPreviews(supabaseAdmin, orderId, items.map((item) => item.id));

    // Do not leak internal storage paths to the browser.
    delete orderRow.case_file_path;
    delete orderRow.garment_file_path;
    delete orderRow.secondary_garment_file_path;

    // §4 canRetryPayment — single source of truth. The FE must not deduce
    // this from separate flags; it should read this boolean.
    const cfg = getServerConfig();
    const mpCfg = tryGetMercadoPagoConfig();
    const orderEnv = (orderRow.payment_environment ?? "test") as
      | "test"
      | "production";
    const orderLive = orderRow.is_live_mode === true;
    const envOk =
      cfg.paymentsEnabled &&
      !!mpCfg &&
      cfg.mpEnv === orderEnv &&
      cfg.isLiveMode === orderLive;
    const hasActiveAttempt = !!active;
    const activeAttemptStatus =
      (active?.status as
        | "processing"
        | "pending"
        | "awaiting_reconciliation"
        | null) ?? null;
    const canRetryPayment =
      envOk &&
      !hasActiveAttempt &&
      orderRow.design_status === "ready" &&
      !!orderRow.legal_accepted_at &&
      (orderRow.payment_status === "rejected" ||
        orderRow.payment_status === "cancelled");

    return {
      ...orderRow,
      case_design_url: caseUrl,
      garment_design_url: garmentUrl,
      secondary_garment_design_url: secondaryGarmentUrl,
      hasActiveAttempt,
      activeAttemptStatus,
      canRetryPayment,
      items: items.map((item) => ({ ...item, previews: itemPreviews.get(item.id) ?? [] })),
    };
  });



// ------------------------------------------------------------------
// getPaymentBrickInit — via session
// ------------------------------------------------------------------

export const getPaymentBrickInit = createServerFn({ method: "POST" })
  .inputValidator((i) => OrderIdInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const orderId = await requireOrderSession(data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = getServerConfig();
    const mp = tryGetMercadoPagoConfig();
    const publicKey = mp?.publicKey ?? "";


    const { data: order } = await supabaseAdmin
      .from("custom_orders")
      .select(
        "id,total_amount,payment_status,customer_email,design_status,payment_environment,is_live_mode,legal_accepted_at",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido no encontrado");
    const designReady = (order as any).design_status === "ready";
    const orderEnv = ((order as any).payment_environment ?? "test") as
      | "test"
      | "production";
    const orderLive = (order as any).is_live_mode === true;
    const legalAccepted = !!(order as any).legal_accepted_at;

    // §2 Payments gate — never mount Brick / call MP when disabled or when
    // the configured server env does not match the order's env.
    let paymentsDisabledReason: string | null = null;
    if (!cfg.paymentsEnabled) {
      paymentsDisabledReason = "PAYMENTS_DISABLED";
    } else if (!cfg.mpEnv) {
      paymentsDisabledReason = "PAYMENT_ENVIRONMENT_NOT_CONFIGURED";
    } else if (!mp) {
      paymentsDisabledReason = "PAYMENT_CREDENTIALS_INCOMPLETE";
    } else if (cfg.mpEnv !== orderEnv || cfg.isLiveMode !== orderLive) {
      paymentsDisabledReason = "ENVIRONMENT_MISMATCH";
    } else if (cfg.mpEnv === "production") {
      try {
        assertProductionPaymentsConfigured();
      } catch {
        paymentsDisabledReason = "PRODUCTION_PAYMENT_CONFIGURATION_INCOMPLETE";
      }
    }

    const payable =
      !paymentsDisabledReason &&
      designReady &&
      legalAccepted &&
      (order.payment_status === "pending" ||
        order.payment_status === "rejected" ||
        order.payment_status === "cancelled");
    return {
      publicKey,
      amount: order.total_amount,
      payerEmail: order.customer_email,
      payable,
      legalAccepted,
      paymentsEnabled: !paymentsDisabledReason,
      paymentsDisabledReason,
      environment: orderEnv,
      isLiveMode: orderLive,
      designStatus: (order as any).design_status as
        | "pending"
        | "uploading"
        | "ready"
        | "failed",
    };
  });

// ------------------------------------------------------------------
// processMercadoPagoPayment — per-attempt idempotency
// ------------------------------------------------------------------

const PaymentInput = z.object({
  orderId: z.string().uuid(),
  // Validate the Brick payload in the handler so malformed input becomes a
  // controlled payment response rather than a server-function parse error.
  formData: z.unknown(),
});

// Card Payment Brick submits a one-time token plus the selected method and
// installments. `payer` is optional because the order email is the canonical
// fallback, but a supplied identification must be complete.
const MercadoPagoCardPaymentForm = z.object({
  token: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value.trim() === value, "invalid_token"),
  issuer_id: z.union([
    z.string().trim().min(1).max(100),
    z.number().int().positive(),
  ]).optional(),
  payment_method_id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "invalid_payment_method"),
  installments: z.number().int().min(1).max(72).optional().default(1),
  payer: z
    .object({
      email: z.string().trim().email().max(255).optional(),
      identification: z
        .object({
          type: z.string().trim().min(1).max(20),
          number: z.string().trim().min(1).max(40),
        })
        .optional(),
    })
    .optional()
    .default({}),
});

function safeMpErrorCode(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.-]{1,100}$/.test(trimmed) ? trimmed : null;
}

function safeMpErrorText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return null;
  const mayContainSensitiveData =
    /@|https?:\/\/|(?:\d[\s().\/-]*){3,}|\b(?:bearer|basic)\s+\S+|\b(?:access[_ -]?token|authorization|card[_ -]?token|cvv|security[_ -]?code|expir(?:y|ation)|email|document|identification)\s*[:=]\s*\S+|\b[A-Za-z0-9_-]{24,}\b/i;
  return mayContainSensitiveData.test(trimmed) ? null : trimmed;
}

function buildMercadoPagoNotificationUrl(baseUrl: string | null): string | null {
  if (!baseUrl || /[\s"'\\]/.test(baseUrl)) return null;
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.pathname = "/functions/v1/mercadopago-webhook";
    url.search = "";
    url.searchParams.set("source_news", "webhooks");
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildCheckoutProSiteOrigin(cfg: ReturnType<typeof getServerConfig>): string | null {
  const rawVercel = process.env.VERCEL_URL?.trim() ?? "";
  if (process.env.VERCEL_ENV === "preview" && rawVercel) {
    if (/\s|[/?#@:'"\\]/.test(rawVercel)) return null;
    try {
      const url = new URL(`https://${rawVercel}`);
      if (
        url.protocol !== "https:" ||
        !url.hostname.endsWith(".vercel.app") ||
        url.port || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash
      ) return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(cfg.siteOrigin);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function buildCheckoutProBackUrl(origin: string, orderId: string, result: "success" | "pending" | "failure"): string {
  const url = new URL(`/pedido/${orderId}`, origin);
  url.searchParams.set("mp_return", result);
  return url.toString();
}

const CheckoutProPayment = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.string(),
  status_detail: z.string().nullable().optional(),
  live_mode: z.boolean(),
  transaction_amount: z.number(),
  currency_id: z.string(),
  external_reference: z.string().nullable().optional(),
  metadata: z.object({ order_id: z.string().optional() }).passthrough().nullable().optional(),
  payment_type_id: z.string(),
  collector_id: z.union([z.string(), z.number()]).nullable().optional(),
  preference_id: z.string().min(1).max(200),
});

const CheckoutProOrderInput = z.object({ orderId: z.string().uuid() });
const CheckoutProReturnInput = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().regex(/^[0-9]{1,30}$/),
});

function validateCheckoutUrl(raw: unknown, env: "test" | "production"): string | null {
  if (typeof raw !== "string" || !raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw);
    const testHosts = new Set(["sandbox.mercadopago.com", "sandbox.mercadopago.cl"]);
    const productionHosts = new Set(["www.mercadopago.com", "www.mercadopago.cl"]);
    const hosts = env === "test" ? testHosts : productionHosts;
    if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function applyCheckoutProPayment(
  order: { id: string; payment_environment: string; is_live_mode: boolean },
  paymentRaw: unknown,
  mp: ReturnType<typeof getMercadoPagoConfig>,
) {
  const parsed = CheckoutProPayment.safeParse(paymentRaw);
  if (!parsed.success) throw new Error("Respuesta de pago inválida");
  const payment = parsed.data;
  const paymentId = String(payment.id);
  const metadataOrderId = payment.metadata?.order_id ?? null;
  const collectorId = payment.collector_id == null ? null : String(payment.collector_id);
  if (
    payment.external_reference !== order.id ||
    metadataOrderId !== order.id ||
    payment.currency_id !== "CLP" ||
    payment.live_mode !== order.is_live_mode ||
    order.payment_environment !== mp.env ||
    (mp.collectorId && collectorId !== mp.collectorId)
  ) throw new Error("El pago no coincide con el pedido");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: attached, error: attachError } = await supabaseAdmin.rpc(
    "attach_checkout_pro_snapshot_payment_v1" as any,
    { p_order_id: order.id, p_payment_id: paymentId, p_preference_id: payment.preference_id,
      p_payment_environment: mp.env, p_is_live_mode: mp.isLiveMode } as any,
  );
  if (attachError) throw new Error("No se pudo asociar el pago");
  const attach = attached as { ok?: boolean; code?: string; attempt_id?: string };
  if (!attach?.ok || !attach.attempt_id) throw new Error(`No se pudo asociar el pago: ${attach?.code ?? "unknown"}`);

  const { data: applied, error: applyError } = await supabaseAdmin.rpc(
    "apply_checkout_pro_snapshot_payment_v1" as any,
    {
      p_order_id: order.id, p_attempt_id: attach.attempt_id, p_payment_id: paymentId,
      p_preference_id: payment.preference_id,
      p_payment_status: payment.status, p_status_detail: payment.status_detail ?? null,
      p_live_mode: payment.live_mode, p_transaction_amount: payment.transaction_amount,
      p_currency_id: payment.currency_id, p_external_reference: payment.external_reference,
      p_metadata_order_id: metadataOrderId, p_metadata_attempt_id: null,
      p_payment_type_id: payment.payment_type_id, p_collector_id: collectorId,
      p_expected_collector_id: mp.collectorId,
    } as any,
  );
  if (applyError) throw new Error("No se pudo aplicar el estado del pago");
  const result = applied as { ok?: boolean; order_status?: PaymentStatus; reason?: string };
  if (!result?.ok) throw new Error(`Pago pendiente de conciliación: ${result?.reason ?? "unknown"}`);
  return { status: result.order_status ?? "pending" };
}

export const createMercadoPagoCheckoutPro = createServerFn({ method: "POST" })
  .inputValidator((i) => CheckoutProOrderInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    await enforceRateLimit("checkout_pro_preference", hashBucketKey("checkout_pro_preference", sess.orderId), RATE_LIMITS.checkout_pro_preference.limit, RATE_LIMITS.checkout_pro_preference.window);
    const cfg = getServerConfig();
    if (!cfg.paymentsEnabled) throw new Error("Los pagos están temporalmente deshabilitados");
    const mp = getMercadoPagoConfig();
    if (mp.env === "production") assertProductionPaymentsConfigured();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin.from("custom_orders")
      .select("id,order_number,payment_status,customer_name,customer_email,customer_phone,shipping_address,payment_environment,is_live_mode,legal_accepted_at")
      .eq("id", sess.orderId).maybeSingle();
    if (!order) throw new Error("Pedido no encontrado");
    if (!(order as any).legal_accepted_at) throw new Error("Debes aceptar las condiciones antes de pagar");
    if (["approved", "refunded", "charged_back"].includes(order.payment_status)) throw new Error("Este pedido ya no admite pagos");
    if ((order as any).payment_environment !== mp.env || (order as any).is_live_mode !== mp.isLiveMode) throw new Error("Entorno de pago incompatible");
    if (!z.string().email().safeParse(order.customer_email).success) throw new Error("Email del pedido inválido");
    const checkoutAddress = (order as any).shipping_address ?? {};
    if (!CustomerSchema.safeParse({
      name: (order as any).customer_name, email: order.customer_email,
      phone: (order as any).customer_phone, address: checkoutAddress.address,
      comuna: checkoutAddress.comuna, region: checkoutAddress.region,
      notes: checkoutAddress.notes ?? "",
    }).success) throw new Error("Completa los datos de envío antes de pagar");
    const notificationUrl = buildMercadoPagoNotificationUrl(cfg.supabaseAdminUrl);
    const siteOrigin = buildCheckoutProSiteOrigin(cfg);
    if (!notificationUrl || !siteOrigin) throw new Error("Configuración de URLs de pago inválida");

    // Atomically claim preference creation. Concurrent tabs reuse the
    // backend-owned URL or wait briefly; they do not issue a second POST.
    const claimToken = randomUUID();
    let claimed: { snapshotId: string; fingerprint: string; cartVersion: number; lines: MercadoPagoLine[]; total: number } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data: claimRaw, error: claimError } = await supabaseAdmin.rpc(
        "claim_checkout_pro_cart_v1" as any,
        { p_order_id: order.id, p_environment: mp.env, p_claim_token: claimToken } as any,
      );
      if (claimError) throw new Error("No se pudo reservar el checkout");
      const claim = claimRaw as { ok?: boolean; code?: string; checkout_url?: unknown; snapshot_id?: unknown;
        cart_fingerprint?: unknown; cart_version?: unknown; line_items?: unknown; total_amount?: unknown };
      if (claim.ok && claim.code === "reused") {
        const checkoutUrl = validateCheckoutUrl(claim.checkout_url, mp.env);
        if (!checkoutUrl) throw new Error("La preferencia guardada no es válida");
        return { checkoutUrl };
      }
      if (claim.ok && claim.code === "claimed" && typeof claim.snapshot_id === "string"
          && typeof claim.cart_fingerprint === "string" && typeof claim.cart_version === "number"
          && Array.isArray(claim.line_items) && typeof claim.total_amount === "number") {
        claimed = { snapshotId: claim.snapshot_id, fingerprint: claim.cart_fingerprint,
          cartVersion: claim.cart_version, lines: claim.line_items as MercadoPagoLine[], total: claim.total_amount };
        break;
      }
      if (claim.code !== "creation_in_progress") {
        throw new Error("Este pedido no puede iniciar un checkout ahora");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!claimed) throw new Error("Mercado Pago se está abriendo en otra pestaña");

    // Defence in depth: the database owns all prices and returns the exact
    // provider lines; this assertion prevents sending any inconsistent sum.
    const merchandise = claimed.lines.filter((line) => line.id !== "shipping");
    const canonicalForAssertion: CanonicalCheckoutCart = {
      schema: 1, order_id: order.id, currency: "CLP",
      items: merchandise.map((line, position) => ({
        id: line.id, position, pack_type: "database-validated", pack_id: null, quantity: line.quantity,
        unit_price: line.unit_price, discount_amount: 0, line_total: line.unit_price * line.quantity,
        phone_model_id: null, brand_id: null, brand: null, phone_model: null,
        garment_id: null, garment_size: null, garment_color: null,
        secondary_garment_id: null, secondary_garment_size: null, secondary_garment_color: null,
      })),
      subtotal_amount: merchandise.reduce((sum, line) => sum + line.unit_price * line.quantity, 0),
      shipping_amount: claimed.lines.find((line) => line.id === "shipping")?.unit_price ?? 0,
      total_amount: claimed.total,
    };
    assertCheckoutEconomy(canonicalForAssertion, claimed.lines);

    const preferenceCreatedAt = new Date();
    const preferenceExpiresAt = new Date(preferenceCreatedAt.getTime() + 30 * 60 * 1000);
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${mp.accessToken}`, "Content-Type": "application/json",
        "X-Idempotency-Key": `checkout-${claimed.snapshotId}` },
      body: JSON.stringify({
        items: claimed.lines,
        external_reference: order.id,
        payer: { email: order.customer_email },
        notification_url: notificationUrl,
        back_urls: {
          success: buildCheckoutProBackUrl(siteOrigin, order.id, "success"),
          pending: buildCheckoutProBackUrl(siteOrigin, order.id, "pending"),
          failure: buildCheckoutProBackUrl(siteOrigin, order.id, "failure"),
        },
          auto_return: "approved",
          expires: true,
          expiration_date_from: preferenceCreatedAt.toISOString(),
          expiration_date_to: preferenceExpiresAt.toISOString(),
          metadata: { order_id: order.id, order_number: order.order_number,
            cart_version: claimed.cartVersion, cart_fingerprint: claimed.fingerprint },
      }),
    });
    let body: { id?: unknown; init_point?: unknown; sandbox_init_point?: unknown } = {};
    try { body = await response.json(); } catch { /* closed response below */ }
    if (!response.ok) {
      await supabaseAdmin.rpc(
        "release_checkout_pro_cart_claim_v1" as any,
        { p_order_id: order.id, p_snapshot_id: claimed.snapshotId, p_claim_token: claimToken } as any,
      );
      throw new Error("Mercado Pago no pudo iniciar el checkout");
    }
    const rawUrl = mp.env === "test" ? body.sandbox_init_point : body.init_point;
    const checkoutUrl = validateCheckoutUrl(rawUrl, mp.env);
    if (!checkoutUrl) throw new Error("Mercado Pago devolvió una URL de checkout inválida");
    if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 200) {
      throw new Error("Mercado Pago devolvió una preferencia inválida");
    }
    const { data: storeRaw, error: storeError } = await supabaseAdmin.rpc(
      "store_checkout_pro_cart_v1" as any,
      { p_order_id: order.id, p_snapshot_id: claimed.snapshotId,
        p_environment: mp.env, p_claim_token: claimToken,
        p_preference_id: body.id, p_checkout_url: checkoutUrl,
        p_expires_at: preferenceExpiresAt.toISOString() } as any,
    );
    const stored = storeRaw as { ok?: boolean };
    if (storeError || !stored?.ok) {
      throw new Error("No se pudo guardar el checkout de forma segura");
    }
    return { checkoutUrl };
  });

export const reconcileMercadoPagoCheckoutProReturn = createServerFn({ method: "POST" })
  .inputValidator((i) => CheckoutProReturnInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    await enforceRateLimit("checkout_pro_return", hashBucketKey("checkout_pro_return", sess.orderId), RATE_LIMITS.checkout_pro_return.limit, RATE_LIMITS.checkout_pro_return.window);
    const cfg = getServerConfig();
    if (!cfg.paymentsEnabled) throw new Error("Los pagos están temporalmente deshabilitados");
    const mp = getMercadoPagoConfig();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin.from("custom_orders")
      .select("id,payment_status,payment_environment,is_live_mode")
      .eq("id", sess.orderId).maybeSingle();
    if (!order) throw new Error("Pedido no encontrado");
    if (["approved", "refunded", "charged_back"].includes(order.payment_status)) return { status: order.payment_status as PaymentStatus };
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(data.paymentId)}`, { headers: { Authorization: `Bearer ${mp.accessToken}` } });
    if (!response.ok) throw new Error("No pudimos verificar el pago con Mercado Pago");
    const payment: unknown = await response.json();
    return applyCheckoutProPayment(order as any, payment, mp);
  });

export const processMercadoPagoPayment = createServerFn({ method: "POST" })
  .inputValidator((i) => PaymentInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;
    const parsedPaymentForm = MercadoPagoCardPaymentForm.safeParse(data.formData);
    if (!parsedPaymentForm.success) {
      return {
        ok: false as const,
        code: "invalid_payment_payload" as const,
        status: "pending" as PaymentStatus,
        message:
          "No pudimos validar los datos de pago. Revisa la tarjeta e intÃ©ntalo nuevamente.",
      };
    }
    const paymentForm = parsedPaymentForm.data;
    await enforceRateLimit(
      "process_payment",
      hashBucketKey("process_payment_order", orderId),
      RATE_LIMITS.process_payment.limit,
      RATE_LIMITS.process_payment.window,
    );
    const cfg = getServerConfig();
    const mp = tryGetMercadoPagoConfig();
    const accessToken = mp?.accessToken ?? "";
    const siteOrigin = cfg.siteOrigin;


    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Load order for money + email (NOT for guard — RPC re-checks under lock).
    const { data: order } = await supabaseAdmin
      .from("custom_orders")
      .select(
        "id,order_number,total_amount,currency,payment_status,customer_email,customer_name,design_status,payment_environment,is_live_mode",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido no encontrado");
    // Chile payments must use the canonical server-side CLP total as a
    // positive integer. Validate before reserving an attempt so an invalid
    // order can never reach Mercado Pago or lock the payment state machine.
    const serverAmount = Number(order.total_amount);
    if (
      !Number.isFinite(serverAmount) ||
      serverAmount <= 0 ||
      !Number.isInteger(serverAmount) ||
      order.currency !== "CLP"
    ) {
      return {
        ok: false as const,
        code: "invalid_canonical_amount" as const,
        status: order.payment_status as PaymentStatus,
        message: "El monto o la moneda del pedido no son válidos para pagar",
      };
    }
    if ((order as any).design_status !== "ready") {
      return {
        ok: false as const,
        code: "design_not_ready" as const,
        status: order.payment_status as PaymentStatus,
        message: "Los diseños del pedido aún no están listos",
      };
    }

    // §2 Payments gate.
    if (!cfg.paymentsEnabled) {
      return {
        ok: false as const,
        code: "payments_disabled" as const,
        status: order.payment_status as PaymentStatus,
        message: "Los pagos están temporalmente deshabilitados",
      };
    }
    if (!mp) {
      return {
        ok: false as const,
        code: "payments_disabled" as const,
        status: order.payment_status as PaymentStatus,
        message:
          cfg.mpEnv == null
            ? "Entorno de pagos no configurado"
            : "Credenciales de pago incompletas",
      };
    }
    const orderEnv = ((order as any).payment_environment ?? "test") as
      | "test"
      | "production";
    const orderLive = (order as any).is_live_mode === true;
    if (cfg.mpEnv !== orderEnv || cfg.isLiveMode !== orderLive) {
      return {
        ok: false as const,
        code: "environment_mismatch" as const,
        status: order.payment_status as PaymentStatus,
        message:
          "Este pedido no puede procesarse en el entorno de pagos actual",
      };
    }
    if (cfg.mpEnv === "production") {
      try {
        assertProductionPaymentsConfigured();
      } catch (e) {
        return {
          ok: false as const,
          code: "production_config_incomplete" as const,
          status: order.payment_status as PaymentStatus,
          message: "Configuración de producción incompleta",
        };
      }
    }
    const notificationUrl = buildMercadoPagoNotificationUrl(cfg.supabaseAdminUrl);
    if (!notificationUrl) {
      return {
        ok: false as const,
        code: "payment_configuration_error" as const,
        status: order.payment_status as PaymentStatus,
        message: "No pudimos configurar las notificaciones del pago",
      };
    }
    const orderRow = order;


    // 2. Fingerprint (no PAN, no CVV — MP one-time card token is fine to hash).
    const fpSource = JSON.stringify({
      o: order.id,
      t: paymentForm.token,
      m: paymentForm.payment_method_id,
      i: paymentForm.installments,
      a: order.total_amount,
    });
    const requestFingerprint = createHash("sha256").update(fpSource).digest("hex");

    // 3. Reserve the attempt atomically via the RPC (SELECT ... FOR UPDATE inside).
    const proposedIdemKey = randomUUID();
    const { data: rpcRaw, error: rpcErr } = await supabaseAdmin.rpc(
      "begin_payment_attempt" as any,
      {
        p_order_id: order.id,
        p_idempotency_key: proposedIdemKey,
        p_request_fingerprint: requestFingerprint,
      } as any,
    );
    if (rpcErr) {
      console.error("[begin_payment_attempt]", rpcErr.message);
      throw new Error("No se pudo iniciar el pago");
    }
    const rpc = rpcRaw as {
      ok: boolean;
      code?: string;
      reused?: boolean;
      attempt_id?: string;
      attempt_number?: number;
      idempotency_key?: string;
      previous_order_status?: PaymentStatus;
      order_status?: PaymentStatus;
    };

    if (!rpc.ok) {
      if (rpc.code === "awaiting_confirmation") {
        return {
          ok: false as const,
          code: "awaiting_confirmation" as const,
          status: "pending" as PaymentStatus,
          message:
            "Estamos esperando la confirmación de Mercado Pago para tu pago anterior.",
        };
      }
      if (rpc.code === "order_locked") {
        return {
          ok: false as const,
          code: "order_locked" as const,
          status: (rpc.order_status ?? order.payment_status) as PaymentStatus,
          message: "Este pedido ya no admite pagos",
        };
      }
      if (rpc.code === "design_not_ready") {
        return {
          ok: false as const,
          code: "design_not_ready" as const,
          status: order.payment_status as PaymentStatus,
          message: "Los diseños del pedido aún no están listos",
        };
      }
      if (rpc.code === "order_not_found") {
        throw new Error("Pedido no encontrado");
      }
      return {
        ok: false as const,
        status: order.payment_status as PaymentStatus,
        message: "No se pudo iniciar el pago",
      };
    }

    const attemptId = rpc.attempt_id!;
    const idempotencyKey = rpc.idempotency_key!;
    const previousOrderStatus = (rpc.previous_order_status ?? "pending") as PaymentStatus;

    // §3 Stamp env fields on the attempt. Never trust MP inference — the
    // server config decides what mode this attempt is issued under.
    await supabaseAdmin
      .from("payment_attempts")
      .update({
        payment_environment: cfg.mpEnv,
        is_live_mode: cfg.isLiveMode,
      } as any)
      .eq("id", attemptId);

    // Helper: restore order_status if the RPC flipped rejected/cancelled → pending
    // and the attempt never produced a definitive result.
    async function restorePreviousOrderStatus() {
      if (previousOrderStatus === "pending") return;
      // Only restore when order is still pending AND no other active attempt exists.
      const { data: cur } = await supabaseAdmin
        .from("custom_orders")
        .select("payment_status")
        .eq("id", orderRow.id)
        .maybeSingle();
      if (!cur || cur.payment_status !== "pending") return;
      const { data: active } = await supabaseAdmin
        .from("payment_attempts")
        .select("id")
        .eq("order_id", orderRow.id)
        .in("status", ["processing", "pending"])
        .maybeSingle();
      if (active) return;
      if (canTransition("pending", previousOrderStatus)) {
        await supabaseAdmin
          .from("custom_orders")
          .update({ payment_status: previousOrderStatus })
          .eq("id", orderRow.id);
      }
    }

    // 4. Call MP.
    const body = {
      transaction_amount: serverAmount,
      token: paymentForm.token,
      description: `VISUALSKIN ${order.order_number}`,
      installments: paymentForm.installments,
      payment_method_id: paymentForm.payment_method_id,
      issuer_id: paymentForm.issuer_id
        ? String(paymentForm.issuer_id)
        : undefined,
      payer: {
        email: paymentForm.payer?.email ?? order.customer_email,
        identification: paymentForm.payer?.identification,
      },
      external_reference: order.id,
      statement_descriptor: "VISUALSKIN",
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        payment_attempt_id: attemptId,
      },
      notification_url: notificationUrl,
    };

    let res: Response;
    try {
      res = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // Result unknown: the request may have reached Mercado Pago and created
      // a payment before the connection dropped. NEVER allow a new attempt
      // by simply timing out — the attempt stays in awaiting_reconciliation
      // and blocks subsequent begin_payment_attempt calls (via the partial
      // unique index) until the webhook resolves it or an operator does.
      const { error: aErr } = await supabaseAdmin
        .from("payment_attempts")
        .update({
          status: "awaiting_reconciliation",
          status_detail: "network_error_after_send",
        })
        .eq("id", attemptId);
      if (aErr) console.error("[attempt awaiting_reconciliation]", aErr.message);
      // Do NOT restore previous order status — the outcome is unknown.
      return {
        ok: false as const,
        code: "awaiting_reconciliation" as const,
        status: "pending" as PaymentStatus,
        message:
          "Perdimos la conexión con Mercado Pago. Estamos verificando si el pago se registró; no vuelvas a pagar todavía.",
      };
    }

    // 5. Parse response body defensively — do NOT touch tables directly.
    let payment: {
      id?: number | string;
      status?: string;
      status_detail?: string;
      error?: unknown;
      message?: unknown;
      cause?: unknown;
      causes?: unknown;
      live_mode?: boolean;
      transaction_amount?: number;
      currency_id?: string;
      external_reference?: string;
      metadata?: { order_id?: string; payment_attempt_id?: string } | null;
      payment_type_id?: string;
      collector_id?: number | string;
    } = {};
    try {
      const parsedBody: unknown = await res.json();
      if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
        payment = parsedBody as typeof payment;
      }
    } catch {
      // Body not JSON → treat as no-reliable-payment-object below.
    }

    // HTTP error path.
    if (!res.ok) {
      const rawCauses = Array.isArray(payment.cause)
        ? payment.cause
        : Array.isArray(payment.causes)
          ? payment.causes
          : [];
      const causeCodes = rawCauses.slice(0, 10).flatMap((cause) => {
        if (!cause || typeof cause !== "object") return [];
        const item = cause as Record<string, unknown>;
        const code = safeMpErrorCode(item.code);
        const description = safeMpErrorText(item.description ?? item.message);
        return code !== null || description !== null
          ? [{ code, description }]
          : [];
      });
      console.error("[MP payment error safe]", {
        httpStatus: res.status,
        error: safeMpErrorCode(payment.error),
        message: safeMpErrorText(payment.message),
        status: safeMpErrorCode(payment.status),
        status_detail: safeMpErrorCode(payment.status_detail),
        causeCodes,
      });
      // If we can associate a payment id, route through the RPC so the
      // reconciliation/mismatch bookkeeping happens under lock.
      const hasReliablePayment =
        payment &&
        (payment.id !== undefined && payment.id !== null) &&
        typeof payment.status === "string";
      if (!hasReliablePayment) {
        // Never log the payload; only the HTTP status + safe code.
        console.error("[MP payments http]", res.status);
        // 4xx = MP definitively rejected the request (no charge was made).
        // Mark the attempt as `error`, keep the order in `pending`, and let
        // the customer retry without creating a new order.
        const isClientError = res.status >= 400 && res.status < 500;
        if (isClientError) {
          const { error: aErr } = await supabaseAdmin
            .from("payment_attempts")
            .update({
              status: "error",
              status_detail: `http_${res.status}_no_payment_object`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", attemptId);
          if (aErr) console.error("[attempt error]", aErr.message);
          await restorePreviousOrderStatus();
          return {
            ok: false as const,
            code: "payment_failed" as const,
            status: order.payment_status as PaymentStatus,
            message:
              "Mercado Pago no procesó el pago. Revisa los datos de la tarjeta e inténtalo nuevamente.",
          };
        }
        // 5xx / unknown: outcome unclear → hold for reconciliation.
        const { error: aErr } = await supabaseAdmin
          .from("payment_attempts")
          .update({
            status: "awaiting_reconciliation",
            status_detail: `http_${res.status}_no_payment_object`,
          })
          .eq("id", attemptId);
        if (aErr) console.error("[attempt awaiting_reconciliation]", aErr.message);
        await supabaseAdmin
          .from("custom_orders")
          .update({ manual_review_required: true })
          .eq("id", orderRow.id);
        return {
          ok: false as const,
          code: "awaiting_reconciliation" as const,
          status: "pending" as PaymentStatus,
          message:
            "No pudimos confirmar el pago con Mercado Pago. Estamos verificándolo; no vuelvas a pagar todavía.",
        };
      }
      // else: fall through to the canonical RPC path.
    }

    if (payment.id === undefined || payment.id === null) {
      // No payment identifier at all → route to reconciliation.
      const { error: aErr } = await supabaseAdmin
        .from("payment_attempts")
        .update({
          status: "awaiting_reconciliation",
          status_detail: "no_payment_id_in_response",
        })
        .eq("id", attemptId);
      if (aErr) console.error("[attempt awaiting_reconciliation]", aErr.message);
      await supabaseAdmin
        .from("custom_orders")
        .update({ manual_review_required: true })
        .eq("id", orderRow.id);
      return {
        ok: false as const,
        code: "awaiting_reconciliation" as const,
        status: "pending" as PaymentStatus,
        message:
          "No pudimos confirmar el pago con Mercado Pago. Estamos verificándolo; no vuelvas a pagar todavía.",
      };
    }

    // 6. Persist the MP payment id immediately (defense in depth): even if
    // the transactional RPC below fails, the id stays associated to the
    // attempt so the webhook or a reconciler can retry safely. We only fill
    // the slot when it is empty to never overwrite a conflicting id.
    try {
      await supabaseAdmin
        .from("payment_attempts")
        .update({ mercado_pago_payment_id: String(payment.id) })
        .eq("id", attemptId)
        .is("mercado_pago_payment_id", null);
      await supabaseAdmin
        .from("custom_orders")
        .update({ mp_payment_id: String(payment.id) })
        .eq("id", orderRow.id)
        .is("mp_payment_id", null);
    } catch (e) {
      // Never leak errors; the RPC will also persist below.
      console.error("[persist payment_id pre-rpc]", (e as Error).message);
    }

    // 7. Delegate to the transactional RPC. NEVER UPDATE the attempt or the
    // order directly here — the RPC validates canonical fields under lock.
    const { data: applyRaw, error: applyErr } = await supabaseAdmin.rpc(
      "apply_mercado_pago_payment_response" as any,
      {
        p_order_id: orderRow.id,
        p_attempt_id: attemptId,
        p_payment_id: String(payment.id),
        p_payment_status: String(payment.status ?? ""),
        p_status_detail: payment.status_detail ?? null,
        p_live_mode: typeof payment.live_mode === "boolean" ? payment.live_mode : null,
        p_transaction_amount:
          typeof payment.transaction_amount === "number"
            ? payment.transaction_amount
            : null,
        p_currency_id: payment.currency_id ?? null,
        p_external_reference: payment.external_reference ?? null,
        p_metadata_order_id: payment.metadata?.order_id ?? null,
        p_metadata_attempt_id: payment.metadata?.payment_attempt_id ?? null,
        p_payment_type_id: payment.payment_type_id ?? null,
        p_collector_id:
          payment.collector_id !== undefined && payment.collector_id !== null
            ? String(payment.collector_id)
            : null,
        p_expected_collector_id: mp.collectorId ?? null,
      } as any,
    );


    if (applyErr) {
      // The RPC threw (order_not_found / attempt_not_found / attempt_order_mismatch)
      // OR the DB update itself failed. Do NOT release the attempt and do NOT
      // approve the order. Force the attempt into reconciliation so no new
      // payment can begin until an operator/webhook resolves it.
      console.error("[apply_mercado_pago_payment_response]", applyErr.message);
      const { error: recErr } = await supabaseAdmin
        .from("payment_attempts")
        .update({
          status: "awaiting_reconciliation",
          status_detail: "rpc_apply_failed",
        })
        .eq("id", attemptId);
      if (recErr) console.error("[attempt awaiting_reconciliation]", recErr.message);
      await supabaseAdmin
        .from("custom_orders")
        .update({ manual_review_required: true })
        .eq("id", orderRow.id);
      return {
        ok: false as const,
        code: "awaiting_reconciliation" as const,
        status: "pending" as PaymentStatus,
        message:
          "El pago quedó pendiente de confirmación. Un operador lo revisará; no vuelvas a pagar todavía.",
      };
    }

    const apply = applyRaw as {
      ok: boolean;
      code?: string;
      reason?: string;
      order_status?: PaymentStatus;
      attempt_status?: PaymentStatus;
      terminal?: boolean;
    };

    if (!apply.ok) {
      // The RPC already stamped awaiting_reconciliation + manual_review.
      return {
        ok: false as const,
        code: "awaiting_reconciliation" as const,
        status: "pending" as PaymentStatus,
        message:
          "El pago está en revisión por una inconsistencia detectada. Un operador lo confirmará.",
      };
    }

    const finalStatus = (apply.order_status ?? "pending") as PaymentStatus;

    // §3 Controlled auto-unlock after a canonical rejected/cancelled response.
    // The design was locked by begin_payment_attempt; if the payment did not
    // succeed, unlock it via the same RPC the FE would call, so the customer
    // can retry without going back to the personalizador.
    let unlockCode: string | null = null;
    if (finalStatus === "rejected" || finalStatus === "cancelled") {
      const { data: unlockRaw, error: unlockErr } = await supabaseAdmin.rpc(
        "unlock_order_design" as any,
        { p_order_id: orderRow.id } as any,
      );
      if (unlockErr) {
        console.error("[auto unlock_order_design]", unlockErr.message);
        unlockCode = "rpc_error";
      } else {
        const u = unlockRaw as { ok?: boolean; code?: string };
        unlockCode = u?.code ?? (u?.ok ? "ok" : "unknown");
      }
    }

    return {
      ok: true as const,
      status: finalStatus,
      statusDetail: payment.status_detail ?? null,
      paymentId: String(payment.id),
      attemptId,
      unlockCode,
    };
  });




// ------------------------------------------------------------------
// Admin: fulfillment only.
// ------------------------------------------------------------------

const AdminFulfillInput = z.object({
  orderId: z.string().uuid(),
  fulfillmentStatus: z.enum([
    "new",
    "in_production",
    "ready",
    "shipped",
    "completed",
    "cancelled",
  ]),
});

export const adminSetFulfillmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminFulfillInput.parse(i))
  .handler(async ({ data, context }) => {
    applyNoStoreHeaders();
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    // Fuente de verdad: leer el pedido desde el servidor. Nunca confiar
    // en payment_status enviado por el cliente.
    const { data: order, error: readErr } = await supabase
      .from("custom_orders")
      .select("id, payment_status, fulfillment_status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!order) throw new Error("Not found");
    if (order.payment_status !== "approved") {
      throw new Error(
        "La producción solo puede modificarse cuando el pago está aprobado.",
      );
    }

    const { error } = await supabase
      .from("custom_orders")
      .update({ fulfillment_status: data.fulfillmentStatus })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------------------------
// §10 Admin server functions — role-checked, no dashboard-side money edits.
// ------------------------------------------------------------------

async function requireAdmin(context: {
  supabase: any;
  userId: string;
}): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

const AdminListInput = z.object({
  qNumber: z.string().max(80).optional().default(""),
  qName: z.string().max(120).optional().default(""),
  qEmail: z.string().max(255).optional().default(""),
  paymentStatus: z.string().max(30).optional().default(""),
  fulfillmentStatus: z.string().max(30).optional().default(""),
  designStatus: z.string().max(30).optional().default(""),
  manualReview: z.enum(["", "yes", "no"]).optional().default(""),
  from: z.string().max(40).optional().default(""),
  to: z.string().max(40).optional().default(""),
  page: z.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(50),
});

export const adminListOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminListInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("custom_orders")
      .select(
        "id,order_number,customer_name,customer_email,customer_phone,total_amount,payment_status,fulfillment_status,design_status,manual_review_required,low_resolution_warning,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if (data.qNumber) q = q.ilike("order_number", `%${data.qNumber}%`);
    if (data.qName) q = q.ilike("customer_name", `%${data.qName}%`);
    if (data.qEmail) q = q.ilike("customer_email", `%${data.qEmail}%`);
    if (data.paymentStatus) q = q.eq("payment_status", data.paymentStatus);
    if (data.fulfillmentStatus) q = q.eq("fulfillment_status", data.fulfillmentStatus);
    if (data.designStatus) q = q.eq("design_status", data.designStatus);
    if (data.manualReview === "yes") q = q.eq("manual_review_required", true);
    if (data.manualReview === "no") q = q.eq("manual_review_required", false);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    const from = (data.page - 1) * data.pageSize;
    q = q.range(from, from + data.pageSize - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []) as any[],
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

type CompatibleOrderItem = OrderItem & {
  source: "order_items" | "legacy";
};

async function resolveOrderItemPreviews(
  supabaseAdmin: any,
  orderId: string,
  itemIds: string[],
): Promise<Map<string, Array<{ slot: string; url: string }>>> {
  const { groupSignedOrderItemPreviews } = await import("@/lib/order-item-previews");
  if (itemIds.length === 0) return new Map();
  const { data: rows, error } = await supabaseAdmin.from("order_item_previews")
    .select("order_id,order_item_id,slot,storage_path")
    .eq("order_id", orderId).in("order_item_id", itemIds).order("created_at");
  if (error) throw new Error("No se pudieron consultar las previews del pedido");
  const signedRows: Array<{ order_item_id: string; slot: string; url: string }> = [];
  await Promise.all((rows ?? []).map(async (row: any) => {
    const path = String(row.storage_path ?? "");
    const itemId = String(row.order_item_id ?? "");
    if (!itemIds.includes(itemId) || !path.startsWith(`${orderId}/${itemId}/`) || path.includes("..") || path.includes("//")) {
      console.warn("[order-preview] invalid persisted namespace", { orderId, orderItemId: itemId, slot: row.slot });
      return;
    }
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(DESIGN_BUCKET).createSignedUrl(path, PREVIEW_SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      console.warn("[order-preview] signing failed", { orderId, orderItemId: itemId, slot: row.slot });
      return;
    }
    signedRows.push({ order_item_id: itemId, slot: String(row.slot), url: signed.signedUrl });
  }));
  return groupSignedOrderItemPreviews(signedRows);
}

async function getOrderItemsByOrderId(
  orderId: string,
): Promise<CompatibleOrderItem[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: itemRows, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });

  const missingTable =
    itemsError?.code === "42P01" || itemsError?.code === "PGRST205";
  if (itemsError && !missingTable) throw new Error(itemsError.message);
  if (itemRows?.length) {
    return (itemRows as OrderItem[]).map((item) => ({
      ...item,
      source: "order_items" as const,
    }));
  }

  // Transitional fallback for code review/deployments where the additive
  // migration has not run yet, and for any legacy row not backfilled yet.
  const { data: order, error: orderError } = await supabaseAdmin
    .from("custom_orders")
    .select(
      "id,pack_id,pack_type,brand_id,brand,phone_model_id,phone_model,garment_id,garment_size,garment_color,secondary_garment_id,secondary_garment_size,secondary_garment_color,subtotal_amount,discount_amount,catalog_snapshot,design_status,low_resolution_warning,created_at,updated_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) return [];

  const lineTotal = Math.max(0, Math.round(Number(order.subtotal_amount) || 0));
  const discount = Math.max(0, Math.round(Number(order.discount_amount) || 0));
  const gross = lineTotal + discount;
  return [{
    id: order.id,
    order_id: order.id,
    position: 0,
    quantity: 1,
    client_item_key: "legacy-initial-item",
    request_fingerprint: createHash("sha256").update(`${order.id}:legacy-initial-item`).digest("hex"),
    pack_id: order.pack_id,
    pack_type: order.pack_type,
    brand_id: order.brand_id,
    brand: order.brand,
    phone_model_id: order.phone_model_id,
    phone_model: order.phone_model,
    garment_id: order.garment_id,
    garment_size: order.garment_size,
    garment_color: order.garment_color,
    secondary_garment_id: order.secondary_garment_id,
    secondary_garment_size: order.secondary_garment_size,
    secondary_garment_color: order.secondary_garment_color,
    base_price: gross,
    unit_price: gross,
    discount_amount: discount,
    line_total: lineTotal,
    catalog_snapshot: order.catalog_snapshot ?? {},
    design_status: order.design_status || "pending",
    low_resolution_warning: order.low_resolution_warning,
    is_active: true,
    created_at: order.created_at,
    updated_at: order.updated_at,
    source: "legacy",
  }];
}

const AdminOrderIdInput = z.object({ orderId: z.string().uuid() });

export const adminGetOrderItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminOrderIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();
    return { items: await getOrderItemsByOrderId(data.orderId) };
  });

export const adminGetOrderDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminOrderIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      { data: order },
      { data: items },
      { data: fd },
      { data: da },
      { data: attempts },
      { data: events },
      { data: auths },
    ] = await Promise.all([
      supabaseAdmin.from("custom_orders").select("*").eq("id", data.orderId).maybeSingle(),
      supabaseAdmin.from("order_items").select("*").eq("order_id", data.orderId).order("position"),
      supabaseAdmin.from("final_designs").select("*").eq("order_id", data.orderId),
      supabaseAdmin.from("design_assets").select("*").eq("order_id", data.orderId),
      supabaseAdmin
        .from("payment_attempts")
        .select("*")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("payment_events")
        .select("id,provider,event_type,event_action,status,processed_at,processing_result,created_at")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("order_upload_authorizations")
        .select("*")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: false }),
    ]);
    if (!order) throw new Error("Pedido no encontrado");
    const adminItems = (items ?? []) as any[];
    const itemPreviews = await resolveOrderItemPreviews(
      supabaseAdmin,
      data.orderId,
      adminItems.map((item) => String(item.id)),
    );
    return {
      order: order as any,
      items: adminItems.map((item) => ({ ...item, previews: itemPreviews.get(String(item.id)) ?? [] })),
      finalDesigns: (fd ?? []) as any[],
      // Legacy rows are ambiguous: the previous client stored rendered previews
      // here. Never offer one as an original unless it is explicitly marked.
      designAssets: ((da ?? []) as any[]).filter(
        (asset) => asset?.metadata?.asset_role === "customer_original",
      ),
      attempts: (attempts ?? []) as any[],
      events: (events ?? []) as any[],
      authorizations: (auths ?? []) as any[],
    };
  });

const AdminSignInput = z.object({
  orderId: z.string().uuid(),
  assetId: z.string().uuid(),
});

async function adminSignOrderPath(
  context: any,
  orderId: string,
  assetId: string,
  ttlSeconds: number,
): Promise<{ url: string; filename: string }> {
  await requireAdmin(context);
  applyNoStoreHeaders();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: asset } = await supabaseAdmin.from("design_assets")
    .select("id,order_id,order_item_id,file_path,metadata")
    .eq("id", assetId).eq("order_id", orderId).maybeSingle();
  if (!asset?.file_path || !asset.order_item_id) throw new Error("Original no pertenece al pedido");
  const path = asset.file_path;
  if (!path.startsWith(`${orderId}/${asset.order_item_id}/`) || path.includes("..") || path.includes("//")) throw new Error("Ruta inválida");
  const { data: signed, error } = await (supabaseAdmin.storage as any)
    .from(DESIGN_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !signed?.signedUrl) throw new Error("No se pudo firmar la URL");
  const { originalFilename } = await import("@/lib/original-assets");
  return { url: signed.signedUrl as string, filename: originalFilename(asset.metadata, path) };
}

export const adminGetOrderDesignSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminSignInput.parse(i))
  .handler(async ({ data, context }) => {
    return adminSignOrderPath(context, data.orderId, data.assetId, 60 * 5);
  });

// A "production file" is a print-ready render separate from the customer
// original and the low-res canvas preview. Until the pro-generation pipeline
// exists, this endpoint always returns { url: null, status: "not_generated" }
// — it never silently signs the preview and calls it a production file.
export const adminDownloadProductionFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ orderId: z.string().uuid(), path: z.string().min(1).max(300) }).parse(i))
  .handler(async ({ context }) => {
    await requireAdmin(context);
    applyNoStoreHeaders();
    return { url: null as string | null, status: "not_generated" as const };
  });

// ------------------------------------------------------------------
// Admin delete/cleanup for unpaid orders.
// DB deletion is delegated to a transaction-safe RPC. Storage objects
// are removed only AFTER the DB transaction succeeds.
// Protected payment statuses can never be deleted.
// ------------------------------------------------------------------

const AdminDeleteOrdersInput = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
});

async function deleteOrderStorageObjects(paths: string[]): Promise<number> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await (supabaseAdmin.storage as any)
    .from(DESIGN_BUCKET)
    .remove(uniquePaths);

  if (error) {
    throw new Error(`Pedidos eliminados, pero falló la limpieza del storage: ${error.message}`);
  }

  return uniquePaths.length;
}

export const adminDeleteOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminDeleteOrdersInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc(
      "admin_delete_unpaid_orders",
      { p_order_ids: data.orderIds },
    );
    if (error) throw new Error(error.message);

    const rows = (result ?? []) as Array<{ storage_path: string | null }>;
    const storagePaths = rows
      .map((r) => r.storage_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    const deletedStorageObjects = await deleteOrderStorageObjects(storagePaths);

    return { deletedOrders: data.orderIds.length, deletedStorageObjects };
  });

export const adminCleanupStaleUnpaidOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: stale, error: staleErr } = await supabaseAdmin
      .from("custom_orders")
      .select("id")
      .lt("created_at", cutoff)
      .in("payment_status", ["pending", "rejected", "cancelled"])
      .limit(100);
    if (staleErr) throw new Error(staleErr.message);

    const orderIds = (stale ?? []).map((r: any) => r.id as string);
    if (orderIds.length === 0) {
      return { deletedOrders: 0, deletedStorageObjects: 0 };
    }

    const { data: result, error } = await (supabaseAdmin as any).rpc(
      "admin_delete_unpaid_orders",
      { p_order_ids: orderIds },
    );
    if (error) throw new Error(error.message);

    const rows = (result ?? []) as Array<{ storage_path: string | null }>;
    const storagePaths = rows
      .map((r) => r.storage_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    const deletedStorageObjects = await deleteOrderStorageObjects(storagePaths);

    return { deletedOrders: orderIds.length, deletedStorageObjects };
  });

// ------------------------------------------------------------------
// §6 Admin diagnostics — returns ONLY booleans + the env label.
// Never returns secret values, hashes, tokens, or URLs.
// ------------------------------------------------------------------
export const adminGetPaymentsDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();
    return getPaymentsGateSummary();
  });


// ------------------------------------------------------------------
// Admin recovery — regenerate the single-use public access token for an
// order, invalidate any previously issued link and revoke all active
// order sessions. The raw token is returned ONCE and never logged.
// ------------------------------------------------------------------
const AdminIssueRecoveryInput = z.object({
  orderId: z.string().uuid(),
});

export const adminIssueOrderRecoveryLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AdminIssueRecoveryInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context as any);
    applyNoStoreHeaders();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error: findErr } = await supabaseAdmin
      .from("custom_orders")
      .select("id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (findErr) throw new Error("No se pudo consultar el pedido");
    if (!order) throw new Error("Pedido no encontrado");

    const rawToken = generateOpaqueToken(32);
    const tokenHash = hashToken(rawToken);

    // Rotate hash — invalidates any previously issued recovery link.
    const { error: updErr } = await supabaseAdmin
      .from("custom_orders")
      .update({ public_access_token_hash: tokenHash })
      .eq("id", order.id);
    if (updErr) throw new Error("No se pudo emitir el enlace");

    // Revoke any active order sessions to force re-exchange with the new token.
    await supabaseAdmin
      .from("payment_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("order_id", order.id)
      .is("revoked_at", null);

    const origin = getSiteOrigin();
    const url = `${origin}/pedido/${order.id}?token=${rawToken}`;
    return { ok: true as const, url };
  });


// ------------------------------------------------------------------
// Legal acceptance — recorded before Payment Brick can mount.
// ------------------------------------------------------------------
// Canonical, deterministic JSON serializer for hashing. Sorts object keys
// recursively. Excludes non-serializable values (functions/undefined).
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map((x) => canonicalJson(x)).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ":" + canonicalJson((v as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

const LEGAL_DOC_TITLES = {
  terms: "Términos y Condiciones",
  privacy: "Política de Privacidad",
  returns: "Cambios, devoluciones, garantía y retracto",
} as const;

type LegalContent = {
  status?: string;
  updated_at?: string | null;
  sections?: Record<string, string>;
};

type LegalIdentityRow = {
  status?: string;
  trade_name?: string;
  legal_name?: string;
  rut?: string;
  address?: string;
  comuna?: string;
  region?: string;
  official_channel?: string;
  legal_email?: string;
};

function isDocPublished(doc: LegalContent | null | undefined): boolean {
  if (!doc) return false;
  if (doc.status !== "published") return false;
  const sections = doc.sections ?? {};
  return Object.values(sections).some((s) => String(s ?? "").trim().length > 0);
}

function isIdentityPublished(id: LegalIdentityRow | null | undefined): boolean {
  if (!id) return false;
  if (id.status !== "published") return false;
  return (
    !!String(id.legal_name ?? "").trim() &&
    !!String(id.rut ?? "").trim() &&
    !!String(id.address ?? "").trim() &&
    !!String(id.official_channel ?? "").trim()
  );
}

async function loadLegalRecords(): Promise<
  | { ok: true; identity: LegalIdentityRow; terms: LegalContent; privacy: LegalContent; returns: LegalContent }
  | { ok: false; code: "documents_unavailable" }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("site_content")
    .select("key,value")
    .in("key", ["legal_identity", "legal_terms", "legal_privacy", "legal_returns"]);
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const identity = (map.get("legal_identity") ?? null) as LegalIdentityRow | null;
  const terms = (map.get("legal_terms") ?? null) as LegalContent | null;
  const privacy = (map.get("legal_privacy") ?? null) as LegalContent | null;
  const returns = (map.get("legal_returns") ?? null) as LegalContent | null;
  if (
    !isIdentityPublished(identity) ||
    !isDocPublished(terms) ||
    !isDocPublished(privacy) ||
    !isDocPublished(returns)
  ) {
    return { ok: false, code: "documents_unavailable" };
  }
  return {
    ok: true,
    identity: identity!,
    terms: terms!,
    privacy: privacy!,
    returns: returns!,
  };
}

const ORDER_ACCEPTABLE_PAYMENT_STATES = new Set([
  "pending",
  "rejected",
  "cancelled",
]);

export const getLegalAcceptanceAvailability = createServerFn({ method: "POST" })
  .handler(async () => {
    applyNoStoreHeaders();
    const r = await loadLegalRecords();
    if (!r.ok) return { available: false as const };
    return {
      available: true as const,
      documents: {
        terms: { updatedAt: r.terms.updated_at ?? null },
        privacy: { updatedAt: r.privacy.updated_at ?? null },
        returns: { updatedAt: r.returns.updated_at ?? null },
      },
    };
  });

export const acceptOrderLegalDocuments = createServerFn({ method: "POST" })
  .inputValidator((i) => OrderIdInput.parse(i))
  .handler(async ({ data }) => {
    applyNoStoreHeaders();
    assertSameOrigin();
    const sess = await requireOrderSessionAndCsrf(data.orderId);
    const orderId = sess.orderId;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: readErr } = await supabaseAdmin
      .from("custom_orders")
      .select(
        "id,order_number,payment_status,customer_name,customer_email,customer_phone,shipping_address,legal_accepted_at,legal_acceptance_hash",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (readErr || !order) throw new Error("Pedido no encontrado");
    const acceptanceAddress = (order as any).shipping_address ?? {};
    if (!CustomerSchema.safeParse({
      name: (order as any).customer_name, email: (order as any).customer_email,
      phone: (order as any).customer_phone, address: acceptanceAddress.address,
      comuna: acceptanceAddress.comuna, region: acceptanceAddress.region,
      notes: acceptanceAddress.notes ?? "",
    }).success) throw new Error("Completa los datos de envío antes de aceptar las condiciones");

    // Idempotency — already accepted, return existing record verbatim.
    if ((order as any).legal_accepted_at) {
      return {
        accepted: true as const,
        acceptedAt: (order as any).legal_accepted_at as string,
        hash: (order as any).legal_acceptance_hash as string,
        idempotent: true as const,
      };
    }

    if (!ORDER_ACCEPTABLE_PAYMENT_STATES.has((order as any).payment_status)) {
      return { accepted: false as const, code: "order_not_acceptable" as const };
    }

    const docs = await loadLegalRecords();
    if (!docs.ok) {
      return { accepted: false as const, code: "documents_unavailable" as const };
    }

    // Server-owned timestamp — never trusted from the client.
    const acceptedAt = new Date().toISOString();

    // Snapshot content (identity + three documents) is what the hash covers.
    // acceptedAt / orderId / orderNumber stay outside the signed payload so
    // the same document versions yield the same hash across orders — useful
    // for audit and duplicate detection.
    const signedContent = {
      schemaVersion: 1,
      seller: {
        tradeName: String(docs.identity.trade_name ?? ""),
        legalName: String(docs.identity.legal_name ?? ""),
        rut: String(docs.identity.rut ?? ""),
        address: String(docs.identity.address ?? ""),
        officialChannel: String(docs.identity.official_channel ?? ""),
        legalEmail: String(docs.identity.legal_email ?? ""),
      },
      documents: {
        terms: {
          key: "legal_terms",
          title: LEGAL_DOC_TITLES.terms,
          updatedAt: docs.terms.updated_at ?? null,
          content: docs.terms.sections ?? {},
        },
        privacy: {
          key: "legal_privacy",
          title: LEGAL_DOC_TITLES.privacy,
          updatedAt: docs.privacy.updated_at ?? null,
          content: docs.privacy.sections ?? {},
        },
        returns: {
          key: "legal_returns",
          title: LEGAL_DOC_TITLES.returns,
          updatedAt: docs.returns.updated_at ?? null,
          content: docs.returns.sections ?? {},
        },
      },
    };
    const hash = createHash("sha256")
      .update(canonicalJson(signedContent), "utf8")
      .digest("hex");

    const snapshot = {
      ...signedContent,
      acceptedAt,
      orderId: (order as any).id as string,
      orderNumber: (order as any).order_number as string,
    };

    // Idempotent write: only set the columns if still NULL. If a concurrent
    // request lost the race, re-read and return the winning record.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("custom_orders")
      .update({
        legal_accepted_at: acceptedAt,
        legal_acceptance_snapshot: snapshot as any,
        legal_acceptance_hash: hash,
      } as any)
      .eq("id", orderId)
      .is("legal_accepted_at", null)
      .select("legal_accepted_at,legal_acceptance_hash")
      .maybeSingle();
    if (updErr) {
      console.error("[acceptOrderLegalDocuments] update", updErr.message);
      throw new Error("No se pudo registrar la aceptación");
    }
    if (!updated) {
      // Row already accepted between the read above and the update — reload.
      const { data: existing } = await supabaseAdmin
        .from("custom_orders")
        .select("legal_accepted_at,legal_acceptance_hash")
        .eq("id", orderId)
        .maybeSingle();
      return {
        accepted: true as const,
        acceptedAt: (existing as any)?.legal_accepted_at as string,
        hash: (existing as any)?.legal_acceptance_hash as string,
        idempotent: true as const,
      };
    }
    return {
      accepted: true as const,
      acceptedAt: (updated as any).legal_accepted_at as string,
      hash: (updated as any).legal_acceptance_hash as string,
      idempotent: false as const,
    };
  });
