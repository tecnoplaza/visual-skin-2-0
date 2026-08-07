import { useEffect, useState, useCallback, ChangeEvent } from "react";
import { Loader2, Save, Plus, Trash2, Upload, Image as ImageIcon, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_HOME, DEFAULT_CONTACT, DEFAULT_VISUAL,
  DEFAULT_LEGAL_IDENTITY, DEFAULT_LEGAL_TERMS, DEFAULT_LEGAL_PRIVACY, DEFAULT_LEGAL_RETURNS,
  TERMS_SECTIONS, PRIVACY_SECTIONS, RETURNS_SECTIONS,
  LEGAL_IDENTITY_FIELDS,
  legalIdentityMissing, legalIdentityInvalid, legalDocMissing, sanitizeLegalText,
  isValidRutChileno, formatLegalDocForReview,
  saveSiteContent, uploadCmsMedia,
  normalizeEmail, normalizeWhatsapp, normalizeInstagram, normalizeFacebook,
  normalizeCategorySlug, validateCategorySlug,
  type HomeContent, type ContactContent, type VisualContent,
  type PromoPack, type CatalogCategory, type Faq, type Banner,
  type LegalIdentity, type LegalDoc, type LegalSectionSpec,
} from "@/lib/cms";
import { useQueryClient } from "@tanstack/react-query";

type Section = "home" | "packs" | "catalog" | "faq" | "contact" | "banners" | "visual" | "legal" | "shipping";

