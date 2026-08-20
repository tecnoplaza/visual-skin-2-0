import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Upload, Smartphone, Shirt, Check, ArrowRight, ArrowLeft, Trash2, Loader2, RotateCw, Wand2 } from "lucide-react";
import type Konva from "konva";
import { PACK_PRICES } from "../lib/mock-data";
import { supabase } from "@/integrations/supabase/client";
import { removeImageBackground } from "@/lib/remove-bg";
import { usePromoPack, usePromoPacks } from "@/lib/cms";
import { dataUrlToBlob, renderGarmentPNG, uploadOrderItemDesign } from "@/lib/order-export";
import { addOrderItem, createSecureOrder, finalizeOrderItemDesigns, getOrderCsrfToken } from "@/lib/orders.functions";
import { trackVisualSkinEvent } from "@/lib/analytics";
import { setOrderCsrfToken } from "@/lib/order-csrf-store";
import { activeCartQueryOptions, cartWriteMode, CART_QUERY_KEY } from "@/lib/cart";
import GarmentDesignCanvas, { type GarmentCanvasRow } from "@/components/personalizador/GarmentDesignCanvas";
import { isValidGarmentPrintArea, type GarmentPrintArea } from "@/lib/garment-model";
import { toast } from "sonner";

const CaseCanvasKonva = lazy(() => import("@/components/personalizador/CaseCanvasKonva"));

export type GarmentRow = {
  id: string;
  type: "polera" | "poleron";
  name: string;
  slug: string | null;
  color: string;
  view: string;
  sizes: string[];
  price: number;
  is_active: boolean;
  mold_status: string;
  base_url: string | null;
  overlay_url: string | null;
  mockup_url: string | null;
  preview_url: string | null;
  print_area: GarmentPrintArea | null;
  source_width: number | null;
  source_height: number | null;
};

function isValidGarment(g: GarmentRow): boolean {
  return (
    g.is_active &&
    g.mold_status === "listo" &&
    !!g.mockup_url &&
    isValidGarmentPrintArea(g.print_area)
  );
}


type PackId = "carcasa" | "carcasa+polera" | "carcasa+poleron" | "carcasa+polera+poleron";
type Search = { pack?: PackId; id?: string; editItem?: string };

export const Route = createFileRoute("/personalizador")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    pack: s.pack === "carcasa+polera+poleron" ? "carcasa+polera+poleron"
        : s.pack === "carcasa+poleron" ? "carcasa+poleron"
        : s.pack === "carcasa" ? "carcasa"
        : "carcasa+polera",
    id: typeof s.id === "string" ? s.id : undefined,
    editItem: typeof s.editItem === "string" ? s.editItem : undefined,
  }),

  component: Personalizador,
  head: () => ({
    meta: [
      { title: "Personalizador — VISUALSKIN" },
      { name: "description", content: "Diseña tu carcasa y tu polera o polerón. Elige tu modelo, sube tu imagen y ajústala dentro del molde." },
    ],
  }),
});


type Design = { url: string; x: number; y: number; scale: number; rotate: number; originalFile?: File };
type PrintArea = { x: number; y: number; width: number; height: number; radius: number; camera?: { x: number; y: number; width: number; height: number } | null };
type BrandRow = { id: string; name: string; slug: string };
type ModelRow = {
  id: string; brand_id: string; name: string; slug: string;
  mockup_url: string | null; preview_url: string | null;
  overlay_url: string | null; holes_url: string | null;
  mold_status: "pendiente_conversion" | "listo" | "error_conversion";
  print_area: PrintArea | null;
};

type PersistedDesignLayer = {
  assetRef: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  width?: number;
  height?: number;
};
const modelImage = (m?: ModelRow | null) => m?.overlay_url || m?.mockup_url || m?.preview_url || null;
const modelReady = (m?: ModelRow | null) => !!m && m.mold_status === "listo" && !!modelImage(m);

