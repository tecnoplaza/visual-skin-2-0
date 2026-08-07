import type { GarmentPrintArea } from "@/lib/garment-model";
import { GARMENT_DESIGN_BASE_WIDTH_FRACTION } from "@/lib/garment-render-geometry";

export type GarmentCanvasRow = {
  id: string;
  name: string;
  color: string;
  view: string;
  base_url: string | null;
  overlay_url: string | null;
  mockup_url: string | null;
  preview_url: string | null;
  print_area: GarmentPrintArea | null;
};

export type GarmentDesign = {
  url: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
};

/**
 * Canvas real de prenda: reemplaza la silueta SVG por el mockup importado.
 * El diseño del cliente se dibuja recortado dentro del rectángulo print_area
 * del molde. El overlay (si existe) queda por encima con pointer-events-none.
 */
export default function GarmentDesignCanvas({
  garment,
  design,
  readOnly = false,
}: {
  garment: GarmentCanvasRow;
  design: GarmentDesign | null;
  onChange?: (d: GarmentDesign | null) => void;
  readOnly?: boolean;
}) {
  const baseImage = garment.base_url || garment.mockup_url || garment.preview_url;
  const overlay = garment.overlay_url;
  const area = garment.print_area;

  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded-xl border border-border"
      style={{
        backgroundColor: "#f4f4f5",
        backgroundImage:
          "linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      }}
      aria-label={`Mockup ${garment.name}`}
      data-readonly={readOnly ? "true" : "false"}
    >
      {baseImage ? (
        <img
          src={baseImage}
          alt={garment.name}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          Sin mockup
        </div>
      )}

      {area && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: `${area.x}%`,
            top: `${area.y}%`,
            width: `${area.width}%`,
            height: `${area.height}%`,
            borderRadius: area.radius > 0 ? `${area.radius}px` : undefined,
          }}
        >
          {design && (
            <img
              src={design.url}
              alt="Diseño"
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                transform: `translate(calc(-50% + ${design.x}px), calc(-50% + ${design.y}px)) scale(${design.scale}) rotate(${design.rotate}deg)`,
                width: `${GARMENT_DESIGN_BASE_WIDTH_FRACTION * 100}%`,
              }}
              draggable={false}
            />
          )}
        </div>
      )}

      {overlay && (
        <img
          src={overlay}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      )}
    </div>
  );
}
