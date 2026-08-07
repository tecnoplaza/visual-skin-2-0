import { useCallback, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Upload, FileArchive, FileImage, FileType2, Trash2, Loader2,
  CheckCircle2, AlertTriangle, Folder, RefreshCw, Play, Wand2, Shirt,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { processGarmentPsd } from "@/lib/garment-psd-processor";
import {
  cloneGarmentPrintArea,
  getDefaultGarmentPrintArea,
  isValidGarmentPrintArea,
  type GarmentPrintArea,
  type GarmentType,
  type GarmentView,
} from "@/lib/garment-model";

/* ─────────── Tipos ─────────── */

type FileKind = "psd" | "image" | "unknown";

type ParsedItem = {
  id: string;
  originalName: string;
  sourcePath: string;
  size: number;
  kind: FileKind;
  ext: string;
  file?: File;
  zipBlob?: Blob;
  type: GarmentType | null;
  name: string;
  color: string;
  colorSlug: string;
  view: GarmentView;
  slug: string;
  confidence: "high" | "medium" | "low";
  status: "pending" | "uploading" | "done" | "error" | "skipped";
  message?: string;
};

/* ─────────── Detección ─────────── */

const TYPE_PATTERNS: { type: GarmentType; re: RegExp }[] = [
  { type: "polera", re: /\b(polera|tshirt|t-shirt|shirt|camiseta)\b/i },
  { type: "poleron", re: /\b(poleron|polerón|hoodie|sweatshirt|sudadera)\b/i },
];

const VIEW_PATTERNS: { view: GarmentView; re: RegExp }[] = [
  { view: "front", re: /\b(front|frente|frontal)\b/i },
  { view: "back", re: /\b(back|espalda|posterior)\b/i },
];

const COLOR_PATTERNS: { name: string; slug: string; re: RegExp }[] = [
  { name: "Blanco", slug: "blanco", re: /\b(blanc[oa]|white)\b/i },
  { name: "Negro", slug: "negro", re: /\b(negr[oa]|black)\b/i },
  { name: "Gris", slug: "gris", re: /\b(gris|gray|grey)\b/i },
  { name: "Azul", slug: "azul", re: /\b(azul|blue)\b/i },
  { name: "Rojo", slug: "rojo", re: /\b(roj[oa]|red)\b/i },
  { name: "Verde", slug: "verde", re: /\b(verde|green)\b/i },
  { name: "Beige", slug: "beige", re: /\bbeige\b/i },
  { name: "Rosado", slug: "rosado", re: /\b(rosad[oa]|rosa|pink)\b/i },
  { name: "Amarillo", slug: "amarillo", re: /\b(amarill[oa]|yellow)\b/i },
];

function slugify(s: string): string {
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

export function detectGarment(rawName: string, folderHint?: string) {
  const clean = stripExt(rawName).replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  const hay = `${folderHint ?? ""} ${clean}`;

  const typeMatch = TYPE_PATTERNS.find((t) => t.re.test(hay));
  const type: GarmentType | null = typeMatch?.type ?? null;

  const viewMatch = VIEW_PATTERNS.find((v) => v.re.test(hay));
  const view: GarmentView = viewMatch?.view ?? "front";

  const colorMatch = COLOR_PATTERNS.find((c) => c.re.test(hay));
  const color = colorMatch?.name ?? "";
  const colorSlug = colorMatch?.slug ?? "";

  let name = clean;
  if (typeMatch) name = name.replace(typeMatch.re, " ");
  if (viewMatch) name = name.replace(viewMatch.re, " ");
  if (colorMatch) name = name.replace(colorMatch.re, " ");
  name = name.replace(/[_\-\s]+/g, " ").trim();
  if (!name) name = type === "poleron" ? "Polerón clásico" : "Polera clásica";
  else name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  const confidence: ParsedItem["confidence"] =
    type && colorMatch ? "high" : type ? "medium" : "low";

  const slug = slugify(`${type ?? "prenda"}-${name}-${colorSlug || "sin-color"}-${view}`);

  return { type, name, color, colorSlug, view, slug, confidence };
}

/* ─────────── Extracción ─────────── */

const ACCEPT_EXT = ["psd", "png", "jpg", "jpeg", "webp", "zip"];
function isAccepted(name: string): boolean {
  return ACCEPT_EXT.includes(extOf(name));
}

async function expandFileList(files: FileList | File[]): Promise<ParsedItem[]> {
  const out: ParsedItem[] = [];
  for (const f of Array.from(files)) {
    const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    const sourcePath = rel && rel.length ? rel : f.name;
    const ext = extOf(f.name);
    if (ext === "zip") {
      try {
        const items = await expandZip(f);
        out.push(...items);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`No se pudo leer ZIP ${f.name}: ${msg}`);
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
  for (const entry of Object.values(zip.files)) {
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
  const det = detectGarment(o.name, folderHint);
  return {
    id: crypto.randomUUID(),
    originalName: o.name,
    sourcePath: o.sourcePath,
    size: o.size,
    kind: kindOf(ext),
    ext,
    file: o.file,
    zipBlob: o.zipBlob,
    type: det.type,
    name: det.name,
    color: det.color,
    colorSlug: det.colorSlug,
    view: det.view,
    slug: det.slug,
    confidence: det.confidence,
    status: "pending",
  };
}

function recomputeSlug(i: ParsedItem, patch: Partial<ParsedItem>): string {
  const type = patch.type ?? i.type ?? "prenda";
  const name = patch.name ?? i.name;
  const colorSlug = patch.colorSlug ?? i.colorSlug ?? "sin-color";
  const view = patch.view ?? i.view;
  return slugify(`${type}-${name}-${colorSlug || "sin-color"}-${view}`);
}

async function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<{ width: number; height: number }>((res, rej) => {
      const img = new Image();
      img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => rej(new Error("No se pudo leer la imagen"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ─────────── Componente ─────────── */

export default function GarmentTemplateImporter() {
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

  const stats = useMemo(() => ({
    files: items.length,
    poleras: items.filter((i) => i.type === "polera").length,
    polerones: items.filter((i) => i.type === "poleron").length,
    unknown: items.filter((i) => i.type === null).length,
    psd: items.filter((i) => i.kind === "psd").length,
    images: items.filter((i) => i.kind === "image").length,
  }), [items]);

  const updateItem = (id: string, patch: Partial<ParsedItem>) => {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      const merged = { ...i, ...patch };
      merged.slug = recomputeSlug(i, patch);
      return merged;
    }));
  };
  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const clearAll = () => { setItems([]); setProgress({ done: 0, total: 0 }); };

  const reDetect = () => {
    setItems((prev) => prev.map((i) => {
      const folderHint = i.sourcePath.includes("/") ? i.sourcePath.split("/").slice(0, -1).join(" ") : "";
      const d = detectGarment(i.originalName, folderHint);
      return { ...i, ...d };
    }));
    toast.success("Re-detección aplicada");
  };

  const runImport = async () => {
    if (!items.length) return;
    const pending = items.filter(
      (i) => (i.status === "pending" || i.status === "error") && i.type !== null,
    );
    if (!pending.length) return toast.info("Nada pendiente por importar (revisa los archivos sin tipo)");
    setBusy(true);
    setProgress({ done: 0, total: pending.length });

    let successCount = 0;
    let errorCount = 0;
    let done = 0;

    try {
      // Precargar prendas existentes por slug
      const { data: existing } = await supabase
        .from("garments")
        .select("*")
        .not("slug", "is", null);
      const bySlug = new Map<string, Record<string, unknown>>();
      (existing ?? []).forEach((g) => {
        const slug = (g as { slug?: string }).slug;
        if (slug) bySlug.set(slug, g as Record<string, unknown>);
      });

      for (const it of pending) {
        try {
          updateItem(it.id, { status: "uploading", message: undefined });
          const blob: Blob | undefined = it.file ?? it.zipBlob;
          if (!blob) throw new Error("Archivo no disponible");
          if (!it.type) throw new Error("Tipo no identificado");

          const existingRow = bySlug.get(it.slug) as
            | { id: string; print_area?: unknown }
            | undefined;

          // 1. Insertar registro si no existe
          let rowId: string;
          if (!existingRow) {
            const insertPayload = {
              type: it.type,
              name: it.name,
              slug: it.slug,
              color: it.color || "",
              view: it.view,
              sizes: ["S", "M", "L", "XL"],
              is_active: false,
              mold_status: "pendiente_conversion",
              print_area: getDefaultGarmentPrintArea(it.type),
            } as never;
            const { data: created, error: cErr } = await supabase
              .from("garments")
              .insert(insertPayload)
              .select("id")
              .single();
            if (cErr) throw cErr;
            if (!created?.id) throw new Error("Inserción sin id");
            rowId = created.id;
          } else {
            rowId = existingRow.id;
          }

          const existingArea = existingRow ? cloneGarmentPrintArea(existingRow.print_area) : null;

          // 2. Procesar archivo
          const base = `${it.type}/${it.slug}/${Date.now()}`;
          const uploadTo = async (bucket: string, subpath: string, b: Blob, contentType?: string) => {
            const up = await supabase.storage.from(bucket).upload(subpath, b, { upsert: false, contentType });
            if (up.error) throw up.error;
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(subpath, 60 * 60 * 24 * 365);
            return signed?.signedUrl ?? null;
          };

          let patch: Record<string, unknown>;

          if (it.kind === "psd") {
            const psdUrl = await uploadTo("source-psd-files", `${base}-${it.originalName}`, blob);
            try {
              const buf = await blob.arrayBuffer();
              const art = await processGarmentPsd(buf);
              const [baseUrl, overlayUrl, mockupUrl, previewUrl] = await Promise.all([
                art.base ? uploadTo("garment-mockups", `${base}-base.png`, art.base, "image/png") : Promise.resolve(null),
                art.overlay ? uploadTo("garment-mockups", `${base}-overlay.png`, art.overlay, "image/png") : Promise.resolve(null),
                uploadTo("garment-mockups", `${base}-mockup.png`, art.mockup, "image/png"),
                uploadTo("garment-previews", `${base}-preview.png`, art.preview, "image/png"),
              ]);
              const chosenArea =
                existingArea ??
                (art.printArea && isValidGarmentPrintArea(art.printArea)
                  ? art.printArea
                  : getDefaultGarmentPrintArea(it.type));
              patch = {
                source_psd_url: psdUrl,
                base_url: baseUrl,
                overlay_url: overlayUrl,
                mockup_url: mockupUrl,
                preview_url: previewUrl,
                source_width: art.width,
                source_height: art.height,
                print_area: chosenArea,
                mold_status: "listo",
                processing_error: null,
              };
            } catch (convErr) {
              const msg = convErr instanceof Error ? convErr.message : String(convErr);
              patch = {
                source_psd_url: psdUrl,
                mold_status: "error_conversion",
                processing_error: msg.slice(0, 500),
              };
            }
          } else if (it.kind === "image") {
            const dims = await readImageDimensions(blob);
            const mockupUrl = await uploadTo("garment-mockups", `${base}-${it.originalName}`, blob);
            const previewUrl = await uploadTo("garment-previews", `${base}-preview-${it.originalName}`, blob);
            const chosenArea = existingArea ?? getDefaultGarmentPrintArea(it.type);
            patch = {
              base_url: mockupUrl,
              overlay_url: null,
              mockup_url: mockupUrl,
              preview_url: previewUrl,
              source_width: dims.width,
              source_height: dims.height,
              print_area: chosenArea,
              mold_status: "listo",
              processing_error: null,
            };
          } else {
            throw new Error("Extensión no soportada");
          }

          const { data: updated, error: uErr } = await supabase
            .from("garments")
            .update(patch as never)
            .eq("id", rowId)
            .select("id, mold_status, mockup_url, print_area, processing_error")
            .single();
          if (uErr) throw uErr;
          if (!updated?.id || updated.id !== rowId) {
            throw new Error("Update no devolvió la fila esperada");
          }
          const uStatus = (updated as { mold_status?: string }).mold_status;
          if (uStatus === "error_conversion") {
            const err = (updated as { processing_error?: string }).processing_error;
            updateItem(it.id, { status: "error", message: err ?? "Conversión falló" });
            errorCount += 1;
            continue;
          }
          if (uStatus !== "listo") throw new Error("Estado inesperado");
          if (!(updated as { mockup_url?: string }).mockup_url) throw new Error("Sin mockup_url");
          if (!isValidGarmentPrintArea((updated as { print_area?: unknown }).print_area)) {
            throw new Error("print_area guardado no es válido");
          }
          updateItem(it.id, { status: "done" });
          successCount += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          updateItem(it.id, { status: "error", message: msg });
          errorCount += 1;
        } finally {
          done += 1;
          setProgress({ done, total: pending.length });
        }
      }

      if (errorCount === 0) toast.success(`Importación finalizada: ${successCount} listo(s)`);
      else if (successCount > 0) toast.warning(`Importación con errores: ${successCount} listo(s) · ${errorCount} fallido(s)`);
      else toast.error(`Importación fallida: ${errorCount} fallido(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold inline-flex items-center gap-2">
              <Shirt className="h-5 w-5" /> Importar mockups de prendas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Arrastra PSD/PNG/JPG/WEBP, carpetas o ZIPs con poleras y polerones. Se detecta tipo, color y vista
              a partir del nombre y carpeta. Las prendas nuevas quedan <b>inactivas</b> hasta que las revises.
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

        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatMini label="Archivos" value={stats.files} />
          <StatMini label="Poleras" value={stats.poleras} />
          <StatMini label="Polerones" value={stats.polerones} />
          <StatMini label="PSD" value={stats.psd} />
          <StatMini label="Imágenes" value={stats.images} />
          <StatMini label="Sin tipo" value={stats.unknown} warn={stats.unknown > 0} />
        </div>

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

      {items.length > 0 && (
        <div className="rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3">Archivo</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Color</th>
                  <th className="p-3">Vista</th>
                  <th className="p-3">Slug</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
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
                      <select
                        value={it.type ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateItem(it.id, { type: v === "" ? null : (v as GarmentType) });
                        }}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="">— Revisar —</option>
                        <option value="polera">Polera</option>
                        <option value="poleron">Polerón</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <input
                        value={it.name}
                        onChange={(e) => updateItem(it.id, { name: e.target.value })}
                        className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <input
                        value={it.color}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateItem(it.id, { color: v, colorSlug: slugify(v) });
                        }}
                        className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-3">
                      <select
                        value={it.view}
                        onChange={(e) => updateItem(it.id, { view: e.target.value as GarmentView })}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="front">Frente</option>
                        <option value="back">Espalda</option>
                      </select>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{it.slug}</td>
                    <td className="p-3"><StatusPill it={it} /></td>
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
      )}
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
  if (it.type === null) return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><AlertTriangle className="h-3 w-3" /> revisar</span>;
  if (it.confidence === "low") return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><AlertTriangle className="h-3 w-3" /> revisar</span>;
  if (it.confidence === "medium") return <span className="text-xs text-amber-300">pendiente</span>;
  return <span className="text-xs text-muted-foreground">pendiente</span>;
}
