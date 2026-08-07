import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Group, Image as KImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import type Konva from "konva";

export type PrintArea = {
  x: number; y: number; width: number; height: number; radius: number;
  camera?: { x: number; y: number; width: number; height: number } | null;
};
export type Design = { url: string; x: number; y: number; scale: number; rotate: number };
type Model = {
  name: string;
  overlay_url: string | null;
  mockup_url: string | null;
  holes_url: string | null;
  print_area: PrintArea | null;
};

const DEFAULT_PRINT_AREA: PrintArea = { x: 15, y: 15, width: 70, height: 70, radius: 8, camera: null };
const DEFAULT_STAGE_W = 360;
const DEFAULT_STAGE_H = 720;

function isPercent(pa: PrintArea) {
  return Math.max(pa.x, pa.y, pa.width, pa.height) <= 100;
}

function readVisibleBounds(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4;
        if (data[i + 3] > 8) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  } catch {
    return null;
  }
}

export default function CaseCanvasKonva({
  model, design, onChange, debug = false, readOnly = false, stageRef,
}: {
  model: Model;
  design: Design | null;
  onChange: (d: Design) => void;
  debug?: boolean;
  readOnly?: boolean;
  stageRef?: React.MutableRefObject<Konva.Stage | null>;
}) {
  // Stage size is FIXED. It is computed ONCE from the overlay's natural aspect
  // ratio and then memoized. It never depends on the customer image, and no
  // ResizeObserver drives it.
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: DEFAULT_STAGE_W,
    h: DEFAULT_STAGE_H,
  });
  const sizedOverlayRef = useRef<string | null>(null);

  const overlaySrc = model.overlay_url || model.mockup_url || "";
  const [overlayImg, overlayStatus] = useImage(overlaySrc, "anonymous");
  const [holesImg] = useImage(model.holes_url || "", "anonymous");
  const [customerImg, customerStatus] = useImage(design?.url || "", "anonymous");

  // Initialize stage size ONCE per PSD/model from the overlay natural size.
  // It can change when the selected model changes, never when the customer
  // image changes.
  useEffect(() => {
    if (!overlaySrc || !overlayImg) return;
    if (sizedOverlayRef.current === overlaySrc) return;
    const aspect = overlayImg.width / overlayImg.height;
    if (!aspect || !isFinite(aspect)) return;
    const w = DEFAULT_STAGE_W;
    const h = Math.round(w / aspect);
    sizedOverlayRef.current = overlaySrc;
    setStageSize({ w, h });
  }, [overlayImg, overlaySrc]);

  const { w: stageW, h: stageH } = stageSize;
  const overlayRect = useMemo(
    () => ({ x: 0, y: 0, w: stageW, h: stageH }),
    [stageW, stageH],
  );

  const moldBoundsPx = useMemo(() => {
    if (!overlayImg) return null;
    const bounds = readVisibleBounds(overlayImg);
    if (!bounds) return null;
    const sx = overlayRect.w / overlayImg.width;
    const sy = overlayRect.h / overlayImg.height;
    return {
      x: bounds.x * sx,
      y: bounds.y * sy,
      w: bounds.w * sx,
      h: bounds.h * sy,
      r: 0,
    };
  }, [overlayImg, overlayRect]);

  const pa = model.print_area ?? DEFAULT_PRINT_AREA;
  const paPx = useMemo(() => {
    let out;
    if (!model.print_area && moldBoundsPx) {
      out = moldBoundsPx;
    } else if (isPercent(pa)) {
      out = {
        x: (pa.x / 100) * overlayRect.w,
        y: (pa.y / 100) * overlayRect.h,
        w: (pa.width / 100) * overlayRect.w,
        h: (pa.height / 100) * overlayRect.h,
        r: Math.min(((pa.radius ?? 0) / 100) * overlayRect.w, overlayRect.w / 2, overlayRect.h / 2),
      };
    } else {
      out = { x: pa.x, y: pa.y, w: pa.width, h: pa.height, r: pa.radius ?? 0 };
    }
    // Fallback: if print_area is missing or degenerate, use the full stage
    // so the customer image is at least visible (was returning 0x0 → invisible).
    if (!out.w || !out.h || out.w <= 0 || out.h <= 0) {
      out = { x: 0, y: 0, w: overlayRect.w, h: overlayRect.h, r: 0 };
    }
    return out;
  }, [model.print_area, moldBoundsPx, pa, overlayRect]);


  // Initialize customer image transform ONCE per url.
  const customerInitializedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!customerImg || !design) return;
    if (customerInitializedRef.current === design.url) return;
    customerInitializedRef.current = design.url;
    if (design.x !== 0 || design.y !== 0 || design.scale !== 1 || design.rotate !== 0) {
      onChange({ ...design, x: 0, y: 0, scale: 1, rotate: 0 });
    }
  }, [customerImg, design, onChange]);

  // Base "cover" size of the customer image inside the print area.
  let baseW = 0, baseH = 0;
  if (customerImg && paPx.w > 0 && paPx.h > 0) {
    const ir = customerImg.width / customerImg.height;
    const par = paPx.w / paPx.h;
    if (ir > par) { baseH = paPx.h; baseW = paPx.h * ir; }
    else { baseW = paPx.w; baseH = paPx.w / ir; }
  }
  const imgW = baseW * (design?.scale ?? 1);
  const imgH = baseH * (design?.scale ?? 1);
  const centerX = paPx.x + paPx.w / 2 + (design?.x ?? 0);
  const centerY = paPx.y + paPx.h / 2 + (design?.y ?? 0);

  const clipFunc = (ctx: Konva.Context) => {
    const c = ctx as unknown as CanvasRenderingContext2D;
    const { x, y, w, h, r } = paPx;
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  };

  const [noMask, setNoMask] = useState(false);
  // El PSD genera el molde visual de referencia. Por defecto se usa debajo
  // de la foto para que un overlay opaco nunca tape la imagen del cliente.
  const [moldAsBg, setMoldAsBg] = useState(true);


  return (
    <div className="relative inline-block">
      <div
        className="relative overflow-hidden rounded-xl border border-border"
        style={{ width: stageW, height: stageH, background: "transparent" }}
      >
        <Stage width={stageW} height={stageH} ref={stageRef as React.Ref<Konva.Stage>}>
          <Layer>
            {/* Molde del PSD como referencia debajo de la imagen del cliente */}
            {moldAsBg && overlayImg && (
              <KImage
                image={overlayImg}
                x={overlayRect.x}
                y={overlayRect.y}
                width={overlayRect.w}
                height={overlayRect.h}
                listening={false}
              />
            )}

            {!customerImg && (
              <Rect
                x={paPx.x}
                y={paPx.y}
                width={paPx.w}
                height={paPx.h}
                cornerRadius={paPx.r}
                fill="rgba(0,0,0,0.06)"
                listening={false}
              />
            )}

            <Group clipFunc={noMask ? undefined : clipFunc}>
              {customerImg && design && (
                <KImage
                  image={customerImg}
                  x={centerX}
                  y={centerY}
                  width={imgW}
                  height={imgH}
                  offsetX={imgW / 2}
                  offsetY={imgH / 2}
                  rotation={design.rotate}
                  draggable={!readOnly}
                  listening={!readOnly}
                  onDragEnd={(e) => {
                    const nx = e.target.x() - (paPx.x + paPx.w / 2);
                    const ny = e.target.y() - (paPx.y + paPx.h / 2);
                    onChange({ ...design, x: nx, y: ny });
                  }}
                />
              )}
            </Group>

            {/* Overlay encima solo para moldes transparentes; si es opaco, dejarlo abajo */}
            {!noMask && !moldAsBg && overlayImg && (
              <KImage
                image={overlayImg}
                x={overlayRect.x}
                y={overlayRect.y}
                width={overlayRect.w}
                height={overlayRect.h}
                listening={false}
              />
            )}

            {/* Holes/cámara siempre encima del diseño */}
            {!noMask && holesImg && (
              <KImage
                image={holesImg}
                x={overlayRect.x}
                y={overlayRect.y}
                width={overlayRect.w}
                height={overlayRect.h}
                listening={false}
              />
            )}


            {debug && (
              <>
                <Rect
                  x={paPx.x} y={paPx.y} width={paPx.w} height={paPx.h}
                  cornerRadius={paPx.r}
                  stroke="red" strokeWidth={2} listening={false}
                />
                <Text
                  x={8} y={8}
                  fill="red"
                  fontSize={11}
                  text={[
                    `Stage: ${stageW}x${stageH}`,
                    `Overlay: ${overlayImg?.width ?? "-"}x${overlayImg?.height ?? "-"}`,
                    `PrintArea: ${Math.round(paPx.x)},${Math.round(paPx.y)} ${Math.round(paPx.w)}x${Math.round(paPx.h)}`,
                    `PrintArea fuente: ${model.print_area ? "modelo" : moldBoundsPx ? "molde PSD" : "fallback"}`,
                    `customerImageUrl: ${design?.url ? "sí" : "no"}`,
                    `customerImage: ${customerImg ? `cargada ${customerImg.width}x${customerImg.height}` : customerStatus}`,
                    `imgDraw: ${Math.round(imgW)}x${Math.round(imgH)} @ ${Math.round(centerX)},${Math.round(centerY)}`,
                    `transform: x=${Math.round(design?.x ?? 0)} y=${Math.round(design?.y ?? 0)} s=${(design?.scale ?? 1).toFixed(2)} r=${Math.round(design?.rotate ?? 0)}`,
                    `moldAsBg: ${moldAsBg ? "sí" : "no"}`,
                    `noMask: ${noMask ? "sí" : "no"}`,
                  ].join("\n")}
                />
              </>
            )}
          </Layer>
        </Stage>

        {overlayStatus === "loading" && (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            Cargando molde…
          </div>
        )}
        {design && customerStatus === "loading" && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            Cargando imagen…
          </div>
        )}

        {!readOnly && (
          <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => setMoldAsBg((v) => !v)}
              className="rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] font-medium shadow-sm hover:bg-background"
            >
              {moldAsBg ? "Molde transparente encima" : "Foto encima del molde"}
            </button>
            <button
              type="button"
              onClick={() => setNoMask((v) => !v)}
              className="rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] font-medium shadow-sm hover:bg-background"
            >
              {noMask ? "Restaurar máscara" : "Mostrar imagen sin máscara"}
            </button>
          </div>
        )}

      </div>

      {!readOnly && design && customerImg && (
        <NudgeControls design={design} onChange={onChange} />
      )}
    </div>
  );
}

