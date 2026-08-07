import { isValidGarmentPrintArea, type GarmentPrintArea } from "@/lib/garment-model";

/**
 * Ancho base del diseño del cliente medido como fracción del ancho del
 * print_area, antes de aplicar `design.scale`. Es la única constante que
 * define el tamaño inicial del diseño y DEBE ser usada tanto por el editor
 * (GarmentDesignCanvas) como por el renderer del PNG final
 * (renderGarmentPNG). No duplicar este número en ninguna otra parte.
 */
export const GARMENT_DESIGN_BASE_WIDTH_FRACTION = 0.8;

export type GarmentGeometryInput = {
  canvasWidth: number;
  canvasHeight: number;
  printArea: GarmentPrintArea;
  design: { x: number; y: number; scale: number; rotate: number };
  designNaturalWidth: number;
  designNaturalHeight: number;
};

export type GarmentGeometry = {
  area: { x: number; y: number; width: number; height: number; radius: number };
  centerX: number;
  centerY: number;
  drawWidth: number;
  drawHeight: number;
  rotateDeg: number;
};

/**
 * Convierte el estado del diseño en coordenadas absolutas de píxeles,
 * usando el mismo modelo que el editor:
 *   - print_area viene en % del lienzo.
 *   - el diseño se centra sobre el print_area y se desplaza por (x, y).
 *   - el ancho base del diseño es `GARMENT_DESIGN_BASE_WIDTH_FRACTION` del
 *     ancho del print_area, multiplicado por `design.scale`.
 *   - la altura conserva la proporción natural de la imagen.
 *   - `design.rotate` está en grados.
 */
export function computeGarmentGeometry(input: GarmentGeometryInput): GarmentGeometry {
  const { canvasWidth, canvasHeight, printArea, design } = input;
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
    throw new Error("Canvas sin dimensiones válidas");
  }
  if (!isValidGarmentPrintArea(printArea)) {
    throw new Error("print_area inválido");
  }
  if (!(input.designNaturalWidth > 0) || !(input.designNaturalHeight > 0)) {
    throw new Error("Diseño sin dimensiones válidas");
  }

  const areaX = (canvasWidth * printArea.x) / 100;
  const areaY = (canvasHeight * printArea.y) / 100;
  const areaW = (canvasWidth * printArea.width) / 100;
  const areaH = (canvasHeight * printArea.height) / 100;

  const baseW = areaW * GARMENT_DESIGN_BASE_WIDTH_FRACTION;
  const drawWidth = baseW * design.scale;
  const drawHeight = drawWidth * (input.designNaturalHeight / input.designNaturalWidth);

  const centerX = areaX + areaW / 2 + design.x;
  const centerY = areaY + areaH / 2 + design.y;

  return {
    area: { x: areaX, y: areaY, width: areaW, height: areaH, radius: printArea.radius },
    centerX,
    centerY,
    drawWidth,
    drawHeight,
    rotateDeg: design.rotate,
  };
}
