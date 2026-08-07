import { useCallback, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Upload, FileArchive, FileImage, FileType2, Trash2, Loader2,
  CheckCircle2, AlertTriangle, Folder, RefreshCw, Play, Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { processPsd } from "@/lib/psd-processor";
import {
  getDefaultPhonePrintArea,
  getSafePhonePrintArea,
  isValidPhonePrintArea,
  type PhoneModelPrintArea,
} from "@/lib/phone-model-print-area";

/* ─────────── Tipos ─────────── */

type FileKind = "psd" | "image" | "unknown";

type ParsedItem = {
  id: string;                   // uid local
  originalName: string;         // "IPHONE 12 PRO MAX.psd"
  sourcePath: string;           // ruta relativa (para carpetas/zip)
  size: number;
  kind: FileKind;
  ext: string;
  file?: File;                  // undefined si viene del zip (usamos zipBlob)
  zipBlob?: Blob;               // extraído de un zip
  brandName: string;            // detectada
  brandSlug: string;
  modelName: string;            // detectado
  modelSlug: string;
  confidence: "high" | "medium" | "low";
  status: "pending" | "uploading" | "done" | "error" | "skipped";
  message?: string;
};

/* ─────────── Detección marca / modelo ─────────── */

const BRAND_PATTERNS: { name: string; slug: string; re: RegExp }[] = [
  { name: "Apple",    slug: "apple",    re: /\b(iphone|apple)\b/i },
  { name: "Samsung",  slug: "samsung",  re: /\b(samsung|galaxy|sm-?[a-z]?\d+)\b/i },
  { name: "Xiaomi",   slug: "xiaomi",   re: /\b(xiaomi|redmi|poco|mi)\b/i },
  { name: "Huawei",   slug: "huawei",   re: /\b(huawei|honor|nova|mate|p\s?\d{2})\b/i },
  { name: "Motorola", slug: "motorola", re: /\b(motorola|moto)\b/i },
  { name: "Oppo",     slug: "oppo",     re: /\b(oppo|reno|find)\b/i },
  { name: "Realme",   slug: "realme",   re: /\brealme\b/i },
  { name: "Vivo",     slug: "vivo",     re: /\bvivo\b/i },
  { name: "OnePlus",  slug: "oneplus",  re: /\b(oneplus|one\s?plus)\b/i },
  { name: "Google",   slug: "google",   re: /\b(pixel|google)\b/i },
  { name: "Nokia",    slug: "nokia",    re: /\bnokia\b/i },
  { name: "Sony",     slug: "sony",     re: /\b(sony|xperia)\b/i },
  { name: "LG",       slug: "lg",       re: /\blg\b/i },
  { name: "ZTE",      slug: "zte",      re: /\bzte\b/i },
  { name: "TCL",      slug: "tcl",      re: /\btcl\b/i },
];

export function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function kindOf(ext: string): FileKind {
  if (ext === "psd") return "psd";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  return "unknown";
}

export function detectBrandAndModel(rawName: string, folderHint?: string) {
  const clean = stripExt(rawName).replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  const hay = `${folderHint ?? ""} ${clean}`;

  let brand = BRAND_PATTERNS.find((b) => b.re.test(hay));
  let confidence: ParsedItem["confidence"] = brand ? "high" : "low";

  // Heurísticas por prefijo si no matchea
  if (!brand) {
    const first = clean.split(" ")[0]?.toLowerCase();
    const guess = BRAND_PATTERNS.find((b) => b.slug === first);
    if (guess) { brand = guess; confidence = "medium"; }
  }

  const brandName = brand?.name ?? "Sin identificar";
  const brandSlug = brand?.slug ?? "sin-identificar";

  // El modelo = nombre limpio sin la marca al inicio
  let modelName = clean;
  if (brand) {
    modelName = clean.replace(brand.re, "").replace(/\s+/g, " ").trim();
    // capitaliza suave
    modelName = modelName.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (!modelName) { modelName = clean; confidence = "low"; }

  const modelSlug = slugify(`${brandSlug}-${modelName}`);

  return { brandName, brandSlug, modelName, modelSlug, confidence };
}

/* ─────────── Extracción de archivos (input / drop / zip) ─────────── */

const ACCEPT_EXT = ["psd", "png", "jpg", "jpeg", "webp", "zip"];

function isAccepted(name: string): boolean {
  return ACCEPT_EXT.includes(extOf(name));
}

async function expandFileList(files: FileList | File[]): Promise<ParsedItem[]> {
  const out: ParsedItem[] = [];
  const arr = Array.from(files);
  for (const f of arr) {
    const rel = (f as any).webkitRelativePath as string | undefined;
    const sourcePath = rel && rel.length ? rel : f.name;
    const ext = extOf(f.name);
    if (ext === "zip") {
      try {
        const items = await expandZip(f);
        out.push(...items);
      } catch (e: any) {
        toast.error(`No se pudo leer ZIP ${f.name}: ${e.message}`);
      }
      continue;
    }
    if (!isAccepted(f.name)) continue;
    out.push(makeItem({ name: f.name, sourcePath, size: f.size, file: f }));
  }
  return out;
}

async function expandZip(zipFile: File): Promise<ParsedItem[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const items: ParsedItem[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const name = entry.name.split("/").pop() || entry.name;
    if (!isAccepted(name) || extOf(name) === "zip") continue;
    const blob = await entry.async("blob");
    items.push(makeItem({
      name,
      sourcePath: `${zipFile.name}/${entry.name}`,
      size: blob.size,
      zipBlob: blob,
    }));
  }
  return items;
}

function makeItem(o: { name: string; sourcePath: string; size: number; file?: File; zipBlob?: Blob }): ParsedItem {
  const ext = extOf(o.name);
  const folderHint = o.sourcePath.includes("/") ? o.sourcePath.split("/").slice(0, -1).join(" ") : "";
  const det = detectBrandAndModel(o.name, folderHint);
  return {
    id: crypto.randomUUID(),
    originalName: o.name,
    sourcePath: o.sourcePath,
    size: o.size,
    kind: kindOf(ext),
    ext,
    file: o.file,
    zipBlob: o.zipBlob,
    brandName: det.brandName,
    brandSlug: det.brandSlug,
    modelName: det.modelName,
    modelSlug: det.modelSlug,
    confidence: det.confidence,
    status: "pending",
  };
}

/* ─────────── Componente ─────────── */

export default function TemplateImporter() {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (fl: FileList | File[]) => {
    setBusy(true);
    try {
      const parsed = await expandFileList(fl);
      if (!parsed.length) toast.warning("Ningún archivo válido detectado");
      else toast.success(`${parsed.length} archivo(s) añadidos`);
      setItems((prev) => [...prev, ...parsed]);
    } finally { setBusy(false); }
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const stats = useMemo(() => {
    const brands = new Set(items.map((i) => i.brandSlug));
    const models = new Set(items.map((i) => i.modelSlug));
    const low = items.filter((i) => i.confidence === "low").length;
    return {
      files: items.length,
      brands: brands.size,
      models: models.size,
      needsReview: low,
      psd: items.filter((i) => i.kind === "psd").length,
      images: items.filter((i) => i.kind === "image").length,
    };
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map<string, { brandName: string; brandSlug: string; items: ParsedItem[] }>();
    for (const it of items) {
      const g = map.get(it.brandSlug) ?? { brandName: it.brandName, brandSlug: it.brandSlug, items: [] };
      g.items.push(it);
      map.set(it.brandSlug, g);
    }
    return Array.from(map.values()).sort((a, b) => a.brandName.localeCompare(b.brandName));
  }, [items]);

  const updateItem = (id: string, patch: Partial<ParsedItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, modelSlug: patch.modelName ? slugify(`${(patch.brandSlug ?? i.brandSlug)}-${patch.modelName}`) : (patch.modelSlug ?? i.modelSlug) } : i)));
  };
  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const clearAll = () => { setItems([]); setProgress({ done: 0, total: 0 }); };

  const reDetect = () => {
    setItems((prev) => prev.map((i) => {
      const folderHint = i.sourcePath.includes("/") ? i.sourcePath.split("/").slice(0, -1).join(" ") : "";
      const d = detectBrandAndModel(i.originalName, folderHint);
      return { ...i, ...d };
    }));
    toast.success("Re-detección aplicada");
  };

  /* ─────────── Ejecutar importación ─────────── */

  const runImport = async () => {
    if (!items.length) return;
    const pending = items.filter((i) => i.status === "pending" || i.status === "error");
    if (!pending.length) return toast.info("Nada pendiente por importar");
    if (items.some((i) => i.confidence === "low" && i.status === "pending")) {
      if (!confirm("Hay archivos sin identificar claramente. ¿Continuar de todos modos?")) return;
    }
    setBusy(true);
    setProgress({ done: 0, total: pending.length });

    // Cachés
    const brandIdBySlug = new Map<string, string>();
    const modelIdBySlug = new Map<string, string>();

    try {
      // Precarga marcas existentes
      const { data: existingBrands } = await supabase.from("brands").select("id, slug");
      existingBrands?.forEach((b: any) => brandIdBySlug.set(b.slug, b.id));

      const { data: existingModels } = await supabase
        .from("phone_models")
        .select("id, slug, print_area");
      const modelPrintAreaBySlug = new Map<string, PhoneModelPrintArea | null>();
      existingModels?.forEach((m: any) => {
        modelIdBySlug.set(m.slug, m.id);
        modelPrintAreaBySlug.set(
          m.slug,
          (m.print_area ?? null) as PhoneModelPrintArea | null,
        );
      });

      let done = 0;
      let successCount = 0;
      let errorCount = 0;
      for (const it of pending) {
        try {
          updateItem(it.id, { status: "uploading", message: undefined });

          // 1. Marca
          let brandId = brandIdBySlug.get(it.brandSlug);
          if (!brandId) {
            const { data, error } = await supabase.from("brands")
              .insert({ name: it.brandName, slug: it.brandSlug, is_active: true })
              .select("id").single();
            if (error) throw error;
            brandId = data.id;
            brandIdBySlug.set(it.brandSlug, brandId);
          }

          // 2. Modelo
          let modelId = modelIdBySlug.get(it.modelSlug);
          let existingPrintArea: PhoneModelPrintArea | null =
            modelPrintAreaBySlug.get(it.modelSlug) ?? null;
          if (!modelId) {
            const defaultArea = getDefaultPhonePrintArea();
            const { data, error } = await supabase.from("phone_models")
              .insert({
                brand_id: brandId,
                name: it.modelName,
                slug: it.modelSlug,
                is_active: true,
                print_area: defaultArea as any,
                mold_status: "pendiente_conversion",
              })
              .select("id, slug, print_area, mold_status")
              .single();
            if (error) throw error;
            if (!data?.id) throw new Error("Modelo creado sin id");
            if (!isValidPhonePrintArea(data.print_area)) {
              throw new Error("Modelo creado sin print_area válido");
            }
            modelId = data.id;
            modelIdBySlug.set(it.modelSlug, modelId);
            existingPrintArea = data.print_area as PhoneModelPrintArea;
            modelPrintAreaBySlug.set(it.modelSlug, existingPrintArea);
          }

          const safePrintArea = getSafePhonePrintArea(existingPrintArea);

          // 3. Subir archivo original + derivados
          const blob: Blob | undefined = it.file ?? it.zipBlob;
          if (!blob) throw new Error("Archivo no disponible");

          const isPsd = it.kind === "psd";
          const base = `${it.brandSlug}/${it.modelSlug}/${Date.now()}`;

          const uploadTo = async (bucket: string, subpath: string, b: Blob, contentType?: string) => {
            const up = await supabase.storage.from(bucket).upload(subpath, b, {
              upsert: false,
              contentType,
            });
            if (up.error) throw up.error;
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(subpath, 60 * 60 * 24 * 365);
            return signed?.signedUrl ?? null;
          };

          if (isPsd) {
            // 3a. PSD original como respaldo
            const psdUrl = await uploadTo("source-psd-files", `${base}-${it.originalName}`, blob);

            // 3b. Procesar capas
            let conversionFailed = false;
            let conversionErrorMessage: string | null = null;
            let modelPatch: Record<string, unknown>;
            try {
              const buf = await blob.arrayBuffer();
              const art = await processPsd(buf);
              const [overlayUrl, holesUrl, mockupUrl, previewUrl] = await Promise.all([
                uploadTo("phone-mockups", `${base}-overlay.png`, art.overlay, "image/png"),
                uploadTo("phone-masks",   `${base}-holes.png`,   art.holes,   "image/png"),
                uploadTo("phone-mockups", `${base}-mockup.png`,  art.mockup,  "image/png"),
                uploadTo("phone-previews",`${base}-preview.png`, art.preview, "image/png"),
              ]);
              modelPatch = {
                source_psd_url: psdUrl,
                overlay_url: overlayUrl,
                holes_url: holesUrl,
                mockup_url: mockupUrl,
                preview_url: previewUrl,
                mold_status: "listo",
                print_area: safePrintArea,
              };
            } catch (convErr: any) {
              conversionFailed = true;
              conversionErrorMessage = convErr?.message ?? String(convErr);
              modelPatch = {
                source_psd_url: psdUrl,
                mold_status: "error_conversion",
                print_area: safePrintArea,
              };
            }
            const { data: updated, error: uErr } = await supabase
              .from("phone_models")
              .update(modelPatch as any)
              .eq("id", modelId)
              .select(
                "id, print_area, mold_status, source_psd_url, overlay_url, holes_url, mockup_url, preview_url",
              )
              .single();
            if (uErr) throw uErr;
            if (!updated?.id || updated.id !== modelId) {
              throw new Error("Update no devolvió la fila esperada");
            }
            if (!isValidPhonePrintArea(updated.print_area)) {
              throw new Error("print_area guardado no es válido");
            }

            if (conversionFailed) {
              updateItem(it.id, {
                status: "error",
                message: `Conversión falló: ${conversionErrorMessage ?? "error desconocido"}`,
              });
              errorCount += 1;
              continue;
            }

            if (
              updated.mold_status !== "listo" ||
              !updated.source_psd_url ||
              !updated.overlay_url ||
              !updated.holes_url ||
              !updated.mockup_url ||
              !updated.preview_url
            ) {
              throw new Error("Modelo guardado sin todos los assets requeridos");
            }
          } else {
            const fileUrl = await uploadTo("phone-mockups", `${base}-${it.originalName}`, blob);
            const { data: updated, error: uErr } = await supabase
              .from("phone_models")
              .update({
                mockup_url: fileUrl,
                preview_url: fileUrl,
                mold_status: "listo",
                print_area: safePrintArea,
              } as any)
              .eq("id", modelId)
              .select("id, print_area, mold_status, mockup_url, preview_url")
              .single();
            if (uErr) throw uErr;
            if (!updated?.id || updated.id !== modelId) {
              throw new Error("Update no devolvió la fila esperada");
            }
            if (!isValidPhonePrintArea(updated.print_area)) {
              throw new Error("print_area guardado no es válido");
            }
            if (
              updated.mold_status !== "listo" ||
              !updated.mockup_url ||
              !updated.preview_url
            ) {
              throw new Error("Modelo guardado sin todos los assets requeridos");
            }
          }

          updateItem(it.id, { status: "done" });
          successCount += 1;

        } catch (e: any) {
          updateItem(it.id, { status: "error", message: e.message ?? "Error" });
          errorCount += 1;
        } finally {
          done += 1;
          setProgress({ done, total: pending.length });
        }
      }
      if (errorCount === 0) {
        toast.success(`Importación finalizada: ${successCount} listo(s)`);
      } else if (successCount > 0) {
        toast.warning(
          `Importación con errores: ${successCount} listo(s) · ${errorCount} fallido(s)`,
        );
      } else {
        toast.error(`Importación fallida: ${errorCount} fallido(s)`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Error importando");
    } finally {
      setBusy(false);
    }
  };

  /* ─────────── UI ─────────── */

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">Importar moldes de carcasas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Arrastra PSD/PNG/JPG/WEBP, carpetas o ZIPs. Cada archivo se trata como <b>molde base</b> del modelo detectado
              (ej. <code className="font-mono">IPHONE 12 PRO MAX.psd</code>). Se crea la marca y el modelo si no existen y se
              asocia el archivo. Los PSD quedan como <b>pendiente_conversion</b>; las imágenes marcan el molde como <b>listo</b>.
            </p>

          </div>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-6 grid place-items-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-neon-blue bg-neon-blue/5" : "border-border"
          }`}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm">Suelta archivos, carpetas o ZIPs aquí</p>
          <p className="text-xs text-muted-foreground">PSD · PNG · JPG · WEBP · ZIP</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-neon-blue"
            >
              <FileImage className="h-4 w-4" /> Elegir archivos
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-neon-blue"
            >
              <Folder className="h-4 w-4" /> Elegir carpeta
            </button>
          </div>
          <input
            ref={fileInputRef} type="file" multiple hidden
            accept=".psd,.png,.jpg,.jpeg,.webp,.zip"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <input
            ref={folderInputRef} type="file" hidden
            /* @ts-expect-error atributos no estándar */
            webkitdirectory="" directory="" multiple
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatMini label="Archivos" value={stats.files} />
          <StatMini label="Marcas" value={stats.brands} />
          <StatMini label="Modelos" value={stats.models} />
          <StatMini label="PSD" value={stats.psd} />
          <StatMini label="Imágenes" value={stats.images} />
          <StatMini label="A revisar" value={stats.needsReview} warn={stats.needsReview > 0} />
        </div>

        {/* Acciones */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            onClick={runImport}
            disabled={busy || !items.length}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Importar {items.length ? `(${items.length})` : ""}
          </button>
          <button
            onClick={reDetect}
            disabled={busy || !items.length}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-neon-blue disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" /> Re-detectar
          </button>
          <button
            onClick={clearAll}
            disabled={busy || !items.length}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Limpiar
          </button>
          {progress.total > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      </div>

      {/* Lista agrupada */}
      {groups.map((g) => (
        <div key={g.brandSlug} className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{g.brandName}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {g.items.length}
              </span>
              {g.brandSlug === "sin-identificar" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> revisar
                </span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3">Archivo</th>
                  <th className="p-3">Marca</th>
                  <th className="p-3">Modelo</th>
                  <th className="p-3">Slug modelo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.id} className="border-t border-border align-top">
                    <td className="p-3">
                      <div className="flex items-start gap-2">
                        {it.kind === "psd" ? <FileType2 className="mt-0.5 h-4 w-4 text-neon-blue" /> :
                         it.kind === "image" ? <FileImage className="mt-0.5 h-4 w-4 text-neon-green" /> :
                         <FileArchive className="mt-0.5 h-4 w-4" />}
                        <div>
                          <div className="font-medium">{it.originalName}</div>
                          <div className="text-xs text-muted-foreground">
                            {(it.size / 1024).toFixed(1)} KB · {it.sourcePath}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <input
                        value={it.brandName}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateItem(it.id, { brandName: v, brandSlug: slugify(v), modelSlug: slugify(`${slugify(v)}-${it.modelName}`) });
                        }}
                        className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        value={it.modelName}
                        onChange={(e) => updateItem(it.id, { modelName: e.target.value })}
                        className="w-48 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{it.modelSlug}</td>
                    <td className="p-3">
                      <StatusPill it={it} />
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => removeItem(it.id)}
                        disabled={it.status === "uploading"}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatMini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-amber-500/40" : "border-border"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${warn ? "text-amber-400" : ""}`}>{value}</div>
    </div>
  );
}

function StatusPill({ it }: { it: ParsedItem }) {
  if (it.status === "done") return <span className="inline-flex items-center gap-1 text-xs text-neon-green"><CheckCircle2 className="h-3 w-3" /> importado</span>;
  if (it.status === "uploading") return <span className="inline-flex items-center gap-1 text-xs text-neon-blue"><Loader2 className="h-3 w-3 animate-spin" /> subiendo</span>;
  if (it.status === "error") return <span className="inline-flex items-center gap-1 text-xs text-destructive" title={it.message}><AlertTriangle className="h-3 w-3" /> error</span>;
  if (it.status === "skipped") return <span className="text-xs text-muted-foreground">omitido</span>;
  if (it.confidence === "low") return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><AlertTriangle className="h-3 w-3" /> revisar</span>;
  if (it.confidence === "medium") return <span className="text-xs text-amber-300">pendiente</span>;
  return <span className="text-xs text-muted-foreground">pendiente</span>;
}