function NudgeControls({
  design,
  onChange,
}: {
  design: Design;
  onChange: (d: Design) => void;
}) {
  const [step, setStep] = useState(5);
  const nudge = (dx: number, dy: number) =>
    onChange({ ...design, x: (design.x ?? 0) + dx, y: (design.y ?? 0) + dy });

  const btn =
    "h-9 w-9 rounded-md border border-border bg-background text-sm font-semibold shadow-sm hover:bg-accent active:scale-95 transition";

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Ajustar posición
        </span>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>Paso</span>
          <select
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
          >
            <option value={1}>1 px</option>
            <option value={5}>5 px</option>
            <option value={10}>10 px</option>
            <option value={25}>25 px</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 w-max mx-auto">
        <div />
        <button type="button" className={btn} onClick={() => nudge(0, -step)} aria-label="Mover arriba">↑</button>
        <div />
        <button type="button" className={btn} onClick={() => nudge(-step, 0)} aria-label="Mover izquierda">←</button>
        <button
          type="button"
          className={btn}
          onClick={() => onChange({ ...design, x: 0, y: 0 })}
          aria-label="Centrar"
          title="Centrar"
        >
          ⌾
        </button>
        <button type="button" className={btn} onClick={() => nudge(step, 0)} aria-label="Mover derecha">→</button>
        <div />
        <button type="button" className={btn} onClick={() => nudge(0, step)} aria-label="Mover abajo">↓</button>
        <div />
      </div>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-20">Horizontal</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={1}
            value={Math.round(design.x ?? 0)}
            onChange={(e) => onChange({ ...design, x: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums">{Math.round(design.x ?? 0)}</span>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-20">Vertical</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={1}
            value={Math.round(design.y ?? 0)}
            onChange={(e) => onChange({ ...design, y: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-10 text-right tabular-nums">{Math.round(design.y ?? 0)}</span>
        </label>
      </div>
    </div>
  );
}

