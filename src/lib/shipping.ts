// Reglas de despacho VisualSkin.
// Función pura + configuración persistida en site_content (clave: shipping_config).
// El cálculo canónico ocurre en el servidor (orders.functions.ts). El navegador
// solo puede usar `estimateShippingForPack` como estimación no confiable.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SHIPPING_CONFIG_KEY = "shipping_config";

export type ShippingItemKind = "case" | "polera" | "poleron";
export type ShippingItem = { kind: ShippingItemKind; qty: number };

export type ShippingConfig = {
  enabled: boolean;
  singleCaseAmount: number;
  singleGarmentAmount: number;
  casePlusTshirtAmount: number;
  freeShippingFromQuantity: number;
  casePlusTshirtExceptionEnabled: boolean;
  updatedAt: string | null;
};

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  enabled: true,
  singleCaseAmount: 1990,
  singleGarmentAmount: 2490,
  casePlusTshirtAmount: 2490,
  freeShippingFromQuantity: 2,
  casePlusTshirtExceptionEnabled: true,
  updatedAt: null,
};

export type ShippingRule =
  | "shipping_disabled"
  | "empty_cart"
  | "single_case"
  | "single_garment"
  | "case_plus_tshirt"
  | "free_by_quantity"
  | "fallback";

export type ShippingResult = { amount: number; rule: ShippingRule };

// Sanitiza un entero CLP ≥ 0.
function clampAmount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  const i = Math.trunc(v);
  return i < 0 ? 0 : i;
}

// Normaliza una configuración cargada desde CMS aplicando defaults + límites.
export function normalizeShippingConfig(
  raw: Partial<ShippingConfig> | null | undefined,
): ShippingConfig {
  const src = (raw ?? {}) as Partial<ShippingConfig>;
  const min = Math.max(
    1,
    Math.trunc(Number(src.freeShippingFromQuantity ?? DEFAULT_SHIPPING_CONFIG.freeShippingFromQuantity)) || 1,
  );
  return {
    enabled: src.enabled !== false,
    singleCaseAmount: clampAmount(src.singleCaseAmount ?? DEFAULT_SHIPPING_CONFIG.singleCaseAmount),
    singleGarmentAmount: clampAmount(src.singleGarmentAmount ?? DEFAULT_SHIPPING_CONFIG.singleGarmentAmount),
    casePlusTshirtAmount: clampAmount(src.casePlusTshirtAmount ?? DEFAULT_SHIPPING_CONFIG.casePlusTshirtAmount),
    freeShippingFromQuantity: min,
    casePlusTshirtExceptionEnabled:
      src.casePlusTshirtExceptionEnabled !== false,
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : null,
  };
}

// Convierte el pack_type de un pedido en la composición real de productos.
export function packTypeToItems(packType: string): ShippingItem[] {
  switch (packType) {
    case "carcasa":
      return [{ kind: "case", qty: 1 }];
    case "carcasa+polera":
      return [
        { kind: "case", qty: 1 },
        { kind: "polera", qty: 1 },
      ];
    case "carcasa+poleron":
      return [
        { kind: "case", qty: 1 },
        { kind: "poleron", qty: 1 },
      ];
    case "carcasa+polera+poleron":
      return [
        { kind: "case", qty: 1 },
        { kind: "polera", qty: 1 },
        { kind: "poleron", qty: 1 },
      ];
    default:
      return [];
  }
}

// Función pura y determinista. Nunca lanza. Cuentan unidades, no líneas.
export function calculateShippingAmount(
  items: ShippingItem[],
  cfg: ShippingConfig,
): ShippingResult {
  if (!cfg.enabled) return { amount: 0, rule: "shipping_disabled" };

  let cases = 0;
  let poleras = 0;
  let polerones = 0;
  for (const it of items) {
    const q = Math.max(0, Math.trunc(Number(it?.qty ?? 0)));
    if (q <= 0) continue;
    if (it.kind === "case") cases += q;
    else if (it.kind === "polera") poleras += q;
    else if (it.kind === "poleron") polerones += q;
  }
  const garments = poleras + polerones;
  const total = cases + garments;

  if (total <= 0) return { amount: 0, rule: "empty_cart" };

  // 1 carcasa sola.
  if (cases === 1 && garments === 0) {
    return { amount: cfg.singleCaseAmount, rule: "single_case" };
  }
  // 1 prenda sola (polera o polerón).
  if (cases === 0 && garments === 1) {
    return { amount: cfg.singleGarmentAmount, rule: "single_garment" };
  }
  // Excepción: exactamente 1 carcasa + 1 polera.
  if (
    cfg.casePlusTshirtExceptionEnabled &&
    cases === 1 &&
    poleras === 1 &&
    polerones === 0
  ) {
    return { amount: cfg.casePlusTshirtAmount, rule: "case_plus_tshirt" };
  }
  // Envío gratis desde cantidad mínima.
  if (total >= cfg.freeShippingFromQuantity) {
    return { amount: 0, rule: "free_by_quantity" };
  }
  // Fallback seguro: si por alguna razón no aplicó nada, no cobrar dos veces.
  return { amount: 0, rule: "fallback" };
}