export default function CmsView() {
  const [section, setSection] = useState<Section>("home");
  const tabs: { id: Section; label: string }[] = [
    { id: "home", label: "Inicio" },
    { id: "packs", label: "Packs destacados" },
    { id: "catalog", label: "Catálogo visual" },
    { id: "faq", label: "FAQ" },
    { id: "contact", label: "Contacto" },
    { id: "banners", label: "Banners" },
    { id: "visual", label: "Configuración visual" },
    { id: "shipping", label: "Despacho" },
    { id: "legal", label: "Información legal" },
  ];
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={`rounded-full border px-4 py-2 text-sm ${
              section === t.id
                ? "border-neon-blue bg-neon-blue/10 text-neon-blue"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {section === "home" && <HomeEditor />}
      {section === "packs" && <PacksEditor />}
      {section === "catalog" && <CatalogEditor />}
      {section === "faq" && <FaqEditor />}
      {section === "contact" && <ContactEditor />}
      {section === "banners" && <BannersEditor />}
      {section === "visual" && <VisualEditor />}
      {section === "shipping" && <ShippingEditor />}
      {section === "legal" && <LegalEditor />}
    </div>
  );
}

// ---------- Shared UI ----------
function Field({
  label, children, hint,
}: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      {hint && (
        <div className="mb-1.5 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground/80">{hint}</div>
      )}
      {children}
    </label>
  );
}
function Text(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={"w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue " + (props.className ?? "")} />;
}
function Area(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={"w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue " + (props.className ?? "")} />;
}
function PrimaryBtn({ busy, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {children}
    </button>
  );
}
function ImagePicker({ value, onChange, folder, label = "Imagen" }: { value: string; onChange: (v: string) => void; folder: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try { const url = await uploadCmsMedia(f, folder); onChange(url); toast.success("Imagen subida"); }
    catch (err: any) { toast.error(err.message ?? "Error subiendo"); }
    finally { setBusy(false); e.target.value = ""; }
  };
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-neon-blue">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Subir
          <input type="file" accept="image/*" hidden onChange={onFile} />
        </label>
        {value && <button onClick={() => onChange("")} className="text-xs text-muted-foreground hover:text-destructive">Quitar</button>}
      </div>
      {value && <Text value={value} onChange={(e) => onChange(e.target.value)} className="mt-2" />}
    </div>
  );
}

// ---------- HOME ----------
function HomeEditor() {
  const [data, setData] = useState<HomeContent>(DEFAULT_HOME);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { (async () => {
    const { data: row } = await supabase.from("site_content").select("value").eq("key", "home").maybeSingle();
    if (row) setData({ ...DEFAULT_HOME, ...(row.value as any) });
  })(); }, []);
  const save = async () => {
    setBusy(true);
    try { await saveSiteContent("home", data); toast.success("Inicio guardado"); qc.invalidateQueries({ queryKey: ["cms", "home"] }); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = <K extends keyof HomeContent>(k: K, v: HomeContent[K]) => setData((d) => ({ ...d, [k]: v }));
  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-display text-xl font-semibold">Inicio</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Título del hero"><Area rows={2} value={data.hero_title} onChange={(e) => set("hero_title", e.target.value)} /></Field>
        <Field label="Subtítulo"><Area rows={2} value={data.hero_subtitle} onChange={(e) => set("hero_subtitle", e.target.value)} /></Field>
        <Field label="Botón principal"><Text value={data.hero_cta_primary} onChange={(e) => set("hero_cta_primary", e.target.value)} /></Field>
        <Field label="Botón secundario"><Text value={data.hero_cta_secondary} onChange={(e) => set("hero_cta_secondary", e.target.value)} /></Field>
      </div>
      <ImagePicker value={data.hero_image_url} onChange={(v) => set("hero_image_url", v)} folder="home" label="Imagen / mockup principal" />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Beneficios destacados</div>
          <button onClick={() => set("benefits", [...data.benefits, { title: "", desc: "" }])} className="inline-flex items-center gap-1 text-sm text-neon-blue"><Plus className="h-4 w-4" /> Añadir</button>
        </div>
        <div className="space-y-3">
          {data.benefits.map((b, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_2fr_auto]">
              <Text placeholder="Título" value={b.title} onChange={(e) => { const arr = [...data.benefits]; arr[i] = { ...arr[i], title: e.target.value }; set("benefits", arr); }} />
              <Text placeholder="Descripción" value={b.desc} onChange={(e) => { const arr = [...data.benefits]; arr[i] = { ...arr[i], desc: e.target.value }; set("benefits", arr); }} />
              <button onClick={() => set("benefits", data.benefits.filter((_, j) => j !== i))} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Secciones visibles</div>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(data.sections) as (keyof HomeContent["sections"])[]).map((k) => (
            <label key={k} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="checkbox" checked={data.sections[k]} onChange={(e) => set("sections", { ...data.sections, [k]: e.target.checked })} />
              {k}
            </label>
          ))}
        </div>
      </div>

      <PrimaryBtn busy={busy} onClick={save}>Guardar Inicio</PrimaryBtn>
    </div>
  );
}

// ---------- PACKS ----------
function PacksEditor() {
  const [rows, setRows] = useState<PromoPack[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("promo_packs").select("*").order("sort_order");
    if (error) toast.error(error.message); else setRows((data ?? []) as PromoPack[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); qc.invalidateQueries({ queryKey: ["cms", "promo_packs"] }); };

  const addNew = async () => {
    const { data, error } = await supabase.from("promo_packs").insert({ name: "Nuevo pack", sort_order: rows.length }).select().single();
    if (error) return toast.error(error.message);
    setRows([...rows, data as PromoPack]); refresh();
  };
  const update = async (id: string, patch: Partial<PromoPack>) => {
    setRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("promo_packs").update(patch as any).eq("id", id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: ["cms", "promo_packs"] });
  };
  const remove = async (id: string) => {
    if (!confirm("¿Eliminar pack?")) return;
    const { error } = await supabase.from("promo_packs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows(rows.filter((r) => r.id !== id)); refresh();
  };

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Packs destacados</h2>
        <button onClick={addNew} className="inline-flex items-center gap-2 rounded-lg bg-neon-blue/20 px-3 py-2 text-sm text-neon-blue"><Plus className="h-4 w-4" /> Nuevo pack</button>
      </div>
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No hay packs. Ejemplos sugeridos: Pack carcasa + polera, carcasa + polerón, pack pareja, pack familiar.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <Text value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} className="!text-base font-semibold" />
              <button onClick={() => remove(r.id)} className="ml-2 rounded-lg p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Area rows={2} placeholder="Descripción" value={r.description ?? ""} onChange={(e) => update(r.id, { description: e.target.value })} />
            <Field label="Tipo de pack">
              <select
                value={r.pack_type}
                onChange={(e) => update(r.id, { pack_type: e.target.value as PromoPack["pack_type"] })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="carcasa">Solo Carcasa</option>
                <option value="carcasa+polera">Carcasa + Polera</option>
                <option value="carcasa+poleron">Carcasa + Polerón</option>
                <option value="carcasa+polera+poleron">Carcasa + Polera + Polerón</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Precio base"><Text type="number" value={r.price} onChange={(e) => update(r.id, { price: Number(e.target.value) })} /></Field>
              <Field label="Precio oferta"><Text type="number" value={r.sale_price ?? ""} onChange={(e) => update(r.id, { sale_price: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Etiqueta"><Text value={r.tag ?? ""} onChange={(e) => update(r.id, { tag: e.target.value })} /></Field>
              <Field label="Orden"><Text type="number" value={r.sort_order} onChange={(e) => update(r.id, { sort_order: Number(e.target.value) })} /></Field>
              <Field label="Texto botón"><Text value={r.button_label ?? ""} onChange={(e) => update(r.id, { button_label: e.target.value })} /></Field>
            </div>
            <Field label="Productos incluidos (separados por coma)">
              <Text value={(r.includes ?? []).join(", ")} onChange={(e) => update(r.id, { includes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Características / bullets (separados por coma)">
              <Text value={(r.features ?? []).join(", ")} onChange={(e) => update(r.id, { features: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <ImagePicker value={r.image_url ?? ""} onChange={(v) => update(r.id, { image_url: v })} folder="packs" />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.is_active} onChange={(e) => update(r.id, { is_active: e.target.checked })} /> Activo (visible al cliente)
            </label>

          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- CATALOG ----------
function CatalogEditor() {
  const [rows, setRows] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [slugDrafts, setSlugDrafts] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["cms", "catalog_categories"] });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) toast.error(error.message);
    else setRows((data ?? []) as CatalogCategory[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const genUniqueSlug = (base: string) => {
    const norm = normalizeCategorySlug(base) || "categoria";
    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(norm)) return norm;
    let i = 2;
    while (taken.has(`${norm}-${i}`)) i++;
    return `${norm}-${i}`;
  };

  const addNew = async () => {
    const slug = genUniqueSlug("nueva-categoria");
    const { data, error } = await supabase
      .from("catalog_categories")
      .insert({ name: "Nueva categoría", slug, is_active: false, sort_order: rows.length })
      .select().single();
    if (error) return toast.error(error.message);
    setRows([...rows, data as CatalogCategory]);
    refresh();
    toast.success("Categoría creada (inactiva). Edítala y actívala cuando esté lista.");
  };

  const update = async (id: string, patch: Partial<CatalogCategory>) => {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("catalog_categories").update(patch as any).eq("id", id);
    if (error) { toast.error(error.message); load(); } else refresh();
  };

  const commitSlug = async (id: string, current: string, draft: string) => {
    const { value, error } = validateCategorySlug(draft);
    if (error) { toast.error(error); setSlugDrafts((d) => { const n = { ...d }; delete n[id]; return n; }); return; }
    if (value === current) { setSlugDrafts((d) => { const n = { ...d }; delete n[id]; return n; }); return; }
    if (rows.some((r) => r.id !== id && r.slug === value)) {
      toast.error("Ya existe una categoría con ese slug");
      setSlugDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
      return;
    }
    const ok = confirm("Cambiar el slug puede romper enlaces existentes. ¿Continuar?");
    if (!ok) { setSlugDrafts((d) => { const n = { ...d }; delete n[id]; return n; }); return; }
    await update(id, { slug: value });
    setSlugDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    setRows((rs) => {
      const copy = [...rs];
      copy[i] = { ...a, sort_order: b.sort_order };
      copy[j] = { ...b, sort_order: a.sort_order };
      return copy;
    });
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("catalog_categories").update({ sort_order: b.sort_order } as any).eq("id", a.id),
      supabase.from("catalog_categories").update({ sort_order: a.sort_order } as any).eq("id", b.id),
    ]);
    if (e1 || e2) { toast.error("No se pudo reordenar"); load(); } else { load(); refresh(); }
  };

  const remove = async (row: CatalogCategory) => {
    if (row.is_active) {
      toast.error("Desactiva la categoría antes de eliminarla");
      return;
    }
    const typed = prompt(`Escribe el nombre exacto para confirmar: ${row.name}`);
    if (typed !== row.name) { if (typed !== null) toast.error("Confirmación no coincide"); return; }
    const { error } = await supabase.from("catalog_categories").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    refresh();
    toast.success("Categoría eliminada");
  };

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Categorías del catálogo</h2>
          <p className="text-xs text-muted-foreground">Se crean inactivas. Actívalas cuando el contenido esté listo.</p>
        </div>
        <button onClick={addNew} className="inline-flex items-center gap-2 rounded-lg bg-neon-blue/20 px-3 py-2 text-sm text-neon-blue"><Plus className="h-4 w-4" /> Nueva categoría</button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aún no hay categorías. Crea la primera con el botón «Nueva categoría».
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r, i) => (
            <div key={r.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <Text
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (!trimmed) { toast.error("El nombre es obligatorio"); load(); return; }
                    if (trimmed !== e.target.value) update(r.id, { name: trimmed });
                  }}
                  className="!text-base font-semibold"
                />
                <button title="Subir" onClick={() => move(i, -1)} className="rounded-lg border border-border p-2"><ArrowUp className="h-4 w-4" /></button>
                <button title="Bajar" onClick={() => move(i, 1)} className="rounded-lg border border-border p-2"><ArrowDown className="h-4 w-4" /></button>
                <button title={r.is_active ? "Desactivar" : "Activar"} onClick={() => update(r.id, { is_active: !r.is_active })} className="rounded-lg border border-border p-2">
                  {r.is_active ? <Eye className="h-4 w-4 text-neon-green" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button title="Eliminar" onClick={() => remove(r)} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
              <Field label="Slug (URL amigable)">
                <Text
                  value={slugDrafts[r.id] ?? r.slug}
                  onChange={(e) => setSlugDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  onBlur={(e) => commitSlug(r.id, r.slug, e.target.value)}
                />
              </Field>
              <Field label="Descripción">
                <Area rows={2} value={r.description ?? ""} onChange={(e) => update(r.id, { description: e.target.value })} />
              </Field>
              <ImagePicker value={r.image_url ?? ""} onChange={(v) => update(r.id, { image_url: v || null as any })} folder="catalog" />
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className={`rounded-full px-2 py-1 ${r.is_active ? "bg-neon-green/10 text-neon-green" : "bg-muted"}`}>
                  {r.is_active ? "Activa" : "Inactiva"}
                </span>
                <span>Orden: {r.sort_order}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------- FAQ ----------
function FaqEditor() {
  const [rows, setRows] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("faqs").select("*").order("sort_order");
    if (error) toast.error(error.message); else setRows((data ?? []) as Faq[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["cms", "faqs"] });

  const addNew = async () => {
    const { data, error } = await supabase.from("faqs").insert({ question: "Nueva pregunta", answer: "", sort_order: rows.length }).select().single();
    if (error) return toast.error(error.message);
    setRows([...rows, data as Faq]); refresh();
  };
  const update = async (id: string, patch: Partial<Faq>) => {
    setRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("faqs").update(patch as any).eq("id", id);
    if (error) toast.error(error.message); else refresh();
  };
  const remove = async (id: string) => {
    if (!confirm("¿Eliminar pregunta?")) return;
    const { error } = await supabase.from("faqs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows(rows.filter((r) => r.id !== id)); refresh();
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    await Promise.all([
      supabase.from("faqs").update({ sort_order: b.sort_order } as any).eq("id", a.id),
      supabase.from("faqs").update({ sort_order: a.sort_order } as any).eq("id", b.id),
    ]);
    load(); refresh();
  };

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Preguntas frecuentes</h2>
        <button onClick={addNew} className="inline-flex items-center gap-2 rounded-lg bg-neon-blue/20 px-3 py-2 text-sm text-neon-blue"><Plus className="h-4 w-4" /> Nueva pregunta</button>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id} className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Text value={r.question} onChange={(e) => update(r.id, { question: e.target.value })} className="!text-base font-semibold" />
              <button onClick={() => move(i, -1)} className="rounded-lg border border-border p-2"><ArrowUp className="h-4 w-4" /></button>
              <button onClick={() => move(i, 1)} className="rounded-lg border border-border p-2"><ArrowDown className="h-4 w-4" /></button>
              <button onClick={() => update(r.id, { is_active: !r.is_active })} className="rounded-lg border border-border p-2">
                {r.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
              </button>
              <button onClick={() => remove(r.id)} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Area rows={2} placeholder="Respuesta" value={r.answer} onChange={(e) => update(r.id, { answer: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- CONTACT ----------
function ContactEditor() {
  const [data, setData] = useState<ContactContent>(DEFAULT_CONTACT);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { (async () => {
    const { data: row } = await supabase.from("site_content").select("value").eq("key", "contact").maybeSingle();
    if (row) setData({ ...DEFAULT_CONTACT, ...(row.value as any) });
  })(); }, []);

  const emailV = normalizeEmail(data.email);
  const waV = normalizeWhatsapp(data.whatsapp);
  const igV = normalizeInstagram(data.instagram);
  const fbV = normalizeFacebook(data.facebook);
  const errors = [emailV.error, waV.error, igV.error, fbV.error].filter(Boolean) as string[];
  const hasErrors = errors.length > 0;

  const save = async () => {
    if (hasErrors) { toast.error("Corrige los campos marcados antes de guardar"); return; }
    setBusy(true);
    try {
      // Persist trimmed values; empty stays empty (channel disabled).
      const clean: ContactContent = {
        email: (data.email ?? "").trim(),
        whatsapp: (data.whatsapp ?? "").trim(),
        instagram: (data.instagram ?? "").trim(),
        facebook: (data.facebook ?? "").trim(),
        address: (data.address ?? "").trim(),
        hours: (data.hours ?? "").trim(),
      };
      await saveSiteContent("contact", clean);
      setData(clean);
      toast.success("Contacto guardado");
      qc.invalidateQueries({ queryKey: ["cms", "contact"] });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = <K extends keyof ContactContent>(k: K, v: ContactContent[K]) => setData((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-display text-xl font-semibold">Contacto</h2>
      <p className="text-xs text-muted-foreground">Los canales vacíos no se mostrarán públicamente.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Field label="Correo electrónico">
            <Text
              type="email"
              placeholder="Ejemplo: contacto@tudominio.cl"
              value={data.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          {emailV.error && <p className="mt-1 text-xs text-destructive">{emailV.error}</p>}
        </div>
        <div>
          <Field label="WhatsApp">
            <Text
              placeholder="Ejemplo: +56912345678"
              value={data.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
            />
          </Field>
          {waV.error && <p className="mt-1 text-xs text-destructive">{waV.error}</p>}
        </div>
        <div>
          <Field label="Instagram">
            <Text
              placeholder="Ejemplo: https://instagram.com/usuario"
              value={data.instagram}
              onChange={(e) => set("instagram", e.target.value)}
            />
          </Field>
          {igV.error && <p className="mt-1 text-xs text-destructive">{igV.error}</p>}
        </div>
        <div>
          <Field label="Facebook">
            <Text
              placeholder="Ejemplo: https://facebook.com/usuario"
              value={data.facebook}
              onChange={(e) => set("facebook", e.target.value)}
            />
          </Field>
          {fbV.error && <p className="mt-1 text-xs text-destructive">{fbV.error}</p>}
        </div>
        <Field label="Dirección (opcional)"><Text value={data.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Horario (opcional)"><Text value={data.hours} onChange={(e) => set("hours", e.target.value)} /></Field>
      </div>
      <PrimaryBtn busy={busy || hasErrors} onClick={save}>Guardar Contacto</PrimaryBtn>
    </div>
  );
}

// ---------- BANNERS ----------
function BannersEditor() {
  const [rows, setRows] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("banners").select("*").order("sort_order");
    if (error) toast.error(error.message); else setRows((data ?? []) as Banner[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["cms", "banners"] });

  const addNew = async () => {
    const { data, error } = await supabase.from("banners").insert({ text: "Nuevo banner", sort_order: rows.length }).select().single();
    if (error) return toast.error(error.message);
    setRows([...rows, data as Banner]); refresh();
  };
  const update = async (id: string, patch: Partial<Banner>) => {
    setRows(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("banners").update(patch as any).eq("id", id);
    if (error) toast.error(error.message); else refresh();
  };
  const remove = async (id: string) => {
    if (!confirm("¿Eliminar banner?")) return;
    const { error } = await supabase.from("banners").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows(rows.filter((r) => r.id !== id)); refresh();
  };

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Banners</h2>
        <button onClick={addNew} className="inline-flex items-center gap-2 rounded-lg bg-neon-blue/20 px-3 py-2 text-sm text-neon-blue"><Plus className="h-4 w-4" /> Nuevo banner</button>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-[128px_1fr_auto]">
            <ImagePicker value={r.image_url ?? ""} onChange={(v) => update(r.id, { image_url: v })} folder="banners" label="" />
            <div className="space-y-2">
              <Field label="Texto"><Text value={r.text} onChange={(e) => update(r.id, { text: e.target.value })} /></Field>
              <Field label="Enlace"><Text value={r.link_url ?? ""} onChange={(e) => update(r.id, { link_url: e.target.value })} /></Field>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={r.is_active} onChange={(e) => update(r.id, { is_active: e.target.checked })} /> Activo</label>
            </div>
            <button onClick={() => remove(r.id)} className="self-start rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- VISUAL ----------
function VisualEditor() {
  const [data, setData] = useState<VisualContent>(DEFAULT_VISUAL);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { (async () => {
    const { data: row } = await supabase.from("site_content").select("value").eq("key", "visual").maybeSingle();
    if (row) setData({ ...DEFAULT_VISUAL, ...(row.value as any) });
  })(); }, []);
  const save = async () => {
    setBusy(true);
    try { await saveSiteContent("visual", data); toast.success("Configuración guardada"); qc.invalidateQueries({ queryKey: ["cms", "visual"] }); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = <K extends keyof VisualContent>(k: K, v: VisualContent[K]) => setData((d) => ({ ...d, [k]: v }));
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-display text-xl font-semibold">Configuración visual</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <ImagePicker value={data.logo_url} onChange={(v) => set("logo_url", v)} folder="visual" label="Logo" />
        <ImagePicker value={data.favicon_url} onChange={(v) => set("favicon_url", v)} folder="visual" label="Favicon" />
        <Field label="Color principal"><Text type="color" value={data.color_primary} onChange={(e) => set("color_primary", e.target.value)} className="h-10 !p-1" /></Field>
        <Field label="Color de botones"><Text type="color" value={data.color_button} onChange={(e) => set("color_button", e.target.value)} className="h-10 !p-1" /></Field>
      </div>
      <Field label="Textos legales básicos"><Area rows={4} value={data.legal_text} onChange={(e) => set("legal_text", e.target.value)} /></Field>
      <PrimaryBtn busy={busy} onClick={save}>Guardar</PrimaryBtn>
    </div>
  );
}

// ---------- LEGAL ----------
function LegalEditor() {
  const [tab, setTab] = useState<"identity" | "terms" | "privacy" | "returns">("identity");
  const tabs = [
    { id: "identity" as const, label: "Identidad" },
    { id: "terms" as const, label: "Términos" },
    { id: "privacy" as const, label: "Privacidad" },
    { id: "returns" as const, label: "Cambios y devoluciones" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              tab === t.id
                ? "border-neon-blue bg-neon-blue/10 text-neon-blue"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >{t.label}</button>
        ))}
      </div>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        Estos documentos no se publican automáticamente. Complétalos y usa
        «Publicar» cuando estén revisados. Los enlaces del sitio público
        aparecen solo cuando el documento está publicado.
      </div>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Revisa que estos textos coincidan con el funcionamiento real de
        VisualSkin. La plataforma no debe prometer plazos, coberturas,
        devoluciones o servicios que el negocio no pueda cumplir. Este aviso
        se muestra solo en Admin y nunca se publica.
      </div>
      {tab === "identity" && <LegalIdentityEditor />}
      {tab === "terms" && <LegalDocEditor storageKey="legal_terms" title="Términos y condiciones" defaults={DEFAULT_LEGAL_TERMS} spec={TERMS_SECTIONS} queryKey={["cms", "legal_terms"]} />}
      {tab === "privacy" && <LegalDocEditor storageKey="legal_privacy" title="Política de privacidad" defaults={DEFAULT_LEGAL_PRIVACY} spec={PRIVACY_SECTIONS} queryKey={["cms", "legal_privacy"]} />}
      {tab === "returns" && <LegalDocEditor storageKey="legal_returns" title="Cambios, devoluciones y garantía" defaults={DEFAULT_LEGAL_RETURNS} spec={RETURNS_SECTIONS} queryKey={["cms", "legal_returns"]} extraNotice="Los productos personalizados no pierden la garantía legal cuando presentan fallas o no corresponden a lo contratado." />}
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallthrough */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function LegalIdentityEditor() {
  const [data, setData] = useState<LegalIdentity>(DEFAULT_LEGAL_IDENTITY);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const qc = useQueryClient();
  useEffect(() => { (async () => {
    const { data: row } = await supabase.from("site_content").select("value").eq("key", "legal_identity").maybeSingle();
    if (row) setData({ ...DEFAULT_LEGAL_IDENTITY, ...(row.value as any) });
    setLoaded(true);
  })(); }, []);
  const set = <K extends keyof LegalIdentity>(k: K, v: LegalIdentity[K]) => setData((d) => ({ ...d, [k]: v }));
  const missing = legalIdentityMissing(data);
  const invalid = legalIdentityInvalid(data);
  const canPublish = missing.length === 0 && invalid.length === 0;

  const save = async (nextStatus?: "draft" | "published") => {
    if (nextStatus === "published" && !canPublish) {
      toast.error("Corrige los campos pendientes antes de publicar");
      return;
    }
    setBusy(true);
    try {
      const payload: LegalIdentity = {
        ...data,
        status: nextStatus ?? data.status,
        updated_at: new Date().toISOString(),
      };
      await saveSiteContent("legal_identity", payload);
      setData(payload);
      qc.invalidateQueries({ queryKey: ["cms", "legal_identity"] });
      toast.success(nextStatus === "published" ? "Identidad publicada" : nextStatus === "draft" ? "Publicación retirada" : "Guardado");
    } catch (e: any) { toast.error(e.message ?? "Error al guardar"); }
    finally { setBusy(false); }
  };

  if (!loaded) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Identidad legal del vendedor</h2>
        <span className={`rounded-full px-2 py-1 text-xs ${data.status === "published" ? "bg-neon-green/10 text-neon-green" : "bg-muted text-muted-foreground"}`}>
          {data.status === "published" ? "Publicada" : "Borrador"}
        </span>
      </div>
      {missing.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Faltan campos obligatorios: {missing.map((k) => LEGAL_IDENTITY_FIELDS.find((f) => f.key === k)?.label ?? k).join(", ")}
        </div>
      )}
      {invalid.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Datos con formato inválido: {invalid.join(" · ")}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {LEGAL_IDENTITY_FIELDS.map((f) => {
          const value = String(data[f.key] ?? "");
          const isRut = f.key === "rut";
          const isEmail = f.type === "email";
          const showRutError = isRut && value.trim().length > 0 && !isValidRutChileno(value);
          const showEmailError = isEmail && value.trim().length > 0 && !!normalizeEmail(value).error;
          return (
            <Field
              key={f.key}
              label={`${f.label}${f.required ? " *" : ""}`}
              hint={f.hint}
            >
              <Text
                type={f.type === "email" ? "email" : "text"}
                value={value}
                placeholder={f.example}
                onChange={(e) => set(f.key, e.target.value as LegalIdentity[typeof f.key])}
              />
              {showRutError && (
                <div className="mt-1 text-[11px] text-destructive">Formato de RUT inválido (usa 12.345.678-5).</div>
              )}
              {showEmailError && (
                <div className="mt-1 text-[11px] text-destructive">Correo inválido.</div>
              )}
            </Field>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryBtn busy={busy} onClick={() => save()}>Guardar borrador</PrimaryBtn>
        {data.status !== "published" ? (
          <button disabled={busy || !canPublish} onClick={() => save("published")} className="rounded-lg bg-neon-green/20 px-4 py-2 text-sm text-neon-green disabled:opacity-40">Publicar</button>
        ) : (
          <button disabled={busy} onClick={() => save("draft")} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40">Despublicar</button>
        )}
        {data.updated_at && <span className="text-xs text-muted-foreground">Actualizado: {new Date(data.updated_at).toLocaleString("es-CL")}</span>}
      </div>
    </div>
  );
}

function LegalDocEditor({
  storageKey, title, defaults, spec, queryKey, extraNotice,
}: {
  storageKey: string;
  title: string;
  defaults: LegalDoc;
  spec: LegalSectionSpec[];
  queryKey: readonly string[];
  extraNotice?: string;
}) {
  const [data, setData] = useState<LegalDoc>(defaults);
  const [identity, setIdentity] = useState<LegalIdentity>(DEFAULT_LEGAL_IDENTITY);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const qc = useQueryClient();

  useEffect(() => { (async () => {
    const [{ data: row }, { data: idRow }] = await Promise.all([
      supabase.from("site_content").select("value").eq("key", storageKey).maybeSingle(),
      supabase.from("site_content").select("value").eq("key", "legal_identity").maybeSingle(),
    ]);
    if (row) {
      const val = row.value as any;
      setData({
        status: val.status === "published" ? "published" : "draft",
        updated_at: val.updated_at ?? null,
        sections: { ...defaults.sections, ...(val.sections ?? {}) },
      });
    }
    if (idRow) setIdentity({ ...DEFAULT_LEGAL_IDENTITY, ...(idRow.value as any) });
    setLoaded(true);
  })(); }, [storageKey]);

  const setSection = (k: string, v: string) =>
    setData((d) => ({ ...d, sections: { ...d.sections, [k]: v } }));

  const missing = legalDocMissing(data, spec);
  const identityMissing = legalIdentityMissing(identity);
  const identityInvalid = legalIdentityInvalid(identity);
  const canPublish = missing.length === 0 && identityMissing.length === 0 && identityInvalid.length === 0;

  const save = async (nextStatus?: "draft" | "published") => {
    if (nextStatus === "published" && !canPublish) {
      toast.error("Completa los campos pendientes antes de publicar");
      return;
    }
    setBusy(true);
    try {
      const cleanSections: Record<string, string> = {};
      for (const s of spec) cleanSections[s.key] = sanitizeLegalText(data.sections[s.key] ?? "");
      const payload: LegalDoc = {
        status: nextStatus ?? data.status,
        updated_at: new Date().toISOString(),
        sections: cleanSections,
      };
      await saveSiteContent(storageKey, payload);
      setData(payload);
      qc.invalidateQueries({ queryKey });
      toast.success(nextStatus === "published" ? "Documento publicado" : nextStatus === "draft" ? "Publicación retirada" : "Guardado");
    } catch (e: any) { toast.error(e.message ?? "Error al guardar"); }
    finally { setBusy(false); }
  };

  const copyForReview = async () => {
    const text = formatLegalDocForReview(title, identity, data, spec);
    const ok = await copyToClipboard(text);
    if (ok) toast.success("Documento copiado para revisión");
    else toast.error("No se pudo copiar; selecciona el texto manualmente");
  };

  if (!loaded) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;

  const checklistItems = [
    { label: "Identidad legal completa", done: identityMissing.length === 0 && identityInvalid.length === 0 },
    ...spec.filter((s) => s.required).map((s) => ({
      label: s.title,
      done: !!String(data.sections[s.key] ?? "").trim(),
    })),
  ];

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <span className={`rounded-full px-2 py-1 text-xs ${data.status === "published" ? "bg-neon-green/10 text-neon-green" : "bg-muted text-muted-foreground"}`}>
          {data.status === "published" ? "Publicado" : "Borrador"}
        </span>
      </div>
      {extraNotice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">{extraNotice}</div>
      )}
      {(identityMissing.length > 0 || identityInvalid.length > 0) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
          Antes de publicar debes completar la <strong>Identidad legal del vendedor</strong> en la pestaña «Identidad».
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Secciones obligatorias pendientes: {missing.join(" · ")}
        </div>
      )}
      {preview ? (
        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <h3 className="font-display text-2xl">{title}</h3>
          {spec.map((s) => {
            const body = data.sections[s.key]?.trim();
            if (!body) return null;
            return (
              <section key={s.key}>
                <h4 className="mt-4 font-semibold">{s.title}</h4>
                {body.split(/\n{2,}/).map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap text-sm text-muted-foreground">{p}</p>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {spec.map((s) => (
            <Field
              key={s.key}
              label={`${s.title}${s.required ? " *" : ""}`}
              hint={s.hint}
            >
              <Area
                rows={4}
                value={data.sections[s.key] ?? ""}
                onChange={(e) => setSection(s.key, e.target.value)}
                placeholder={s.example}
              />
            </Field>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Checklist de publicación
        </div>
        <ul className="grid gap-1 text-xs md:grid-cols-2">
          {checklistItems.map((it) => (
            <li key={it.label} className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${it.done ? "bg-neon-green" : "bg-amber-400"}`} />
              <span className={it.done ? "text-muted-foreground" : "text-foreground"}>
                {it.label}
              </span>
              <span className={`ml-auto text-[10px] uppercase tracking-wider ${it.done ? "text-neon-green" : "text-amber-400"}`}>
                {it.done ? "Completo" : "Pendiente"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryBtn busy={busy} onClick={() => save()}>Guardar borrador</PrimaryBtn>
        {data.status !== "published" ? (
          <button disabled={busy || !canPublish} onClick={() => save("published")} className="rounded-lg bg-neon-green/20 px-4 py-2 text-sm text-neon-green disabled:opacity-40">Publicar</button>
        ) : (
          <button disabled={busy} onClick={() => save("draft")} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40">Despublicar</button>
        )}
        <button onClick={() => setPreview((p) => !p)} className="rounded-lg border border-border px-4 py-2 text-sm">{preview ? "Volver a editar" : "Vista previa"}</button>
        <button onClick={copyForReview} className="rounded-lg border border-border px-4 py-2 text-sm">Copiar documento para revisión</button>
        {data.updated_at && <span className="text-xs text-muted-foreground">Actualizado: {new Date(data.updated_at).toLocaleString("es-CL")}</span>}
      </div>
    </div>
  );
}


