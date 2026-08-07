import { supabase } from "@/integrations/supabase/client";
import {
  requestDesignUpload,
  markOrderDesignFailed,
} from "@/lib/orders.functions";
import {
  computeGarmentGeometry,
} from "@/lib/garment-render-geometry";
import { cloneGarmentPrintArea, type GarmentPrintArea } from "@/lib/garment-model";

export type Design = { url: string; x: number; y: number; scale: number; rotate: number };

/**
 * Fuente mínima requerida para renderizar el PNG final de una prenda.
 * Debe provenir de la fila `garments` seleccionada por el cliente.
 */
export type GarmentRenderSource = {
  id: string;
  type: "polera" | "poleron";
  base_url: string | null;
  overlay_url: string | null;
  mockup_url: string | null;
  preview_url: string | null;
  print_area: GarmentPrintArea | null;
  source_width: number | null;
  source_height: number | null;
};

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${url}`));
    img.src = url;
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function pickBaseUrl(g: GarmentRenderSource): string {
  const url = g.base_url || g.mockup_url || g.preview_url;
  if (!url) {
    throw new Error("La prenda no tiene una imagen base utilizable (base/mockup/preview).");
  }
  return url;
}

/**
 * Renderiza el PNG final de la prenda usando exactamente el mismo mockup,
 * print_area, overlay y geometría que muestra el editor
 * (GarmentDesignCanvas / StepPreview). No dibuja siluetas genéricas ni
 * fondos: si algún insumo falta o es inválido, la exportación falla.
 */
export async function renderGarmentPNG(
  garment: GarmentRenderSource,
  design: Design,
): Promise<Blob> {
  const printArea = cloneGarmentPrintArea(garment.print_area);
  if (!printArea) {
    throw new Error("La prenda no tiene un print_area válido.");
  }

  const baseUrl = pickBaseUrl(garment);
  const baseImg = await loadImage(baseUrl);

  const rawW = Number.isInteger(garment.source_width) && (garment.source_width ?? 0) > 0
    ? (garment.source_width as number)
    : baseImg.naturalWidth;
  const rawH = Number.isInteger(garment.source_height) && (garment.source_height ?? 0) > 0
    ? (garment.source_height as number)
    : baseImg.naturalHeight;

  if (!(rawW > 0) || !(rawH > 0)) {
    throw new Error("La imagen base de la prenda no tiene dimensiones válidas.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = rawW;
  canvas.height = rawH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el contexto 2D del canvas.");

  // 1. Base / mockup — sin fondo agregado.
  ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

  // 2. Diseño del cliente dentro de print_area.
  const designImg = await loadImage(design.url);
  const geom = computeGarmentGeometry({
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    printArea,
    design,
    designNaturalWidth: designImg.naturalWidth,
    designNaturalHeight: designImg.naturalHeight,
  });

  if (!(geom.drawWidth > 0) || !(geom.drawHeight > 0)) {
    throw new Error("Dimensiones finales del diseño no válidas.");
  }

  ctx.save();
  // Clip al print_area (con radio si aplica).
  ctx.beginPath();
  const { x: ax, y: ay, width: aw, height: ah, radius } = geom.area;
  if (radius > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(ax, ay, aw, ah, radius);
  } else {
    ctx.rect(ax, ay, aw, ah);
  }
  ctx.clip();

  ctx.translate(geom.centerX, geom.centerY);
  ctx.rotate((geom.rotateDeg * Math.PI) / 180);
  ctx.drawImage(
    designImg,
    -geom.drawWidth / 2,
    -geom.drawHeight / 2,
    geom.drawWidth,
    geom.drawHeight,
  );
  ctx.restore();

  // 3. Overlay real, si existe.
  if (garment.overlay_url) {
    const overlayImg = await loadImage(garment.overlay_url);
    ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height);
  }

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("No se pudo generar el PNG de la prenda."));
    }, "image/png"),
  );
}

/**
 * Upload a rendered design blob to the private `order-designs` bucket via a
 * signed URL emitted by the server. No public URLs, no blob: URLs stored,
 * and the path is chosen server-side and namespaced by orderId.
 * Returns the permanent storage path (not a URL).
 */
export async function uploadOrderDesign(
  orderId: string,
  kind: "case" | "garment" | "secondary_garment",
  blob: Blob,
): Promise<string> {
  const contentType = blob.type || "image/png";
  const req = await requestDesignUpload({
    data: { orderId, kind, contentType, size: blob.size },
  });
  const { error: upErr } = await supabase.storage
    .from(req.bucket)
    .uploadToSignedUrl(req.path, req.token, blob, {
      contentType,
      upsert: false,
    });
  if (upErr) {
    try {
      await markOrderDesignFailed({ data: { orderId } });
    } catch {
      /* ignore */
    }
    throw upErr;
  }
  return req.path;
}