// Estimación cliente (no confiable). El servidor recalcula antes de crear/pagar.
export function estimateShippingForPack(
  packType: string,
  cfg: ShippingConfig,
): ShippingResult {
  return calculateShippingAmount(packTypeToItems(packType), cfg);
}

// ------------------- CMS load/save (cliente) -------------------

export const shippingConfigKeys = {
  root: ["cms", "shipping_config"] as const,
};

export async function fetchShippingConfig(): Promise<ShippingConfig> {
  const { data } = await supabase
    .from("site_content")
    .select("value")
    .eq("key", SHIPPING_CONFIG_KEY)
    .maybeSingle();
  return normalizeShippingConfig((data?.value ?? null) as Partial<ShippingConfig> | null);
}

export function useShippingConfig() {
  return useQuery({
    queryKey: shippingConfigKeys.root,
    queryFn: fetchShippingConfig,
    staleTime: 60_000,
  });
}

// Validación admin. Devuelve mapa de errores por campo.
export function validateShippingConfigInput(input: {
  enabled: boolean;
  singleCaseAmount: number | string;
  singleGarmentAmount: number | string;
  casePlusTshirtAmount: number | string;
  freeShippingFromQuantity: number | string;
  casePlusTshirtExceptionEnabled: boolean;
}): { errors: Record<string, string>; value: ShippingConfig } {
  const errors: Record<string, string> = {};

  function parseAmount(raw: number | string, field: string): number {
    const s = String(raw ?? "").trim();
    if (!s) {
      if (input.enabled) errors[field] = "Ingresa un monto válido en pesos chilenos.";
      return 0;
    }
    if (!/^-?\d+$/.test(s)) {
      errors[field] = "Ingresa un monto entero en pesos chilenos, sin decimales.";
      return 0;
    }
    const n = parseInt(s, 10);
    if (n < 0) {
      errors[field] = "El valor del despacho no puede ser negativo.";
      return 0;
    }
    if (n > 1_000_000) {
      errors[field] = "El monto supera el máximo permitido.";
      return 0;
    }
    return n;
  }

  const singleCaseAmount = parseAmount(input.singleCaseAmount, "singleCaseAmount");
  const singleGarmentAmount = parseAmount(input.singleGarmentAmount, "singleGarmentAmount");
  const casePlusTshirtAmount = parseAmount(input.casePlusTshirtAmount, "casePlusTshirtAmount");

  const qStr = String(input.freeShippingFromQuantity ?? "").trim();
  let freeQ = 0;
  if (!qStr || !/^\d+$/.test(qStr)) {
    errors.freeShippingFromQuantity = "La cantidad para envío gratis debe ser de al menos 1 producto.";
  } else {
    freeQ = parseInt(qStr, 10);
    if (freeQ < 1) errors.freeShippingFromQuantity = "La cantidad para envío gratis debe ser de al menos 1 producto.";
    if (freeQ > 20) errors.freeShippingFromQuantity = "La cantidad ingresada supera el máximo razonable.";
  }

  const value: ShippingConfig = normalizeShippingConfig({
    enabled: input.enabled,
    singleCaseAmount,
    singleGarmentAmount,
    casePlusTshirtAmount,
    freeShippingFromQuantity: freeQ || 1,
    casePlusTshirtExceptionEnabled: input.casePlusTshirtExceptionEnabled,
    updatedAt: new Date().toISOString(),
  });
  return { errors, value };
}

// Etiquetas legibles para la regla aplicada (uso administrativo).
export const SHIPPING_RULE_LABELS: Record<ShippingRule, string> = {
  shipping_disabled: "Despacho desactivado",
  empty_cart: "Pedido vacío",
  single_case: "Una carcasa",
  single_garment: "Una prenda",
  case_plus_tshirt: "Carcasa + polera (excepción)",
  free_by_quantity: "Gratis por cantidad",
  fallback: "Sin regla aplicable (gratis por seguridad)",
};

// Formato CLP entero.
export function formatCLP(n: number): string {
  const v = Math.max(0, Math.trunc(Number(n) || 0));
  return `$${v.toLocaleString("es-CL")}`;
}
