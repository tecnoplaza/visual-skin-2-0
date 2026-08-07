/**
 * Utilidad compartida para el área de impresión de `phone_models.print_area`.
 *
 * Valor predeterminado obligatorio: 0/0/100/100 con radio 8 y sin cámara.
 * No se usa 15/15/70/70 en ningún caso.
 */

export type PhoneModelPrintAreaCamera = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhoneModelPrintArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  camera: PhoneModelPrintAreaCamera | null;
};

export function getDefaultPhonePrintArea(): PhoneModelPrintArea {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    radius: 8,
    camera: null,
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidCamera(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    isFiniteNumber(c.x) &&
    isFiniteNumber(c.y) &&
    isFiniteNumber(c.width) &&
    isFiniteNumber(c.height)
  );
}

export function isValidPhonePrintArea(value: unknown): value is PhoneModelPrintArea {
  if (value === null || value === undefined || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return false;
  if (!isFiniteNumber(v.width) || !isFiniteNumber(v.height)) return false;
  if (!isFiniteNumber(v.radius)) return false;
  if (v.width <= 0 || v.height <= 0) return false;
  if (v.x < 0 || v.y < 0 || v.radius < 0) return false;
  if (!("camera" in v)) {
    // camera puede faltar (undefined) — permitido
  }
  if (!isValidCamera((v as { camera?: unknown }).camera)) return false;
  return true;
}

/**
 * Devuelve una copia del área existente cuando es válida.
 * Cuando falta o es inválida, devuelve el valor predeterminado 0/0/100/100.
 * Nunca modifica ni normaliza un área válida.
 */
export function getSafePhonePrintArea(value: unknown): PhoneModelPrintArea {
  if (!isValidPhonePrintArea(value)) return getDefaultPhonePrintArea();
  const v = value as PhoneModelPrintArea;
  const camera =
    v.camera && typeof v.camera === "object"
      ? { x: v.camera.x, y: v.camera.y, width: v.camera.width, height: v.camera.height }
      : null;
  return {
    x: v.x,
    y: v.y,
    width: v.width,
    height: v.height,
    radius: v.radius,
    camera,
  };
}