function Personalizador() {
  const { pack: initialPack, id: promoId, editItem } = Route.useSearch();
  const { data: promoPack } = usePromoPack(promoId);
  // Only used to decide whether the "Carcasa + Polera + Polerón" pill is shown
  // in the initial selector. The pill is rendered only when an active promo
  // pack row for pack_type='carcasa+polera+poleron' exists in the CMS.
  const { data: activePacks } = usePromoPacks(true);
  const completePromoPack =
    (activePacks ?? []).find(
      (p) => p.pack_type === "carcasa+polera+poleron" && p.is_active,
    ) ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: activeCart } = useQuery(activeCartQueryOptions());
  // If a CMS pack is loaded, its type wins over the ?pack= param.
  const pack: PackId = (promoPack?.pack_type as PackId | undefined) ?? initialPack ?? "carcasa+polera";
  const isCompletePack = pack === "carcasa+polera+poleron";
  const hasShirt = pack === "carcasa+polera" || pack === "carcasa+poleron";


  const [step, setStep] = useState(1);
  const [brandId, setBrandId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [size, setSize] = useState<"S" | "M" | "L" | "XL">("M");
  const [color, setColor] = useState<string>("Blanco");
  const [caseDesign, setCaseDesign] = useState<Design | null>(null);
  const [shirtDesign, setShirtDesign] = useState<Design | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const clientItemKeyRef = useRef(`cart-${crypto.randomUUID()}`);
  useEffect(() => { trackVisualSkinEvent({ event_name: "customizer_started", pack_type: pack }); }, []);

  const previewStageRef = useRef<Konva.Stage | null>(null);

  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [garments, setGarments] = useState<GarmentRow[]>([]);
  const [garmentId, setGarmentId] = useState<string>("");

  // Complete pack: independent state for polera + poleron.
  const [completeShirts, setCompleteShirts] = useState<GarmentRow[]>([]);
  const [completeShirtId, setCompleteShirtId] = useState<string>("");
  const [completeShirtSize, setCompleteShirtSize] = useState<"S" | "M" | "L" | "XL">("M");
  const [completeShirtDesign, setCompleteShirtDesign] = useState<Design | null>(null);
  const [completeHoodies, setCompleteHoodies] = useState<GarmentRow[]>([]);
  const [completeHoodieId, setCompleteHoodieId] = useState<string>("");
  const [completeHoodieSize, setCompleteHoodieSize] = useState<"S" | "M" | "L" | "XL">("M");
  const [completeHoodieDesign, setCompleteHoodieDesign] = useState<Design | null>(null);

  useEffect(() => {
    supabase.from("brands").select("id,name,slug").eq("is_active", true).order("sort_order")
      .then(({ data }) => setBrands((data ?? []) as BrandRow[]));
  }, []);

  useEffect(() => {
    if (!brandId) { setModels([]); return; }
    supabase.from("phone_models")
      .select("id,brand_id,name,slug,mockup_url,preview_url,overlay_url,holes_url,mold_status,print_area")
      .eq("brand_id", brandId).eq("is_active", true).eq("mold_status", "listo").order("sort_order")
      .then(({ data }) => setModels((data ?? []) as ModelRow[]));
  }, [brandId]);

  const garmentType: "polera" | "poleron" | null = hasShirt
    ? (pack === "carcasa+poleron" ? "poleron" : "polera")
    : null;

  useEffect(() => {
    // When pack type changes, wipe garment selection + design so the design
    // is not applied over a different mold.
    setGarmentId("");
    setShirtDesign(null);
    if (!garmentType) { setGarments([]); return; }
    supabase.from("garments")
      .select("id,type,name,slug,color,view,sizes,price,is_active,mold_status,base_url,overlay_url,mockup_url,preview_url,print_area,source_width,source_height")
      .eq("type", garmentType)
      .eq("is_active", true)
      .eq("mold_status", "listo")
      .eq("view", "front")
      .order("sort_order")
      .order("name")
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as GarmentRow[]).filter(isValidGarment);
        setGarments(rows);
        if (rows.length > 0) setGarmentId(rows[0].id);
      });
  }, [garmentType]);

  // Complete pack: fetch poleras + polerones independently.
  useEffect(() => {
    if (!isCompletePack) {
      setCompleteShirts([]); setCompleteShirtId(""); setCompleteShirtDesign(null);
      setCompleteHoodies([]); setCompleteHoodieId(""); setCompleteHoodieDesign(null);
      return;
    }
    const cols = "id,type,name,slug,color,view,sizes,price,is_active,mold_status,base_url,overlay_url,mockup_url,preview_url,print_area,source_width,source_height";
    supabase.from("garments").select(cols)
      .eq("type", "polera").eq("is_active", true).eq("mold_status", "listo").eq("view", "front")
      .order("sort_order").order("name")
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as GarmentRow[]).filter(isValidGarment);
        setCompleteShirts(rows);
        if (rows.length > 0) {
          setCompleteShirtId(rows[0].id);
          const s = rows[0].sizes;
          if (s.length > 0 && !s.includes("M")) setCompleteShirtSize(s[0] as "S" | "M" | "L" | "XL");
        }
      });
    supabase.from("garments").select(cols)
      .eq("type", "poleron").eq("is_active", true).eq("mold_status", "listo").eq("view", "front")
      .order("sort_order").order("name")
      .then(({ data }) => {
        const rows = ((data ?? []) as unknown as GarmentRow[]).filter(isValidGarment);
        setCompleteHoodies(rows);
        if (rows.length > 0) {
          setCompleteHoodieId(rows[0].id);
          const s = rows[0].sizes;
          if (s.length > 0 && !s.includes("M")) setCompleteHoodieSize(s[0] as "S" | "M" | "L" | "XL");
        }
      });
  }, [isCompletePack]);

  const selectedGarment = garments.find((g) => g.id === garmentId) ?? null;
  const selectedCompleteShirt = completeShirts.find((g) => g.id === completeShirtId) ?? null;
  const selectedCompleteHoodie = completeHoodies.find((g) => g.id === completeHoodieId) ?? null;

  const brand = brands.find((b) => b.id === brandId);
  const model = models.find((m) => m.id === modelId);
  useEffect(() => {
    if (model) trackVisualSkinEvent({ event_name: "view_item", pack_type: pack, phone_brand: brand?.name, phone_model: model.name, value: price, currency: "CLP" });
  }, [model?.id]);

  const stepLabels = isCompletePack
    ? ["Modelo", "Carcasa", "Polera", "Polerón", "Vista previa"]
    : hasShirt
    ? ["Modelo", "Carcasa", "Prenda", "Vista previa"]
    : ["Modelo", "Carcasa", "Vista previa"];
  const totalSteps = stepLabels.length;
  const previewStep = totalSteps;
  const shirtStep = hasShirt ? 3 : null;
  const completeShirtStep = isCompletePack ? 3 : null;
  const completeHoodieStep = isCompletePack ? 4 : null;

  // Clamp step if user switches from pack with shirt to solo carcasa
  useEffect(() => {
    if (step > totalSteps) setStep(totalSteps);
  }, [step, totalSteps]);

  const garmentReady = !hasShirt || (!!selectedGarment && isValidGarment(selectedGarment) && !!shirtDesign);
  const completeShirtReady = !!selectedCompleteShirt && isValidGarment(selectedCompleteShirt) && !!completeShirtDesign && selectedCompleteShirt.sizes.includes(completeShirtSize);
  const completeHoodieReady = !!selectedCompleteHoodie && isValidGarment(selectedCompleteHoodie) && !!completeHoodieDesign && selectedCompleteHoodie.sizes.includes(completeHoodieSize);

  const canNext = useMemo(() => {
    if (step === 1) return !!modelId;
    if (step === 2) return !!caseDesign;
    if (shirtStep && step === shirtStep) return garmentReady;
    if (completeShirtStep && step === completeShirtStep) return completeShirtReady;
    if (completeHoodieStep && step === completeHoodieStep) return completeHoodieReady;
    return true;
  }, [step, modelId, caseDesign, shirtStep, garmentReady, completeShirtStep, completeShirtReady, completeHoodieStep, completeHoodieReady]);

  const basePrice = promoPack ? Number(promoPack.price) : PACK_PRICES[pack];
  const price = promoPack
    ? Number(promoPack.sale_price ?? promoPack.price)
    : PACK_PRICES[pack];
  const hasSale = promoPack != null && promoPack.sale_price != null && Number(promoPack.sale_price) < Number(promoPack.price);

  const defaultLabel = pack === "carcasa" ? "Solo Carcasa"
    : pack === "carcasa+polera" ? "Carcasa + Polera"
    : pack === "carcasa+poleron" ? "Carcasa + Polerón"
    : "Carcasa + Polera + Polerón";
  const packLabel = promoPack?.name ?? defaultLabel;


  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-bold md:text-4xl">Personalizador</h1>
        <p className="mt-2 text-sm text-muted-foreground">Diseña tu pack en {totalSteps} pasos</p>
      </div>
      {editItem && (
        <div className="mb-6 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-300">
          La edición de un diseño guardado todavía no está habilitada porque el canvas no puede restaurar sus capas sin riesgo de pérdida. Puedes volver al carrito o crear un producto nuevo.
        </div>
      )}

      <div className="mb-8 flex items-center justify-center gap-2 overflow-x-auto">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active ? "border-neon-blue bg-neon-blue/10 text-neon-blue" :
                done ? "border-neon-green/50 text-neon-green" :
                "border-border text-muted-foreground"
              }`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-background text-[10px] font-bold">
                  {done ? <Check className="h-3 w-3" /> : n}
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </div>
              {n < totalSteps && <div className="h-px w-4 bg-border md:w-8" />}
            </div>
          );
        })}
      </div>

      {promoPack ? (
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-neon-green bg-neon-green/10 px-4 py-1.5 text-xs text-neon-green">
            Pack: <b>{promoPack.name}</b>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {(["carcasa", "carcasa+polera", "carcasa+poleron"] as const).map((p) => (
            <a
              key={p}
              href={`/personalizador?pack=${encodeURIComponent(p)}`}
              className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${
                pack === p ? "border-neon-green bg-neon-green/10 text-neon-green" : "border-border text-muted-foreground"
              }`}
            >
              {p === "carcasa" ? "Solo Carcasa" : p === "carcasa+polera" ? "Carcasa + Polera" : "Carcasa + Polerón"}
            </a>
          ))}
          {completePromoPack && (
            <a
              key="carcasa+polera+poleron"
              href={`/personalizador?id=${encodeURIComponent(completePromoPack.id)}`}
              className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${
                pack === "carcasa+polera+poleron"
                  ? "border-neon-green bg-neon-green/10 text-neon-green"
                  : "border-border text-muted-foreground"
              }`}
            >
              Carcasa + Polera + Polerón
            </a>
          )}
        </div>
      )}


      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-border bg-card p-6">
          {step === 1 && (
            <StepModel
              brands={brands} models={models}
              brandId={brandId} modelId={modelId}
              onBrand={(id) => { setBrandId(id); setModelId(""); }}
              onModel={setModelId}
            />
          )}
          {step === 2 && (
            <StepCase design={caseDesign} onChange={setCaseDesign} model={model} />
          )}
          {shirtStep && step === shirtStep && hasShirt && garmentType ? (
            <StepShirt
              type={garmentType}
              size={size} onSize={setSize}
              color={color} onColor={setColor}
              design={shirtDesign} onChange={setShirtDesign}
              garments={garments}
              garmentId={garmentId}
              onSelectGarment={(g) => {
                setGarmentId(g.id);
                setColor(g.color);
                setShirtDesign(null);
                if (!g.sizes.includes(size) && g.sizes.length > 0) {
                  setSize(g.sizes[0] as "S" | "M" | "L" | "XL");
                }
              }}
            />
          ) : null}

          {completeShirtStep && step === completeShirtStep && isCompletePack ? (
            <StepShirt
              type="polera"
              size={completeShirtSize} onSize={setCompleteShirtSize}
              color={selectedCompleteShirt?.color ?? ""} onColor={() => {}}
              design={completeShirtDesign} onChange={setCompleteShirtDesign}
              garments={completeShirts}
              garmentId={completeShirtId}
              onSelectGarment={(g) => {
                setCompleteShirtId(g.id);
                setCompleteShirtDesign(null);
                if (!g.sizes.includes(completeShirtSize) && g.sizes.length > 0) {
                  setCompleteShirtSize(g.sizes[0] as "S" | "M" | "L" | "XL");
                }
              }}
            />
          ) : null}

          {completeHoodieStep && step === completeHoodieStep && isCompletePack ? (
            <StepShirt
              type="poleron"
              size={completeHoodieSize} onSize={setCompleteHoodieSize}
              color={selectedCompleteHoodie?.color ?? ""} onColor={() => {}}
              design={completeHoodieDesign} onChange={setCompleteHoodieDesign}
              garments={completeHoodies}
              garmentId={completeHoodieId}
              onSelectGarment={(g) => {
                setCompleteHoodieId(g.id);
                setCompleteHoodieDesign(null);
                if (!g.sizes.includes(completeHoodieSize) && g.sizes.length > 0) {
                  setCompleteHoodieSize(g.sizes[0] as "S" | "M" | "L" | "XL");
                }
              }}
            />
          ) : null}

          {step === previewStep && (
            <StepPreview
              pack={pack} brand={brand?.name} model={model} size={size}
              caseDesign={caseDesign} shirtDesign={shirtDesign} price={price}
              stageRef={previewStageRef}
              garment={selectedGarment}
              completeShirt={selectedCompleteShirt}
              completeShirtDesign={completeShirtDesign}
              completeShirtSize={completeShirtSize}
              completeHoodie={selectedCompleteHoodie}
              completeHoodieDesign={completeHoodieDesign}
              completeHoodieSize={completeHoodieSize}
            />
          )}


          <div className="mt-8 flex justify-between border-t border-border pt-6">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> Atrás
            </button>
            {step < previewStep ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-5 py-2 text-sm font-semibold text-background disabled:opacity-40"
              >
                Siguiente <ArrowRight className="h-4 w-4" />
              </button>
            ) : isCompletePack ? (
              (() => {
                const completeActive = promoPack?.is_active === true;
                const completeReady =
                  completeActive &&
                  !!model &&
                  !!caseDesign &&
                  !!selectedCompleteShirt &&
                  selectedCompleteShirt.type === "polera" &&
                  isValidGarment(selectedCompleteShirt) &&
                  !!completeShirtDesign &&
                  selectedCompleteShirt.sizes.includes(completeShirtSize) &&
                  !!selectedCompleteHoodie &&
                  selectedCompleteHoodie.type === "poleron" &&
                  isValidGarment(selectedCompleteHoodie) &&
                  !!completeHoodieDesign &&
                  selectedCompleteHoodie.sizes.includes(completeHoodieSize) &&
                  selectedCompleteShirt.id !== selectedCompleteHoodie.id;
                return completeActive ? (
                  <button
                    onClick={() => { if (!showCheckout) { trackVisualSkinEvent({event_name:"customizer_completed",pack_type:pack,phone_brand:brand?.name,phone_model:model?.name}); setShowCheckout(true); } }}
                    disabled={!completeReady || showCheckout}
                    aria-busy={showCheckout || undefined}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-5 py-2 text-sm font-semibold text-background disabled:opacity-40"
                  >
                    Agregar al carrito · ${price.toLocaleString("es-CL")}
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                      {showCheckout && <Loader2 className="h-4 w-4 animate-spin" />}
                    </span>
                  </button>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      disabled
                      className="inline-flex items-center gap-2 rounded-lg bg-secondary px-5 py-2 text-sm font-semibold text-muted-foreground opacity-70 cursor-not-allowed"
                    >
                      Pack completo en validación
                    </button>
                    <p className="max-w-xs text-right text-[10px] text-muted-foreground">
                      Los tres diseños están listos. La compra se habilitará al completar la integración del pedido.
                    </p>
                  </div>
                );
              })()
            ) : (
              <button
                onClick={() => { if (!showCheckout) { trackVisualSkinEvent({event_name:"customizer_completed",pack_type:pack,phone_brand:brand?.name,phone_model:model?.name}); setShowCheckout(true); } }}
                disabled={showCheckout || !caseDesign || (hasShirt && (!shirtDesign || !selectedGarment)) || !model}
                aria-busy={showCheckout || undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-5 py-2 text-sm font-semibold text-background disabled:opacity-40"
              >
                Agregar al carrito · ${price.toLocaleString("es-CL")}
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {showCheckout && <Loader2 className="h-4 w-4 animate-spin" />}
                </span>
              </button>
            )}
          </div>
        </div>

        {showCheckout && (
          <CheckoutDialog
            additionalItem
            onClose={() => setShowCheckout(false)}
            onSubmit={async () => {
              if (isCompletePack) {
                if (!promoPack || promoPack.is_active !== true) {
                  throw new Error("PACK_COMPLETE_NOT_ENABLED");
                }
                if (!model || !caseDesign) throw new Error("Faltan datos");
                if (!selectedCompleteShirt || selectedCompleteShirt.type !== "polera") {
                  throw new Error("Selecciona una polera válida");
                }
                if (!isValidGarment(selectedCompleteShirt) || !selectedCompleteShirt.mockup_url) {
                  throw new Error("La polera no tiene mockup o área de impresión válida");
                }
                if (!selectedCompleteShirt.sizes.includes(completeShirtSize)) {
                  throw new Error("Talla de polera inválida");
                }
                if (!completeShirtDesign) throw new Error("Falta el diseño de la polera");
                if (!selectedCompleteHoodie || selectedCompleteHoodie.type !== "poleron") {
                  throw new Error("Selecciona un polerón válido");
                }
                if (!isValidGarment(selectedCompleteHoodie) || !selectedCompleteHoodie.mockup_url) {
                  throw new Error("El polerón no tiene mockup o área de impresión válida");
                }
                if (!selectedCompleteHoodie.sizes.includes(completeHoodieSize)) {
                  throw new Error("Talla de polerón inválida");
                }
                if (!completeHoodieDesign) throw new Error("Falta el diseño del polerón");
                if (selectedCompleteShirt.id === selectedCompleteHoodie.id) {
                  throw new Error("Las dos prendas deben ser diferentes");
                }

                // 1. Render three PNGs.
                const stage = previewStageRef.current;
                if (!stage) throw new Error("Vista previa no está lista");
                const caseDataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
                const caseBlob = dataUrlToBlob(caseDataUrl);
                const shirtBlob = await renderGarmentPNG(selectedCompleteShirt, completeShirtDesign);
                const hoodieBlob = await renderGarmentPNG(selectedCompleteHoodie, completeHoodieDesign);

                const selection = {
                  packId: promoPack.id, packType: "carcasa+polera+poleron" as const,
                  phoneModelId: model.id, brand: brand?.name ?? null,
                  garmentId: selectedCompleteShirt.id, garmentSize: completeShirtSize,
                  garmentColor: selectedCompleteShirt.color,
                  secondaryGarmentId: selectedCompleteHoodie.id,
                  secondaryGarmentSize: completeHoodieSize,
                  secondaryGarmentColor: selectedCompleteHoodie.color,
                };
                let orderId: string;
                let orderItemId: string;
                if (cartWriteMode(activeCart) === "add_item" && activeCart) {
                  orderId = activeCart.order.id;
                  const csrf = await getOrderCsrfToken({ data: { orderId } });
                  setOrderCsrfToken(orderId, csrf.csrfToken);
                  const added = await addOrderItem({ data: {
                    orderId, clientItemKey: clientItemKeyRef.current, ...selection,
                  } }) as { item?: { id?: string } };
                  if (!added.item?.id) throw new Error("No se pudo agregar el producto");
                  orderItemId = added.item.id;
                } else {
                  const created = await createSecureOrder({ data: selection });
                  orderId = created.id;
                  orderItemId = created.orderItemId;
                  setOrderCsrfToken(orderId, created.csrfToken);
                }
                await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });

                // Keep exact customer files separate from rendered previews.
                const casePath = await uploadOrderItemDesign(orderId, orderItemId, "case", caseDesign.originalFile!);
                const garmentPath = await uploadOrderItemDesign(orderId, orderItemId, "garment", completeShirtDesign.originalFile!);
                const secondaryGarmentPath = await uploadOrderItemDesign(orderId, orderItemId, "secondary_garment", completeHoodieDesign.originalFile!);
                const casePreviewPath = await uploadOrderItemDesign(orderId, orderItemId, "case", caseBlob);
                const garmentPreviewPath = await uploadOrderItemDesign(orderId, orderItemId, "garment", shirtBlob);
                const secondaryGarmentPreviewPath = await uploadOrderItemDesign(orderId, orderItemId, "secondary_garment", hoodieBlob);

                // 4. Build design JSON with three layers.
                const persistedCaseDesign: PersistedDesignLayer = {
                  assetRef: casePreviewPath,
                  x: caseDesign.x, y: caseDesign.y,
                  scale: caseDesign.scale, rotate: caseDesign.rotate,
                };
                const persistedShirtDesign: PersistedDesignLayer = {
                  assetRef: garmentPreviewPath,
                  x: completeShirtDesign.x, y: completeShirtDesign.y,
                  scale: completeShirtDesign.scale, rotate: completeShirtDesign.rotate,
                };
                const persistedHoodieDesign: PersistedDesignLayer = {
                  assetRef: secondaryGarmentPreviewPath,
                  x: completeHoodieDesign.x, y: completeHoodieDesign.y,
                  scale: completeHoodieDesign.scale, rotate: completeHoodieDesign.rotate,
                };
                const persistedDesignJson = {
                  editor_schema_version: "1",
                  template_version: "1",
                  modelId: model.id,
                  moldId: model.id,
                  case: persistedCaseDesign,
                  garment: persistedShirtDesign,
                  secondary_garment: persistedHoodieDesign,
                };

                await finalizeOrderItemDesigns({
                  data: {
                    orderId, orderItemId,
                    casePath,
                    garmentPath,
                    secondaryGarmentPath,
                    casePreviewPath,
                    garmentPreviewPath,
                    secondaryGarmentPreviewPath,
                    originalFilenames: {
                      case: caseDesign.originalFile!.name,
                      garment: completeShirtDesign.originalFile!.name,
                      secondary_garment: completeHoodieDesign.originalFile!.name,
                    },
                    designJson: persistedDesignJson,
                  },
                });

                await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
                trackVisualSkinEvent({event_name:"add_to_cart",order_id:orderId,order_item_id:orderItemId,pack_type:selection.packType,phone_brand:brand?.name,phone_model:model.name,value:price,currency:"CLP",metadata:{quantity:1}});
                navigate({ to: "/carrito", search: { added: true } });
                return;
              }

              if (!model || !caseDesign) throw new Error("Faltan datos");
              if (hasShirt) {
                if (!selectedGarment || !selectedGarment.id) {
                  throw new Error("Selecciona una prenda válida antes de continuar");
                }
                if (!selectedGarment.is_active || selectedGarment.mold_status !== "listo") {
                  throw new Error("La prenda seleccionada no está disponible");
                }
                if (!selectedGarment.mockup_url || !isValidGarment(selectedGarment)) {
                  throw new Error("La prenda seleccionada no tiene mockup o área de impresión válida");
                }
              }

              // 1. Render case + garment locally.
              const stage = previewStageRef.current;
              if (!stage) throw new Error("Vista previa no está lista");
              const caseDataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
              const caseBlob = dataUrlToBlob(caseDataUrl);

              let garmentBlob: Blob | null = null;
              if (hasShirt && shirtDesign && selectedGarment) {
                garmentBlob = await renderGarmentPNG(selectedGarment, shirtDesign);
              }

              const selection = {
                packId: promoId ?? null, packType: pack, phoneModelId: model.id,
                brand: brand?.name ?? null,
                garmentId: hasShirt ? selectedGarment?.id ?? null : null,
                garmentSize: hasShirt ? size : null,
                garmentColor: hasShirt ? selectedGarment?.color ?? null : null,
                secondaryGarmentId: null, secondaryGarmentSize: null, secondaryGarmentColor: null,
              };
              let orderId: string;
              let orderItemId: string;
              if (cartWriteMode(activeCart) === "add_item" && activeCart) {
                orderId = activeCart.order.id;
                const csrf = await getOrderCsrfToken({ data: { orderId } });
                setOrderCsrfToken(orderId, csrf.csrfToken);
                const added = await addOrderItem({ data: {
                  orderId, clientItemKey: clientItemKeyRef.current, ...selection,
                } }) as { item?: { id?: string } };
                if (!added.item?.id) throw new Error("No se pudo agregar el producto");
                orderItemId = added.item.id;
              } else {
                const created = await createSecureOrder({ data: selection });
                orderId = created.id;
                orderItemId = created.orderItemId;
                setOrderCsrfToken(orderId, created.csrfToken);
              }
              await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });


              // 3. Request signed uploads and push each blob to the private bucket.
              const casePath = await uploadOrderItemDesign(orderId, orderItemId, "case", caseDesign.originalFile!);
              const casePreviewPath = await uploadOrderItemDesign(orderId, orderItemId, "case", caseBlob);
              let garmentPath: string | null = null;
              let garmentPreviewPath: string | null = null;
              if (garmentBlob) {
                garmentPath = await uploadOrderItemDesign(orderId, orderItemId, "garment", shirtDesign!.originalFile!);
                garmentPreviewPath = await uploadOrderItemDesign(orderId, orderItemId, "garment", garmentBlob);
              }

              // 4. Build persisted design JSON (server-safe, no blob: URLs).
              const persistedCaseDesign: PersistedDesignLayer = {
                assetRef: casePreviewPath,
                x: caseDesign.x,
                y: caseDesign.y,
                scale: caseDesign.scale,
                rotate: caseDesign.rotate,
              };
              const persistedGarmentDesign: PersistedDesignLayer | null =
                garmentPath && shirtDesign
                  ? {
                      assetRef: garmentPreviewPath!,
                      x: shirtDesign.x,
                      y: shirtDesign.y,
                      scale: shirtDesign.scale,
                      rotate: shirtDesign.rotate,
                    }
                  : null;
              const persistedDesignJson = {
                editor_schema_version: "1",
                template_version: "1",
                modelId: model.id,
                moldId: model.id,
                case: persistedCaseDesign,
                ...(persistedGarmentDesign ? { garment: persistedGarmentDesign } : {}),
              };

              await finalizeOrderItemDesigns({
                data: {
                  orderId, orderItemId,
                  casePath,
                  garmentPath,
                  casePreviewPath,
                  garmentPreviewPath,
                  originalFilenames: {
                    case: caseDesign.originalFile!.name,
                    ...(shirtDesign?.originalFile ? { garment: shirtDesign.originalFile.name } : {}),
                  },
                  designJson: persistedDesignJson,
                },
              });

              await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
              trackVisualSkinEvent({event_name:"add_to_cart",order_id:orderId,order_item_id:orderItemId,pack_type:selection.packType,phone_brand:brand?.name,phone_model:model.name,value:price,currency:"CLP",metadata:{quantity:1}});
              navigate({ to: "/carrito", search: { added: true } });
            }}
          />
        )}

        <aside className="rounded-2xl border border-border bg-card p-6 h-fit lg:sticky lg:top-20">
          <h3 className="font-display text-lg font-semibold">Resumen</h3>
          {promoPack?.image_url && (
            <img src={promoPack.image_url} alt="" className="mt-3 h-32 w-full rounded-xl object-cover" />
          )}
          {promoPack?.description && (
            <p className="mt-3 text-xs text-muted-foreground">{promoPack.description}</p>
          )}
          <dl className="mt-4 space-y-2 text-sm">
            <Row k="Pack" v={packLabel} />
            <Row k="Marca" v={brand?.name ?? "—"} />
            <Row k="Modelo" v={model?.name ?? "—"} />
            {hasShirt && <Row k="Talla" v={size} />}
            {isCompletePack && (
              <>
                <Row k="Polera" v={selectedCompleteShirt?.name ?? "—"} />
                <Row k="Talla polera" v={completeShirtSize} />
                <Row k="Diseño polera" v={completeShirtDesign ? "✓ subido" : "—"} />
                <Row k="Polerón" v={selectedCompleteHoodie?.name ?? "—"} />
                <Row k="Talla polerón" v={completeHoodieSize} />
                <Row k="Diseño polerón" v={completeHoodieDesign ? "✓ subido" : "—"} />
              </>
            )}
            <Row k="Diseño carcasa" v={caseDesign ? "✓ subido" : "—"} />
            {hasShirt && <Row k="Diseño prenda" v={shirtDesign ? "✓ subido" : "—"} />}
          </dl>
          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <div className="flex items-baseline gap-2">
                {hasSale && (
                  <span className="font-mono text-sm text-muted-foreground line-through">
                    ${basePrice.toLocaleString("es-CL")}
                  </span>
                )}
                <span className="font-mono text-2xl font-bold text-neon-green">${price.toLocaleString("es-CL")}</span>
              </div>
            </div>
          </div>
        </aside>

      </div>
    </section>
  );
}


function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function StepModel({
  brands, models, brandId, modelId, onBrand, onModel,
}: {
  brands: BrandRow[]; models: ModelRow[];
  brandId: string; modelId: string;
  onBrand: (id: string) => void; onModel: (id: string) => void;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Smartphone className="h-5 w-5 text-neon-blue" /> Elige tu celular</h2>
      <p className="mt-1 text-sm text-muted-foreground">Cargamos automáticamente el molde del modelo.</p>

      <div className="mt-6">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Marca</label>
        {brands.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            <p className="mt-2">Cargando marcas…</p>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => onBrand(b.id)}
                className={`rounded-lg border p-3 text-sm transition-colors ${
                  brandId === b.id ? "border-neon-blue bg-neon-blue/10 text-neon-blue" : "border-border hover:border-neon-blue/50"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {brandId && (
        <div className="mt-6">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Modelo</label>
          {models.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Sin modelos activos para esta marca.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {models.map((m) => {
                const ready = modelReady(m);
                return (
                  <button
                    key={m.id}
                    onClick={() => onModel(m.id)}
                    className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                      modelId === m.id ? "border-neon-green bg-neon-green/10 text-neon-green" : "border-border hover:border-neon-green/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{m.name}</span>
                      {!ready && <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">sin mockup web</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────── Canvas de diseño de carcasa con molde + zona imprimible ─────── */

const DEFAULT_PRINT_AREA: PrintArea = { x: 15, y: 15, width: 70, height: 70, radius: 8, camera: null };

function CaseDesignCanvas({
  design, onChange, model,
}: { design: Design | null; onChange: (d: Design | null) => void; model?: ModelRow }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const image = modelImage(model);
  const ready = !!image;
  const [mounted, setMounted] = useState(false);
  const [debug, setDebug] = useState(false);


  useEffect(() => setMounted(true), []);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    onChange({ url, x: 0, y: 0, scale: 1, rotate: 0, originalFile: f });
  };

  if (!model) {
    return <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Elige primero un modelo.</div>;
  }
  if (!ready) {
    return (
      <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-10 text-center">
        <p className="text-sm font-medium text-yellow-400">Este modelo no tiene mockup web cargado</p>
        <p className="mt-1 text-xs text-muted-foreground">Sube una versión JPG/PNG/WEBP del molde desde el panel administrador para habilitarlo.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_240px]">
      {/* Canvas único (Konva): todas las capas viven aquí adentro */}
      <div className="relative">
        {mounted ? (
          <Suspense fallback={<div className="aspect-square w-full animate-pulse rounded-xl border border-border bg-secondary" />}>
            <CaseCanvasKonva model={model} design={design} onChange={onChange} debug={debug} />
          </Suspense>
        ) : (
          <div className="aspect-square w-full rounded-xl border border-border bg-secondary" />
        )}
        {!design && (
          <button
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/40 text-muted-foreground backdrop-blur-sm transition-colors hover:text-neon-blue"
          >
            <Upload className="h-8 w-8" />
            <span className="text-sm">Sube tu diseño de carcasa</span>
          </button>
        )}
      </div>



      {/* Controles */}
      <div className="space-y-4">
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          onClick={() => inputRef.current?.click()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm hover:border-neon-blue"
        >
          <Upload className="h-4 w-4" /> {design ? "Reemplazar" : "Subir imagen"}
        </button>

        {design && (
          <>
            <Slider label="Tamaño" value={design.scale} min={0.2} max={3} step={0.05} onChange={(v) => onChange({ ...design, scale: v })} />
            <Slider label="Rotación" value={design.rotate} min={-180} max={180} step={1} onChange={(v) => onChange({ ...design, rotate: v })} icon={<RotateCw className="h-3 w-3" />} />
            <Slider label="Posición X" value={design.x} min={-200} max={200} step={1} onChange={(v) => onChange({ ...design, x: v })} />
            <Slider label="Posición Y" value={design.y} min={-200} max={200} step={1} onChange={(v) => onChange({ ...design, y: v })} />
            <button
              onClick={() => onChange({ ...design, x: 0, y: 0, scale: 1, rotate: 0 })}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Centrar y reiniciar
            </button>
            <MagicEraserButton design={design} onChange={onChange} />
            <button
              onClick={() => onChange(null)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Eliminar
            </button>
          </>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          Modo debug (mostrar tamaños y print_area)
        </label>
      </div>

    </div>
  );
}

/* ─────── (silueta genérica de prenda eliminada — se usa GarmentDesignCanvas) ─────── */


function Slider({ label, value, min, max, step, onChange, icon }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">{icon}{label}</span>
        <span className="font-mono">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="mt-1 w-full accent-neon-blue" />
    </div>
  );
}

function StepCase({ design, onChange, model }: { design: Design | null; onChange: (d: Design | null) => void; model?: ModelRow }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Smartphone className="h-5 w-5 text-neon-blue" /> Diseña tu carcasa</h2>
      <p className="mt-1 text-sm text-muted-foreground">Molde: {model?.name ?? "—"}. Tu imagen se recorta dentro de la zona imprimible; la cámara queda protegida.</p>
      <div className="mt-6">
        <CaseDesignCanvas design={design} onChange={onChange} model={model} />
      </div>
    </div>
  );
}

function StepShirt({
  type, size, onSize, color, design, onChange,
  garments, garmentId, onSelectGarment,
}: {
  type: "polera" | "poleron";
  size: "S" | "M" | "L" | "XL";
  onSize: (s: "S" | "M" | "L" | "XL") => void;
  color: string;
  onColor: (c: string) => void;
  design: Design | null;
  onChange: (d: Design | null) => void;
  garments: GarmentRow[];
  garmentId: string;
  onSelectGarment: (g: GarmentRow) => void;
}) {
  const selected = garments.find((g) => g.id === garmentId) ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const availableSizes = selected?.sizes ?? [];
  const _ = color; // used solely to display selected color chip

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    onChange({ url, x: 0, y: 0, scale: 1, rotate: 0, originalFile: f });
  };

  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <Shirt className="h-5 w-5 text-neon-green" /> Diseña tu {type}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Elige una prenda disponible y sube el arte que irá impreso en el frente.
      </p>

      {garments.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-yellow-500/40 bg-yellow-500/5 p-6 text-center text-sm text-yellow-400">
          No hay una prenda disponible para este pack.
        </div>
      ) : (
        <>
          <div className="mt-4">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Prenda</label>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {garments.map((g) => {
                const thumb = g.preview_url || g.mockup_url || g.base_url;
                const active = g.id === garmentId;
                return (
                  <button
                    key={g.id}
                    onClick={() => onSelectGarment(g)}
                    className={`rounded-xl border p-2 text-left text-xs transition-colors ${
                      active ? "border-neon-green bg-neon-green/10" : "border-border hover:border-neon-green/50"
                    }`}
                  >
                    {thumb ? (
                      <img src={thumb} alt={g.name} className="aspect-square w-full rounded-lg bg-white/5 object-contain" />
                    ) : (
                      <div className="aspect-square w-full rounded-lg bg-secondary" />
                    )}
                    <div className="mt-2 font-semibold text-foreground">{g.name}</div>
                    <div className="mt-0.5 text-muted-foreground">
                      {g.color} · {g.view}
                    </div>
                    {g.sizes.length > 0 && (
                      <div className="mt-0.5 text-muted-foreground">Tallas: {g.sizes.join(", ")}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selected && (
            <div className="mt-6">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Talla</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["S", "M", "L", "XL"] as const).map((s) => {
                  const enabled = availableSizes.includes(s);
                  return (
                    <button
                      key={s}
                      disabled={!enabled}
                      onClick={() => onSize(s)}
                      className={`h-10 w-14 rounded-lg border text-sm font-semibold transition-colors ${
                        size === s
                          ? "border-neon-green bg-neon-green/10 text-neon-green"
                          : "border-border hover:border-neon-green/50"
                      } ${!enabled ? "cursor-not-allowed opacity-30" : ""}`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selected && (
            <div className="mt-6 grid gap-6 md:grid-cols-[1fr_240px]">
              <div className="relative">
                <GarmentDesignCanvas garment={selected} design={design} />
                {!design && (
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/40 text-muted-foreground backdrop-blur-sm transition-colors hover:text-neon-green"
                  >
                    <Upload className="h-8 w-8" />
                    <span className="text-sm">Sube tu diseño de {type}</span>
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <button
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm hover:border-neon-green"
                >
                  <Upload className="h-4 w-4" /> {design ? "Reemplazar" : "Subir imagen"}
                </button>
                {design && (
                  <>
                    <Slider label="Tamaño" value={design.scale} min={0.2} max={3} step={0.05} onChange={(v) => onChange({ ...design, scale: v })} />
                    <Slider label="Rotación" value={design.rotate} min={-180} max={180} step={1} onChange={(v) => onChange({ ...design, rotate: v })} icon={<RotateCw className="h-3 w-3" />} />
                    <Slider label="Posición X" value={design.x} min={-200} max={200} step={1} onChange={(v) => onChange({ ...design, x: v })} />
                    <Slider label="Posición Y" value={design.y} min={-200} max={200} step={1} onChange={(v) => onChange({ ...design, y: v })} />
                    <MagicEraserButton design={design} onChange={onChange} />
                    <button
                      onClick={() => onChange(null)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StepPreview({
  pack, brand, model, size, caseDesign, shirtDesign, price, stageRef, garment,
  completeShirt, completeShirtDesign, completeShirtSize,
  completeHoodie, completeHoodieDesign, completeHoodieSize,
}: {
  pack: PackId;
  brand?: string; model?: ModelRow; size: string;
  caseDesign: Design | null; shirtDesign: Design | null; price: number;
  stageRef?: React.MutableRefObject<Konva.Stage | null>;
  garment?: GarmentRow | null;
  completeShirt?: GarmentRow | null;
  completeShirtDesign?: Design | null;
  completeShirtSize?: string;
  completeHoodie?: GarmentRow | null;
  completeHoodieDesign?: Design | null;
  completeHoodieSize?: string;
}) {
  const isCompletePack = pack === "carcasa+polera+poleron";
  const hasShirt = pack === "carcasa+polera" || pack === "carcasa+poleron";
  const type: "polera" | "poleron" = pack === "carcasa+poleron" ? "poleron" : "polera";
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">Vista previa</h2>
      <p className="mt-1 text-sm text-muted-foreground">Así queda tu diseño real antes de pagar.</p>

      {isCompletePack ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Carcasa */}
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex h-[300px] items-center justify-center overflow-hidden p-4">
              {model && caseDesign ? (
                <div className="flex h-full w-full max-w-[210px] items-center justify-center sm:max-w-[230px]">
                  <div
                    className="origin-center"
                    style={{ transform: "scale(0.5)" }}
                  >
                    <Suspense fallback={<div className="h-[520px] w-[260px] animate-pulse rounded-xl bg-secondary" />}>
                      <CaseCanvasKonva
                        model={model}
                        design={caseDesign}
                        onChange={() => {}}
                        readOnly
                        stageRef={stageRef}
                      />
                    </Suspense>
                  </div>
                </div>
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                  {!model ? "Selecciona un modelo" : "Sube tu diseño de carcasa"}
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              Carcasa · {brand ?? "—"} · {model?.name ?? "—"}
            </div>
          </div>

          {/* Polera */}
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex h-[300px] items-center justify-center overflow-hidden p-4">
              {completeShirt ? (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="w-full max-w-[280px] max-h-[280px]">
                    <GarmentDesignCanvas
                      garment={completeShirt}
                      design={completeShirtDesign ?? null}
                      readOnly
                    />
                  </div>
                </div>
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                  Selecciona una polera
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              Polera · {completeShirt?.color ?? "—"} · {completeShirtSize ?? "—"}
            </div>
          </div>

          {/* Polerón */}
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex h-[300px] items-center justify-center overflow-hidden p-4">
              {completeHoodie ? (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="w-full max-w-[280px] max-h-[280px]">
                    <GarmentDesignCanvas
                      garment={completeHoodie}
                      design={completeHoodieDesign ?? null}
                      readOnly
                    />
                  </div>
                </div>
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                  Selecciona un polerón
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              Polerón · {completeHoodie?.color ?? "—"} · {completeHoodieSize ?? "—"}
            </div>
          </div>
        </div>
      ) : (
        <div className={`mt-6 grid gap-4 ${hasShirt ? "sm:grid-cols-2" : ""}`}>

          <div className="relative flex flex-col items-center rounded-xl border border-border bg-gradient-to-br from-secondary to-background p-4">
            {model && caseDesign ? (
              <Suspense fallback={<div className="h-[520px] w-[260px] animate-pulse rounded-xl bg-secondary" />}>
                <CaseCanvasKonva
                  model={model}
                  design={caseDesign}
                  onChange={() => {}}
                  readOnly
                  stageRef={stageRef}
                />
              </Suspense>
            ) : (
              <div className="grid h-[520px] w-[260px] place-items-center text-xs text-muted-foreground">
                {!model ? "Selecciona un modelo" : "Sube tu diseño de carcasa"}
              </div>
            )}
            <span className="mt-3 rounded-full bg-background/80 px-3 py-1 text-xs backdrop-blur">Carcasa · {model?.name}</span>
          </div>

          {hasShirt && (
            <div className="relative flex flex-col rounded-xl border border-border p-2">
              {garment ? (
                <GarmentDesignCanvas garment={garment} design={shirtDesign} readOnly />
              ) : (
                <div className="grid aspect-square w-full place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">
                  Selecciona una prenda
                </div>
              )}
              <span className="mt-2 self-start rounded-full bg-background/80 px-3 py-1 text-xs backdrop-blur capitalize">
                {type} · {garment?.color ?? "—"} · {size}
              </span>
            </div>
          )}
        </div>
      )}


      <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm">
        <div className="grid gap-1 sm:grid-cols-2">
          <div><span className="text-muted-foreground">Marca:</span> <b>{brand}</b></div>
          <div><span className="text-muted-foreground">Modelo:</span> <b>{model?.name}</b></div>
          {hasShirt && <div><span className="text-muted-foreground">Talla:</span> <b>{size}</b></div>}
          {hasShirt && garment && <div><span className="text-muted-foreground">Prenda:</span> <b>{garment.name}</b></div>}
          {isCompletePack && <div><span className="text-muted-foreground">Polera:</span> <b>{completeShirt?.name ?? "—"}</b></div>}
          {isCompletePack && <div><span className="text-muted-foreground">Talla polera:</span> <b>{completeShirtSize ?? "—"}</b></div>}
          {isCompletePack && <div><span className="text-muted-foreground">Polerón:</span> <b>{completeHoodie?.name ?? "—"}</b></div>}
          {isCompletePack && <div><span className="text-muted-foreground">Talla polerón:</span> <b>{completeHoodieSize ?? "—"}</b></div>}
          <div><span className="text-muted-foreground">Total:</span> <b className="text-neon-green">${price.toLocaleString("es-CL")}</b></div>
        </div>
      </div>
    </div>
  );
}

function MagicEraserButton({
  design,
  onChange,
}: {
  design: Design;
  onChange: (d: Design | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const originalUrlRef = useRef<string>(design.url);

  useEffect(() => {
    originalUrlRef.current = design.url;
  }, [design.url]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const newUrl = await removeImageBackground(design.url);
      onChange({ ...design, url: newUrl });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo procesar la imagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-neon-blue/40 bg-neon-blue/10 px-4 py-2 text-xs font-medium text-neon-blue transition-colors hover:bg-neon-blue/20 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
        {busy ? "Procesando…" : "Borrar fondo mágico"}
      </button>
      {err && <p className="text-[10px] text-destructive">{err}</p>}
      <p className="text-[10px] text-muted-foreground">
        Elimina el fondo dominante. Funciona mejor con fondos planos.
      </p>
    </div>
  );
}

function CheckoutDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: () => Promise<void>;
  additionalItem: boolean;
}) {
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void onSubmit().catch((error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo agregar el producto");
      onClose();
    });
  }, [onClose, onSubmit]);
  return null;
}
