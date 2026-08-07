/**
 * Modelo y validación de prendas (poleras, polerones).
 * No se conecta todavía al personalizador ni al checkout.
 */

export type GarmentType = "polera" | "poleron";
export type GarmentView = "front" | "back";

export type GarmentPrintArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

const DEFAULTS: Record<GarmentType, GarmentPrintArea> = {
  polera: { x: 30, y: 23, width: 40, height: 44, radius: 0 },
  poleron: { x: 31, y: 28, width: 38, height: 39, radius: 0 },
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidGarmentPrintArea(value: unknown): value is GarmentPrintArea {
  if (value === null || value === undefined || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return false;
  if (!isFiniteNumber(v.width) || !isFiniteNumber(v.height)) return false;
  if (!isFiniteNumber(v.radius)) return false;
  if (v.width <= 0 || v.height <= 0) return false;
  if (v.x < 0 || v.y < 0 || v.radius < 0) return false;
  if (v.x + v.width > 100) return false;
  if (v.y + v.height > 100) return false;
  return true;
}

export function cloneGarmentPrintArea(value: unknown): GarmentPrintArea | null {
  if (!isValidGarmentPrintArea(value)) return null;
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    radius: value.radius,
  };
}

export function getDefaultGarmentPrintArea(type: GarmentType): GarmentPrintArea {
  const d = DEFAULTS[type] ?? DEFAULTS.polera;
  return { ...d };
}
