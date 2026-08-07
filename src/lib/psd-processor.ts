import { readPsd, type Layer } from "ag-psd";

export type PsdArtifacts = {
  overlay: Blob;   // capa molde con transparencia
  holes: Blob;     // capa orificios/cámara con transparencia
  mockup: Blob;    // overlay + holes compuestos (vista del teléfono)
  preview: Blob;   // igual que mockup, pensado para thumbs
  width: number;
  height: number;
};

const HOLE_HINTS = /(hole|orific|camar|camera|lens|hueco|corte)/i;
const MOLD_HINTS = /(mold|carcas|case|frame|body|contorno)/i;

function pickLayers(children: Layer[]): { mold?: Layer; holes?: Layer } {
  // Aplanar sólo el primer nivel (asume estructura del proveedor: 2 capas)
  const flat = children.filter((l) => l.canvas || l.imageData);
  let mold = flat.find((l) => l.name && MOLD_HINTS.test(l.name));
  let holes = flat.find((l) => l.name && HOLE_HINTS.test(l.name));
  if (!mold && !holes && flat.length >= 2) {
    // Fallback: capa 1 = molde, capa 2 = orificios (según proveedor)
    mold = flat[0];
    holes = flat[1];
  } else if (!mold && flat.length) {
    mold = flat.find((l) => l !== holes) ?? flat[0];
  } else if (!holes && flat.length > 1) {
    holes = flat.find((l) => l !== mold);
  }
  return { mold, holes };
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

export async function processPsd(buf: ArrayBuffer): Promise<PsdArtifacts> {
  const psd = readPsd(buf, { useImageData: false, skipThumbnail: true });
  const width = psd.width;
  const height = psd.height;
  if (!psd.children || psd.children.length === 0) {
    throw new Error("El PSD no contiene capas");
  }
  const { mold, holes } = pickLayers(psd.children);
  if (!mold) throw new Error("No se detectó capa de molde");

  const overlayCanvas = layerToCanvas(mold, width, height);
  const holesCanvas = holes
    ? layerToCanvas(holes, width, height)
    : (() => {
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        return c;
      })();

  // Composición mockup = overlay debajo, holes encima
  const mockupCanvas = document.createElement("canvas");
  mockupCanvas.width = width;
  mockupCanvas.height = height;
  const mctx = mockupCanvas.getContext("2d")!;
  mctx.drawImage(overlayCanvas, 0, 0);
  mctx.drawImage(holesCanvas, 0, 0);

  const [overlay, holesBlob, mockup] = await Promise.all([
    canvasToPngBlob(overlayCanvas),
    canvasToPngBlob(holesCanvas),
    canvasToPngBlob(mockupCanvas),
  ]);

  return { overlay, holes: holesBlob, mockup, preview: mockup, width, height };
}