// ---------- Despacho ----------
function ShippingEditor() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const [singleCase, setSingleCase] = useState("1990");
  const [singleGarment, setSingleGarment] = useState("2490");
  const [casePlusTshirt, setCasePlusTshirt] = useState("2490");
  const [freeQty, setFreeQty] = useState("2");
  const [exception, setException] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { fetchShippingConfig } = await import("@/lib/shipping");
      const cfg = await fetchShippingConfig();
      setEnabled(cfg.enabled);
      setSingleCase(String(cfg.singleCaseAmount));
      setSingleGarment(String(cfg.singleGarmentAmount));
      setCasePlusTshirt(String(cfg.casePlusTshirtAmount));
      setFreeQty(String(cfg.freeShippingFromQuantity));
      setException(cfg.casePlusTshirtExceptionEnabled);
      setUpdatedAt(cfg.updatedAt);
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const { validateShippingConfigInput } = await import("@/lib/shipping");
      const { errors: errs, value } = validateShippingConfigInput({
        enabled,
        singleCaseAmount: singleCase,
        singleGarmentAmount: singleGarment,
        casePlusTshirtAmount: casePlusTshirt,
        freeShippingFromQuantity: freeQty,
        casePlusTshirtExceptionEnabled: exception,
      });
      setErrors(errs);
      if (Object.keys(errs).length > 0) {
        toast.error("Corrige los campos marcados antes de guardar");
        return;
      }
      await saveSiteContent("shipping_config", value);
      setUpdatedAt(value.updatedAt);
      await qc.invalidateQueries({ queryKey: ["cms", "shipping_config"] });
      toast.success("Configuración de despacho guardada");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  const err = (k: string) =>
    errors[k] ? <div className="mt-1 text-[11px] text-destructive">{errors[k]}</div> : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        Los cambios se aplican solo a pedidos nuevos. Las órdenes ya creadas conservan el
        despacho calculado al momento de su creación.
      </div>

      <div className="rounded-lg border border-border p-4">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Cobrar despacho</span>
        </label>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Si está desactivado, todos los pedidos tienen despacho gratis. Los valores se conservan.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Field label="Una carcasa (CLP)" hint="Se cobra cuando el pedido contiene solo una carcasa.">
            <Text inputMode="numeric" pattern="\d*" value={singleCase} onChange={(e) => setSingleCase(e.target.value)} disabled={!enabled} />
          </Field>
          {err("singleCaseAmount")}
        </div>
        <div>
          <Field label="Una prenda (CLP)" hint="Aplica a una polera o un polerón cuando es la única unidad del pedido.">
            <Text inputMode="numeric" pattern="\d*" value={singleGarment} onChange={(e) => setSingleGarment(e.target.value)} disabled={!enabled} />
          </Field>
          {err("singleGarmentAmount")}
        </div>
        <div>
          <Field label="Carcasa + polera (CLP)" hint="Tarifa especial para la combinación exacta de una carcasa y una polera.">
            <Text inputMode="numeric" pattern="\d*" value={casePlusTshirt} onChange={(e) => setCasePlusTshirt(e.target.value)} disabled={!enabled || !exception} />
          </Field>
          {err("casePlusTshirtAmount")}
        </div>
        <div>
          <Field label="Envío gratis desde (unidades)" hint="Cantidad mínima de productos para que el despacho sea gratis.">
            <Text inputMode="numeric" pattern="\d*" value={freeQty} onChange={(e) => setFreeQty(e.target.value)} disabled={!enabled} />
          </Field>
          {err("freeShippingFromQuantity")}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={exception} onChange={(e) => setException(e.target.checked)} disabled={!enabled} />
          <span>Excepción carcasa + polera</span>
        </label>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Cuando está activa, la combinación exacta de una carcasa y una polera utiliza su tarifa especial aunque contenga dos productos.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryBtn busy={busy} onClick={save}>Guardar despacho</PrimaryBtn>
        {updatedAt && (
          <span className="text-xs text-muted-foreground">
            Actualizado: {new Date(updatedAt).toLocaleString("es-CL")}
          </span>
        )}
      </div>
    </div>
  );
}
