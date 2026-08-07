/**
 * Procesador PSD independiente para prendas (poleras, polerones).
 * NO reutiliza src/lib/psd-processor.ts porque pertenece a carcasas.
 */

import { readPsd, type Layer } from "ag-psd";
import type { GarmentPrintArea } from "./garment-model";

export type GarmentPsdArtifacts = {
  base: Blob | null;
  overlay: Blob | null;
  mockup: Blob;
  preview: Blob;
  width: number;
  height: number;
  printArea: GarmentPrintArea | null;
  printAreaDetected: boolean;
};

const PRINT_AREA_HINTS = [
  "print area",
  "print_area",
  "printarea",
  "area impresion",
  "area de impresion",
  "impresion",
  "diseno",
  "design",
  "artwork",
  "smart object",
  "smartobject",
  "estampa",
];
const BASE_HINTS = [
  "base",
  "prenda",
  "garment",
  "shirt",
  "tshirt",
  "t-shirt",
  "polera",
  "hoodie",
  "poleron",
];
const OVERLAY_HINTS = [
  "overlay",
  "shadows",
  "shadow",
  "highlights",
  "luces",
  "sombras",
  "textura",
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesAny(name: string | undefined, hints: string[]): boolean {
  if (!name) return false;
  const n = normalize(name);
  return hints.some((h) => n.includes(h));
}

type FlatLayer = { layer: Layer; name: string };

function flattenLayers(layers: Layer[] | undefined, out: FlatLayer[] = []): FlatLayer[] {
  if (!layers) return out;
  for (const l of layers) {
    if (l.children && l.children.length) {
      flattenLayers(l.children, out);
    }
    if (l.canvas || l.imageData) {
      out.push({ layer: l, name: l.name ?? "" });
    }
  }
  return out;
}

function layerToCanvas(layer: Layer, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (layer.canvas) {
    const lx = layer.left ?? 0;
    const ly = layer.top ?? 0;
    ctx.drawImage(layer.canvas, lx, ly);
  }
  return canvas;
}

function canvasToPngBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => {
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob null"))), "image/png");
  });
}

/**
 * Calcula bounding box no-transparente de una capa y lo devuelve en % del PSD.
 */
function computePrintAreaFromLayer(
  layer: Layer,
  psdW: number,
  psdH: number,
): GarmentPrintArea | null {
  const canvas = layerToCanvas(layer, psdW, psdH);
  const ctx = canvas.getContext("2d")!;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, psdW, psdH);
  } catch {
    return null;
  }
  const px = data.data;
  let minX = psdW;
  let minY = psdH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < psdH; y++) {
    for (let x = 0; x < psdW; x++) {
      const a = px[(y * psdW + x) * 4 + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const area: GarmentPrintArea = {
    x: Math.max(0, (minX / psdW) * 100),
    y: Math.max(0, (minY / psdH) * 100),
    width: Math.max(0.1, (w / psdW) * 100),
    height: Math.max(0.1, (h / psdH) * 100),
    radius: 0,
  };
  if (area.x + area.width > 100) area.width = 100 - area.x;
  if (area.y + area.height > 100) area.height = 100 - area.y;
  return area;
}

export async function processGarmentPsd(buf: ArrayBuffer): Promise<GarmentPsdArtifacts> {
  const psd = readPsd(buf, { useImageData: false, skipThumbnail: true });
  const width = psd.width;
  const height = psd.height;
  if (!psd.children || psd.children.length === 0) {
    throw new Error("El PSD no contiene capas");
  }
  const flat = flattenLayers(psd.children);
  if (flat.length === 0) throw new Error("El PSD no contiene capas visibles");

  const printLayer = flat.find((f) => matchesAny(f.name, PRINT_AREA_HINTS));
  const baseLayer =
    flat.find((f) => matchesAny(f.name, BASE_HINTS) && f !== printLayer) ??
    flat.find((f) => f !== printLayer);
  const overlayLayer = flat.find(
    (f) => matchesAny(f.name, OVERLAY_HINTS) && f !== printLayer && f !== baseLayer,
  );

  if (!baseLayer) throw new Error("No se detectó capa base de la prenda");

  const printArea = printLayer ? computePrintAreaFromLayer(printLayer.layer, width, height) : null;
  const printAreaDetected = printArea !== null;

  const baseCanvas = layerToCanvas(baseLayer.layer, width, height);
  const overlayCanvas = overlayLayer ? layerToCanvas(overlayLayer.layer, width, height) : null;

  const mockupCanvas = document.createElement("canvas");
  mockupCanvas.width = width;
  mockupCanvas.height = height;
  const mctx = mockupCanvas.getContext("2d")!;
  mctx.drawImage(baseCanvas, 0, 0);
  if (overlayCanvas) mctx.drawImage(overlayCanvas, 0, 0);

  const [base, overlay, mockup] = await Promise.all([
    canvasToPngBlob(baseCanvas),
    overlayCanvas ? canvasToPngBlob(overlayCanvas) : Promise.resolve(null),
    canvasToPngBlob(mockupCanvas),
  ]);

  return {
    base,
    overlay,
    mockup,
    preview: mockup,
    width,
    height,
    printArea,
    printAreaDetected,
  };
}
