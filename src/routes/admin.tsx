import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useCallback, FormEvent } from "react";
import {
  Lock, LogOut, Package, ShoppingBag, Layers, Shirt, Image as ImageIcon,
  Plus, Trash2, Edit2, X, Loader2, Upload, ShieldAlert, UploadCloud, FileText,
  CreditCard, Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import TemplateImporter from "@/components/admin/TemplateImporter";
import GarmentTemplateImporter from "@/components/admin/GarmentTemplateImporter";
import {
  cloneGarmentPrintArea,
  getDefaultGarmentPrintArea,
  isValidGarmentPrintArea,
  type GarmentPrintArea,
  type GarmentType,
  type GarmentView,
} from "@/lib/garment-model";
import CmsView from "@/components/admin/CmsView";
import PaymentGatewaysView from "@/components/admin/PaymentGatewaysView";
import DiagnosticsView from "@/components/admin/DiagnosticsView";
import AdminNotificationBell from "@/components/admin/AdminNotificationBell";
import { processPsd } from "@/lib/psd-processor";
import { removeWhiteBackground } from "@/lib/remove-white-bg";
import {
  getDefaultPhonePrintArea,
  getSafePhonePrintArea,
  isValidPhonePrintArea,
  type PhoneModelPrintArea,
} from "@/lib/phone-model-print-area";



export const Route = createFileRoute("/admin")({
  component: AdminGate,
  head: () => ({
    meta: [
      { title: "Panel administrador — VISUALSKIN" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AdminGate() {
  const { user, isAdmin, loading } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (loading) return <Center><Loader2 className="h-6 w-6 animate-spin text-neon-blue" /></Center>;
  if (!user) return <Login />;
  if (!isAdmin) return <NotAdmin />;
  return pathname === "/admin" ? <AdminPanel /> : <Outlet />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center">{children}</div>;
}

function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bienvenido");
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        toast.success("Cuenta creada. Pídele a un admin que te dé permisos.");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally { setBusy(false); }
  };

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-16">
      <form onSubmit={submit} className="w-full rounded-2xl border border-border bg-card p-8">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-neon-blue to-neon-green text-background">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-center font-display text-2xl font-bold">Panel administrador</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "in" ? "Inicia sesión con tu cuenta admin" : "Crea una cuenta (requiere aprobación)"}
        </p>
        <div className="mt-6 space-y-3">
          <Input label="Email" type="email" value={email} onChange={setEmail} required />
          <Input label="Contraseña" type="password" value={password} onChange={setPassword} required />
        </div>
        <button disabled={busy} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-5 py-3 font-semibold text-background disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "in" ? "Entrar" : "Registrarse"}
        </button>
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground">
          {mode === "in" ? "¿Nuevo? Crear cuenta" : "Ya tengo cuenta"}
        </button>
      </form>
    </section>
  );
}

function NotAdmin() {
  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-16">
      <div className="w-full rounded-2xl border border-destructive/40 bg-card p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/20 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="font-display text-2xl font-bold">Acceso denegado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tu cuenta no tiene rol de administrador. Pide al equipo que te asigne rol <b>admin</b>.</p>
        <button onClick={() => supabase.auth.signOut()} className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm">
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </section>
  );
}

type Tab = "dashboard" | "cms" | "import" | "brands" | "models" | "garments" | "templates" | "orders" | "payments" | "diagnostics";

function AdminPanel() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: Package },
    { id: "cms", label: "Contenido web", icon: FileText },
    { id: "import", label: "Importar", icon: UploadCloud },
    { id: "brands", label: "Marcas", icon: Layers },
    { id: "models", label: "Modelos", icon: Package },
    { id: "garments", label: "Prendas", icon: Shirt },
    { id: "templates", label: "Plantillas", icon: ImageIcon },
    { id: "orders", label: "Pedidos", icon: ShoppingBag },
    { id: "payments", label: "Pagos", icon: CreditCard },
    { id: "diagnostics", label: "Diagnóstico", icon: Activity },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Panel administrador</h1>
        <div className="flex items-center gap-2">
          <AdminNotificationBell />
          <button onClick={() => supabase.auth.signOut()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-destructive/50 hover:text-destructive">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.id ? "border-neon-blue text-neon-blue" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardView />}
      {tab === "cms" && <CmsView />}
      {tab === "import" && <TemplateImporter />}
      {tab === "brands" && <BrandsView />}
      {tab === "models" && <ModelsView />}
      {tab === "garments" && <GarmentsView />}
      {tab === "templates" && <TemplatesView />}
      {tab === "orders" && <OrdersTabRedirect />}
      {tab === "payments" && <PaymentGatewaysView />}
      {tab === "diagnostics" && <DiagnosticsView />}
    </section>
  );
}

function OrdersTabRedirect() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center">
      <ShoppingBag className="mx-auto mb-3 h-8 w-8 text-neon-blue" />
      <h2 className="font-display text-lg font-semibold">Gestión de pedidos</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        La administración de pedidos, autorizaciones y descargas con URLs firmadas se
        gestiona en su propia pantalla dedicada.
      </p>
      <Link
        to="/admin/orders"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background"
      >
        Ir a Pedidos →
      </Link>
    </div>
  );
}


// ============ DASHBOARD ============
function DashboardView() {
  const [stats, setStats] = useState({ brands: 0, models: 0, templates: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const [b, m, t, o] = await Promise.all([
        supabase.from("brands").select("*", { count: "exact", head: true }),
        supabase.from("phone_models").select("*", { count: "exact", head: true }),
        supabase.from("templates").select("*", { count: "exact", head: true }),
        supabase.from("custom_orders").select("*", { count: "exact", head: true }).eq("payment_status", "pending"),
      ]);
      setStats({ brands: b.count ?? 0, models: m.count ?? 0, templates: t.count ?? 0, pending: o.count ?? 0 });
      setLoading(false);
    })();
  }, []);
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Marcas" value={stats.brands} />
        <Stat label="Modelos" value={stats.models} />
        <Stat label="Plantillas" value={stats.templates} />
        <Stat label="Pedidos pendientes" value={stats.pending} accent />
      </div>
    </div>
  );
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 font-mono text-4xl font-bold ${accent ? "text-neon-green" : ""}`}>{value}</div>
    </div>
  );
}

// ============ BRANDS ============
type Brand = { id: string; name: string; slug: string; logo_url: string | null; sort_order: number; is_active: boolean };
function BrandsView() {
  const [rows, setRows] = useState<Brand[]>([]);
  const [editing, setEditing] = useState<Partial<Brand> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("brands").select("*").order("sort_order");
    if (error) toast.error(error.message); else setRows(data as Brand[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    const payload = { name: editing.name!, slug: editing.slug!, logo_url: editing.logo_url ?? null, sort_order: editing.sort_order ?? 0, is_active: editing.is_active ?? true };
    const q = editing.id
      ? supabase.from("brands").update(payload).eq("id", editing.id)
      : supabase.from("brands").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Guardado"); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar marca?")) return;
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Eliminada"); load();
  };

  return (
    <CrudLayout
      title="Marcas"
      onCreate={() => setEditing({ name: "", slug: "", sort_order: 0, is_active: true })}
      loading={loading}
    >
      <Table headers={["Nombre", "Slug", "Orden", "Activa", ""]}>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border">
            <td className="p-3">{r.name}</td>
            <td className="p-3 font-mono text-xs text-muted-foreground">{r.slug}</td>
            <td className="p-3">{r.sort_order}</td>
            <td className="p-3">{r.is_active ? "✓" : "—"}</td>
            <td className="p-3 text-right"><RowActions onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} /></td>
          </tr>
        ))}
      </Table>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Editar marca" : "Nueva marca"} onSave={save}>
          <Input label="Nombre" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v, slug: editing.slug || v.toLowerCase().replace(/\s+/g, "-") })} />
          <Input label="Slug" value={editing.slug ?? ""} onChange={(v) => setEditing({ ...editing, slug: v })} />
          <Input label="Orden" type="number" value={String(editing.sort_order ?? 0)} onChange={(v) => setEditing({ ...editing, sort_order: Number(v) })} />
          <Checkbox label="Activa" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />
        </Modal>
      )}
    </CrudLayout>
  );
}

// ============ MODELS ============

type PhoneModel = {
  id: string; brand_id: string; name: string; slug: string;
  mockup_url: string | null; mask_url: string | null; preview_url: string | null;
  overlay_url: string | null; holes_url: string | null;
  source_psd_url: string | null; mold_status: "pendiente_conversion" | "listo" | "error_conversion";
  print_area: PhoneModelPrintArea | null;
  width_mm: number | null; height_mm: number | null; is_active: boolean; sort_order: number;
};
function ModelsView() {
  const [rows, setRows] = useState<(PhoneModel & { brand_name?: string })[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [editing, setEditing] = useState<Partial<PhoneModel> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: b }] = await Promise.all([
      supabase.from("phone_models").select("*, brands(name)").order("sort_order"),
      supabase.from("brands").select("*").order("name"),
    ]);
    setRows((m ?? []).map((x: any) => ({ ...x, brand_name: x.brands?.name })));
    setBrands((b ?? []) as Brand[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.brand_id || !editing?.name) return toast.error("Marca y nombre requeridos");
    const safePrintArea = getSafePhonePrintArea(editing.print_area);
    const payload: any = {
      brand_id: editing.brand_id, name: editing.name,
      slug: editing.slug || editing.name.toLowerCase().replace(/\s+/g, "-"),
      mockup_url: editing.mockup_url ?? null, mask_url: editing.mask_url ?? null, preview_url: editing.preview_url ?? null,
      overlay_url: editing.overlay_url ?? null, holes_url: editing.holes_url ?? null,
      source_psd_url: editing.source_psd_url ?? null,
      mold_status: editing.mold_status ?? "pendiente_conversion",
      print_area: safePrintArea,
      width_mm: editing.width_mm ?? null, height_mm: editing.height_mm ?? null,
      is_active: editing.is_active ?? true, sort_order: editing.sort_order ?? 0,
    };
    const q = editing.id
      ? supabase.from("phone_models").update(payload).eq("id", editing.id)
      : supabase.from("phone_models").insert(payload);
    const { data, error } = await q
      .select("id, print_area, mold_status, mockup_url, preview_url, overlay_url, holes_url")
      .single();
    if (error) return toast.error(error.message);
    if (!data?.id) return toast.error("La operación no devolvió una fila");
    if (!isValidPhonePrintArea(data.print_area)) {
      return toast.error("Área de impresión guardada no es válida");
    }
    toast.success("Guardado"); setEditing(null); load();
  };

  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState({ done: 0, total: 0 });

  const uploadPng = async (bucket: string, key: string, blob: Blob) => {
    const u = await supabase.storage.from(bucket).upload(key, blob, { upsert: true, contentType: "image/png" });
    if (u.error) throw u.error;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(key, 60 * 60 * 24 * 365);
    return data?.signedUrl ?? null;
  };

  const processOne = async (r: PhoneModel) => {
    if (!r.source_psd_url) throw new Error("Modelo sin PSD original");
    const res = await fetch(r.source_psd_url);
    if (!res.ok) throw new Error(`Descarga falló (${res.status})`);
    const buf = await res.arrayBuffer();
    const art = await processPsd(buf);
    const base = `${r.brand_id}/${r.id}/${Date.now()}`;
    const safePrintArea = getSafePhonePrintArea(r.print_area);
    const [overlay_url, holes_url, mockup_url, preview_url] = await Promise.all([
      uploadPng("phone-mockups", `${base}-overlay.png`, art.overlay),
      uploadPng("phone-masks",   `${base}-holes.png`,   art.holes),
      uploadPng("phone-mockups", `${base}-mockup.png`,  art.mockup),
      uploadPng("phone-previews",`${base}-preview.png`, art.preview),
    ]);
    const { data, error } = await supabase.from("phone_models").update({
      overlay_url, holes_url, mockup_url, preview_url,
      mold_status: "listo",
      print_area: safePrintArea,
    } as any).eq("id", r.id)
      .select("id, print_area, mold_status, overlay_url, holes_url, mockup_url, preview_url")
      .single();
    if (error) throw error;
    if (!data?.id) throw new Error("Update no devolvió la fila esperada");
    if (data.mold_status !== "listo") throw new Error("mold_status no quedó en 'listo'");
    if (!data.overlay_url || !data.holes_url || !data.mockup_url || !data.preview_url) {
      throw new Error("Assets faltantes tras el procesamiento");
    }
    if (!isValidPhonePrintArea(data.print_area)) {
      throw new Error("print_area guardado no es válido");
    }
  };

  const processPending = async () => {
    const targets = rows.filter((r) => r.source_psd_url && r.mold_status !== "listo");
    if (!targets.length) return toast.info("No hay PSDs pendientes");
    if (!confirm(`Procesar ${targets.length} PSD(s)?`)) return;
    setProcessing(true);
    setProcessProgress({ done: 0, total: targets.length });
    let ok = 0, ko = 0;
    for (const r of targets) {
      try {
        await processOne(r);
        ok++;
      } catch (e: any) {
        await supabase.from("phone_models").update({
          mold_status: "error_conversion",
          print_area: getSafePhonePrintArea(r.print_area),
        } as any).eq("id", r.id);
        ko++;
        console.error("PSD proc", r.slug, e);
      } finally {
        setProcessProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
    }
    setProcessing(false);
    if (ko === 0) toast.success(`Procesados: ${ok}`);
    else if (ok > 0) toast.warning(`Procesados: ${ok} · Errores: ${ko}`);
    else toast.error(`Procesamiento fallido · Errores: ${ko}`);
    load();
  };

  const regenerateOne = async (r: PhoneModel) => {
    if (!r.source_psd_url) return toast.error("Este modelo no tiene PSD original");
    const t = toast.loading(`Regenerando overlay de ${r.name}…`);
    try {
      await processOne(r);
      toast.success("Overlay transparente regenerado", { id: t });
      load();
    } catch (e: any) {
      await supabase.from("phone_models").update({
        mold_status: "error_conversion",
        print_area: getSafePhonePrintArea(r.print_area),
      } as any).eq("id", r.id);
      toast.error(`Error: ${e.message ?? e}`, { id: t });
      load();
    }
  };

  const stripWhiteOverlay = async (r: PhoneModel) => {
    const src = r.overlay_url || r.mockup_url;
    if (!src) return toast.error("Este modelo no tiene overlay/mockup");
    const t = toast.loading(`Eliminando fondo blanco de ${r.name}…`);
    try {
      const blob = await removeWhiteBackground(src);
      const key = `${r.brand_id}/${r.id}/${Date.now()}-overlay-nowhite.png`;
      const url = await uploadPng("phone-mockups", key, blob);
      const { data, error } = await supabase.from("phone_models").update({
        overlay_url: url, mockup_url: url, mold_status: "listo",
        print_area: getSafePhonePrintArea(r.print_area),
      } as any).eq("id", r.id)
        .select("id, print_area, mold_status, overlay_url, mockup_url")
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error("Update no devolvió la fila esperada");
      if (!data.overlay_url || !data.mockup_url) throw new Error("overlay/mockup faltantes");
      if (!isValidPhonePrintArea(data.print_area)) throw new Error("print_area no válido");
      toast.success("Fondo blanco eliminado", { id: t });
      load();
    } catch (e: any) {
      toast.error(`Error: ${e.message ?? e}`, { id: t });
    }
  };



  const remove = async (id: string) => {
    if (!confirm("¿Eliminar modelo?")) return;
    const { error } = await supabase.from("phone_models").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const pa: PhoneModelPrintArea = getSafePhonePrintArea(editing?.print_area);

  const pendingPsdCount = rows.filter((r) => r.source_psd_url && r.mold_status !== "listo").length;

  return (
    <CrudLayout title="Modelos de teléfono" onCreate={() => setEditing({ is_active: true, sort_order: 0, mold_status: "pendiente_conversion", print_area: getDefaultPhonePrintArea() })} loading={loading}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={processPending}
          disabled={processing || pendingPsdCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40"
        >
          {processing ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
          Procesar PSD pendientes {pendingPsdCount > 0 && `(${pendingPsdCount})`}
        </button>
        {processing && (
          <span className="text-xs text-muted-foreground">{processProgress.done} / {processProgress.total}</span>
        )}
      </div>
      <Table headers={["Mockup", "Marca", "Modelo", "PSD", "Estado", "Zona", "Activo", ""]}>
        {rows.map((r) => {
          const thumb = r.mockup_url || r.preview_url;
          const ready = r.mold_status === "listo" && !!thumb;
          const errored = r.mold_status === "error_conversion";
          return (
          <tr key={r.id} className="border-t border-border">
            <td className="p-3">
              {thumb ? (
                <img src={thumb} alt={r.name} className="h-12 w-12 rounded border border-border bg-secondary object-contain" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded border border-dashed border-border text-[10px] text-muted-foreground">sin img</div>
              )}
            </td>
            <td className="p-3">{r.brand_name}</td>
            <td className="p-3">{r.name}</td>
            <td className="p-3">{r.source_psd_url ? "✓" : "—"}</td>
            <td className="p-3">
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                ready ? "bg-neon-green/10 text-neon-green"
                : errored ? "bg-destructive/10 text-destructive"
                : "bg-yellow-500/10 text-yellow-400"
              }`}>
                {ready ? "Listo" : errored ? "error" : "pendiente"}
              </span>
            </td>
            <td className="p-3">{r.print_area ? "✓" : "—"}</td>
            <td className="p-3">{r.is_active ? "✓" : "—"}</td>
            <td className="p-3 text-right">
              <div className="inline-flex flex-wrap items-center justify-end gap-1">
                {ready && (
                  <a href={`/personalizador?pack=carcasa%2Bpolera&brand=${r.brand_id}&model=${r.id}`} target="_blank" rel="noreferrer"
                    className="rounded border border-border px-2 py-1 text-[11px] hover:border-neon-green hover:text-neon-green">
                    Probar
                  </a>
                )}
                {(r.overlay_url || r.mockup_url) && (
                  <button onClick={() => stripWhiteOverlay(r)}
                    className="rounded border border-border px-2 py-1 text-[11px] hover:border-neon-blue hover:text-neon-blue">
                    Sin fondo blanco
                  </button>
                )}
                {r.source_psd_url && (
                  <button onClick={() => regenerateOne(r)}
                    className="rounded border border-border px-2 py-1 text-[11px] hover:border-neon-blue hover:text-neon-blue">
                    Regenerar
                  </button>
                )}
                <RowActions onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} />
              </div>
            </td>

          </tr>
          );
        })}
      </Table>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Editar modelo" : "Nuevo modelo"} onSave={save}>
          <Select label="Marca" value={editing.brand_id ?? ""} onChange={(v) => setEditing({ ...editing, brand_id: v })} options={brands.map((b) => ({ value: b.id, label: b.name }))} />
          <Input label="Nombre" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
          <Input label="Slug" value={editing.slug ?? ""} onChange={(v) => setEditing({ ...editing, slug: v })} />

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Molde</div>
            <FileUpload label="Versión web del molde (PNG/JPG/WEBP)" bucket="phone-mockups" value={editing.mockup_url ?? ""} onChange={(v) => setEditing({ ...editing, mockup_url: v, overlay_url: editing.overlay_url || v, preview_url: editing.preview_url || v, mold_status: v ? "listo" : (editing.mold_status ?? "pendiente_conversion") })} />
            <FileUpload label="Máscara" bucket="phone-masks" value={editing.mask_url ?? ""} onChange={(v) => setEditing({ ...editing, mask_url: v })} />
            <FileUpload label="Preview" bucket="phone-previews" value={editing.preview_url ?? ""} onChange={(v) => setEditing({ ...editing, preview_url: v })} />
            <FileUpload label="PSD original" bucket="source-psd-files" value={editing.source_psd_url ?? ""} onChange={(v) => setEditing({ ...editing, source_psd_url: v })} />
            <Select label="Estado molde" value={editing.mold_status ?? "pendiente_conversion"} onChange={(v) => setEditing({ ...editing, mold_status: v as any })}
              options={[{ value: "pendiente_conversion", label: "Pendiente de conversión web" }, { value: "listo", label: "Listo" }, { value: "error_conversion", label: "Error de conversión" }]} />

            {/* Validador visual: overlay sobre fondo cuadriculado */}
            {(editing.overlay_url || editing.mockup_url) && (
              <div className="mt-3">
                <div className="mb-1 text-xs text-muted-foreground">Vista de transparencia (fondo cuadriculado)</div>
                <div
                  className="grid h-40 place-items-center rounded border border-border"
                  style={{
                    backgroundImage:
                      "linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                    backgroundColor: "#111",
                  }}
                >
                  <img
                    src={(editing.overlay_url || editing.mockup_url) as string}
                    alt="overlay"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Si el centro se ve blanco, el overlay es opaco. Usa los botones de abajo para corregirlo.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {editing.id && (editing.overlay_url || editing.mockup_url) && (
                    <button
                      type="button"
                      onClick={() => stripWhiteOverlay(editing as PhoneModel)}
                      className="rounded border border-border px-2 py-1 text-[11px] hover:border-neon-blue hover:text-neon-blue"
                    >
                      Eliminar fondo blanco del overlay
                    </button>
                  )}
                  {editing.id && editing.source_psd_url && (
                    <button
                      type="button"
                      onClick={() => regenerateOne(editing as PhoneModel)}
                      className="rounded border border-border px-2 py-1 text-[11px] hover:border-neon-blue hover:text-neon-blue"
                    >
                      Regenerar overlay transparente
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Zona imprimible (% del mockup)</div>
            <div className="grid grid-cols-2 gap-2">
              <Input label="X %" type="number" value={String(pa.x)} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, x: Number(v) } })} />
              <Input label="Y %" type="number" value={String(pa.y)} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, y: Number(v) } })} />
              <Input label="Ancho %" type="number" value={String(pa.width)} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, width: Number(v) } })} />
              <Input label="Alto %" type="number" value={String(pa.height)} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, height: Number(v) } })} />
              <Input label="Radio %" type="number" value={String(pa.radius)} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, radius: Number(v) } })} />
            </div>

            <div className="mt-3 text-xs text-muted-foreground">Cámara (opcional, % del mockup)</div>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Cam X %" type="number" value={String(pa.camera?.x ?? "")} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, camera: { ...(pa.camera ?? { x: 0, y: 0, width: 0, height: 0 }), x: Number(v) } } })} />
              <Input label="Cam Y %" type="number" value={String(pa.camera?.y ?? "")} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, camera: { ...(pa.camera ?? { x: 0, y: 0, width: 0, height: 0 }), y: Number(v) } } })} />
              <Input label="Cam W %" type="number" value={String(pa.camera?.width ?? "")} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, camera: { ...(pa.camera ?? { x: 0, y: 0, width: 0, height: 0 }), width: Number(v) } } })} />
              <Input label="Cam H %" type="number" value={String(pa.camera?.height ?? "")} onChange={(v) => setEditing({ ...editing, print_area: { ...pa, camera: { ...(pa.camera ?? { x: 0, y: 0, width: 0, height: 0 }), height: Number(v) } } })} />
            </div>
          </div>

          <Input label="Orden" type="number" value={String(editing.sort_order ?? 0)} onChange={(v) => setEditing({ ...editing, sort_order: Number(v) })} />
          <Checkbox label="Activo" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />
        </Modal>
      )}
    </CrudLayout>
  );
}


// ============ GARMENTS ============
type Garment = {
  id: string;
  type: GarmentType;
  name: string;
  slug: string | null;
  color: string;
  view: GarmentView;
  sizes: string[];
  base_url: string | null;
  overlay_url: string | null;
  mockup_url: string | null;
  preview_url: string | null;
  source_psd_url: string | null;
  source_width: number | null;
  source_height: number | null;
  print_area: GarmentPrintArea | null;
  mold_status: "pendiente_conversion" | "listo" | "error_conversion";
  processing_error: string | null;
  price: number;
  is_active: boolean;
  sort_order: number;
};

function GarmentsView() {
  const [rows, setRows] = useState<Garment[]>([]);
  const [editing, setEditing] = useState<Partial<Garment> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("garments").select("*").order("sort_order");
    if (error) toast.error(error.message);
    else setRows((data ?? []) as unknown as Garment[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.name || !editing?.type) return toast.error("Tipo y nombre requeridos");
    const type = editing.type as GarmentType;
    const view = (editing.view ?? "front") as GarmentView;
    const rawArea = editing.print_area as GarmentPrintArea | null | undefined;
    const printArea = isValidGarmentPrintArea(rawArea) ? rawArea : getDefaultGarmentPrintArea(type);

    if (editing.is_active) {
      if (editing.mold_status !== "listo") return toast.error("Solo prendas 'listo' se pueden activar");
      if (!editing.mockup_url) return toast.error("Falta mockup_url para activar");
      if (!isValidGarmentPrintArea(rawArea)) return toast.error("print_area no es válido");
    }

    const payload: Record<string, unknown> = {
      type,
      name: editing.name,
      color: editing.color ?? "",
      view,
      sizes: editing.sizes ?? ["S", "M", "L", "XL"],
      base_url: editing.base_url ?? null,
      overlay_url: editing.overlay_url ?? null,
      mockup_url: editing.mockup_url ?? null,
      preview_url: editing.preview_url ?? null,
      print_area: printArea,
      price: editing.price ?? 0,
      is_active: editing.is_active ?? false,
      sort_order: editing.sort_order ?? 0,
    };
    if (!editing.id) {
      payload.slug = editing.slug ?? null;
      payload.mold_status = editing.mold_status ?? "pendiente_conversion";
    }
    const q = editing.id
      ? supabase.from("garments").update(payload as never).eq("id", editing.id)
      : supabase.from("garments").insert(payload as never);
    const { data, error } = await q.select("id, mold_status, mockup_url, print_area").single();
    if (error) return toast.error(error.message);
    if (!data?.id) return toast.error("No se recibió respuesta de la base");
    toast.success("Guardado"); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar prenda?")) return;
    const { error } = await supabase.from("garments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="space-y-6">
      <GarmentTemplateImporter />
      <CrudLayout
        title="Prendas"
        onCreate={() =>
          setEditing({
            type: "polera",
            view: "front",
            color: "",
            sizes: ["S", "M", "L", "XL"],
            is_active: false,
            mold_status: "pendiente_conversion",
            print_area: getDefaultGarmentPrintArea("polera"),
          })
        }
        loading={loading}
      >
        <Table headers={["Tipo", "Nombre", "Color", "Vista", "Estado", "Área", "Base", "Overlay", "Mockup", "Activo", ""]}>
          {rows.map((r) => {
            const areaOk = isValidGarmentPrintArea(r.print_area);
            return (
              <tr key={r.id} className="border-t border-border">
                <td className="p-3 capitalize">{r.type}</td>
                <td className="p-3">{r.name}</td>
                <td className="p-3">{r.color}</td>
                <td className="p-3 capitalize">{r.view}</td>
                <td className="p-3 text-xs">
                  {r.mold_status === "listo" && <span className="text-neon-green">listo</span>}
                  {r.mold_status === "pendiente_conversion" && <span className="text-amber-400">pendiente</span>}
                  {r.mold_status === "error_conversion" && <span className="text-destructive" title={r.processing_error ?? ""}>error</span>}
                </td>
                <td className="p-3">{areaOk ? "✓" : "—"}</td>
                <td className="p-3">{r.base_url ? "✓" : "—"}</td>
                <td className="p-3">{r.overlay_url ? "✓" : r.mockup_url ? <span className="text-xs text-muted-foreground" title="Sin overlay independiente">—</span> : "—"}</td>
                <td className="p-3">{r.mockup_url ? "✓" : "—"}</td>
                <td className="p-3">{r.is_active ? "✓" : "—"}</td>
                <td className="p-3 text-right"><RowActions onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} /></td>
              </tr>
            );
          })}
        </Table>

        {editing && (
          <Modal onClose={() => setEditing(null)} title={editing.id ? "Editar prenda" : "Nueva prenda"} onSave={save}>
            <Select
              label="Tipo"
              value={editing.type ?? "polera"}
              onChange={(v) => {
                const t = v as GarmentType;
                const currentArea = editing.print_area as GarmentPrintArea | null | undefined;
                setEditing({
                  ...editing,
                  type: t,
                  print_area: isValidGarmentPrintArea(currentArea) ? currentArea : getDefaultGarmentPrintArea(t),
                });
              }}
              options={[{ value: "polera", label: "Polera" }, { value: "poleron", label: "Polerón" }]}
            />
            <Input label="Nombre" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <div className="text-xs text-muted-foreground">
              <span className="font-mono">Slug:</span> {editing.slug ?? <em>se generará al importar</em>}
            </div>
            <Input label="Color" value={editing.color ?? ""} onChange={(v) => setEditing({ ...editing, color: v })} />
            <Select
              label="Vista"
              value={editing.view ?? "front"}
              onChange={(v) => setEditing({ ...editing, view: v as GarmentView })}
              options={[{ value: "front", label: "Frente" }, { value: "back", label: "Espalda" }]}
            />
            <Input label="Tallas (separadas por coma)" value={(editing.sizes ?? []).join(",")} onChange={(v) => setEditing({ ...editing, sizes: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <Input label="Precio CLP" type="number" value={String(editing.price ?? 0)} onChange={(v) => setEditing({ ...editing, price: Number(v) })} />
            <FileUpload label="Base" bucket="garment-mockups" value={editing.base_url ?? ""} onChange={(v) => setEditing({ ...editing, base_url: v })} />
            <FileUpload label="Overlay" bucket="garment-mockups" value={editing.overlay_url ?? ""} onChange={(v) => setEditing({ ...editing, overlay_url: v })} />
            <FileUpload label="Mockup" bucket="garment-mockups" value={editing.mockup_url ?? ""} onChange={(v) => setEditing({ ...editing, mockup_url: v })} />
            <FileUpload label="Preview" bucket="garment-previews" value={editing.preview_url ?? ""} onChange={(v) => setEditing({ ...editing, preview_url: v })} />

            {(() => {
              const pa = (editing.print_area ?? getDefaultGarmentPrintArea((editing.type ?? "polera") as GarmentType)) as GarmentPrintArea;
              const update = (patch: Partial<GarmentPrintArea>) =>
                setEditing({ ...editing, print_area: { ...pa, ...patch } });
              return (
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Área de impresión (%)</div>
                  <div className="grid grid-cols-5 gap-2">
                    <Input label="X" type="number" value={String(pa.x)} onChange={(v) => update({ x: Number(v) })} />
                    <Input label="Y" type="number" value={String(pa.y)} onChange={(v) => update({ y: Number(v) })} />
                    <Input label="Ancho" type="number" value={String(pa.width)} onChange={(v) => update({ width: Number(v) })} />
                    <Input label="Alto" type="number" value={String(pa.height)} onChange={(v) => update({ height: Number(v) })} />
                    <Input label="Radio" type="number" value={String(pa.radius)} onChange={(v) => update({ radius: Number(v) })} />
                  </div>
                  {editing.mockup_url && (
                    <div className="relative mt-2 overflow-hidden rounded-md border border-border bg-black/20">
                      <img src={editing.mockup_url} alt="mockup" className="block w-full" />
                      <div
                        className="absolute border-2 border-neon-blue/80 bg-neon-blue/20"
                        style={{
                          left: `${pa.x}%`, top: `${pa.y}%`,
                          width: `${pa.width}%`, height: `${pa.height}%`,
                          borderRadius: `${pa.radius}%`,
                        }}
                      />
                      {editing.overlay_url && (
                        <img src={editing.overlay_url} alt="overlay" className="pointer-events-none absolute inset-0 h-full w-full" />
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <Checkbox label="Activo (requiere estado listo, mockup y área válida)" checked={editing.is_active ?? false} onChange={(v) => setEditing({ ...editing, is_active: v })} />
          </Modal>
        )}
      </CrudLayout>
    </div>
  );
}


// ============ TEMPLATES ============
type TplCat = { id: string; name: string; slug: string; sort_order: number };
type Template = { id: string; category_id: string | null; name: string; preview_url: string | null; file_url: string | null; psd_url: string | null; tags: string[]; is_active: boolean; sort_order: number };
function TemplatesView() {
  const [cats, setCats] = useState<TplCat[]>([]);
  const [rows, setRows] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [editingCat, setEditingCat] = useState<Partial<TplCat> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: t }] = await Promise.all([
      supabase.from("template_categories").select("*").order("sort_order"),
      supabase.from("templates").select("*").order("sort_order"),
    ]);
    setCats((c ?? []) as TplCat[]);
    setRows((t ?? []) as Template[]);
    setSelected(new Set());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveCat = async () => {
    if (!editingCat?.name) return;
    const payload = { name: editingCat.name, slug: editingCat.slug || editingCat.name.toLowerCase().replace(/\s+/g, "-"), sort_order: editingCat.sort_order ?? 0 };
    const q = editingCat.id ? supabase.from("template_categories").update(payload).eq("id", editingCat.id) : supabase.from("template_categories").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    setEditingCat(null); load();
  };

  const save = async () => {
    if (!editing?.name) return toast.error("Nombre requerido");
    const payload = {
      category_id: editing.category_id ?? null, name: editing.name,
      preview_url: editing.preview_url ?? null, file_url: editing.file_url ?? null, psd_url: editing.psd_url ?? null,
      tags: editing.tags ?? [], is_active: editing.is_active ?? true, sort_order: editing.sort_order ?? 0,
    };
    const q = editing.id ? supabase.from("templates").update(payload).eq("id", editing.id) : supabase.from("templates").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar plantilla?")) return;
    await supabase.from("templates").delete().eq("id", id);
    load();
  };
  const removeCat = async (id: string) => {
    if (!confirm("¿Eliminar categoría?")) return;
    await supabase.from("template_categories").delete().eq("id", id);
    load();
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  };
  const removeSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`¿Eliminar ${selected.size} plantilla(s)?`)) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("templates").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} plantilla(s) eliminada(s)`);
    load();
  };
  const removeAll = async () => {
    if (rows.length === 0) return;
    if (!confirm(`¿Eliminar TODAS las ${rows.length} plantillas? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("templates").delete().not("id", "is", null);
    if (error) return toast.error(error.message);
    toast.success("Todas las plantillas fueron eliminadas");
    load();
  };

  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="space-y-8">
      <CrudLayout title="Categorías de plantillas" onCreate={() => setEditingCat({ sort_order: 0 })} loading={loading}>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <div key={c.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
              {c.name}
              <button onClick={() => setEditingCat(c)} className="text-muted-foreground hover:text-neon-blue"><Edit2 className="h-3 w-3" /></button>
              <button onClick={() => removeCat(c.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      </CrudLayout>

      <CrudLayout title="Plantillas" onCreate={() => setEditing({ is_active: true, tags: [] })} loading={loading}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            Seleccionar todas ({selected.size}/{rows.length})
          </label>
          <button
            type="button"
            onClick={removeSelected}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" /> Eliminar seleccionadas
          </button>
          <button
            type="button"
            onClick={removeAll}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-destructive bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" /> Borrar todo
          </button>
        </div>
        <Table headers={["", "Nombre", "Categoría", "Preview", "Archivo", "PSD", ""]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-3"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
              <td className="p-3">{r.name}</td>
              <td className="p-3 text-xs text-muted-foreground">{cats.find((c) => c.id === r.category_id)?.name ?? "—"}</td>
              <td className="p-3">{r.preview_url ? "✓" : "—"}</td>
              <td className="p-3">{r.file_url ? "✓" : "—"}</td>
              <td className="p-3">{r.psd_url ? "✓" : "—"}</td>
              <td className="p-3 text-right"><RowActions onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} /></td>
            </tr>
          ))}
        </Table>
      </CrudLayout>


      {editingCat && (
        <Modal onClose={() => setEditingCat(null)} title={editingCat.id ? "Editar categoría" : "Nueva categoría"} onSave={saveCat}>
          <Input label="Nombre" value={editingCat.name ?? ""} onChange={(v) => setEditingCat({ ...editingCat, name: v })} />
          <Input label="Slug" value={editingCat.slug ?? ""} onChange={(v) => setEditingCat({ ...editingCat, slug: v })} />
          <Input label="Orden" type="number" value={String(editingCat.sort_order ?? 0)} onChange={(v) => setEditingCat({ ...editingCat, sort_order: Number(v) })} />
        </Modal>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Editar plantilla" : "Nueva plantilla"} onSave={save}>
          <Input label="Nombre" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
          <Select label="Categoría" value={editing.category_id ?? ""} onChange={(v) => setEditing({ ...editing, category_id: v || null })} options={[{ value: "", label: "— sin categoría —" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
          <Input label="Tags (separados por coma)" value={(editing.tags ?? []).join(",")} onChange={(v) => setEditing({ ...editing, tags: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
          <FileUpload label="Preview" bucket="template-previews" value={editing.preview_url ?? ""} onChange={(v) => setEditing({ ...editing, preview_url: v })} />
          <FileUpload label="Archivo" bucket="template-files" value={editing.file_url ?? ""} onChange={(v) => setEditing({ ...editing, file_url: v })} />
          <FileUpload label="Archivo fuente PSD" bucket="source-psd-files" value={editing.psd_url ?? ""} onChange={(v) => setEditing({ ...editing, psd_url: v })} />
          <Checkbox label="Activa" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />
        </Modal>
      )}
    </div>
  );
}

// ============ ORDERS ============
type Order = {
  id: string; order_number: string | null; customer_email: string; customer_name: string | null;
  customer_phone: string | null; pack_type: string; total_amount: number;
  payment_status: string; fulfillment_status: string; mp_payment_id: string | null;
  shipping_address: any; status: string; created_at: string;
};
type OrderDetail = Order & { final_designs: any[]; design_assets: any[] };

const FULFILLMENT_OPTIONS = ["new", "in_production", "ready", "shipped", "completed", "cancelled"] as const;
const PAYMENT_OPTIONS = ["", "pending", "approved", "rejected", "cancelled", "refunded", "charged_back"] as const;

function OrdersView() {
  const [rows, setRows] = useState<Order[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [qNumber, setQNumber] = useState("");
  const [qEmail, setQEmail] = useState("");
  const [qPay, setQPay] = useState<string>("");
  const [qFul, setQFul] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("custom_orders")
      .select("id,order_number,customer_email,customer_name,customer_phone,pack_type,total_amount,payment_status,fulfillment_status,mp_payment_id,shipping_address,status,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (qNumber.trim()) query = query.ilike("order_number", `%${qNumber.trim()}%`);
    if (qEmail.trim()) query = query.ilike("customer_email", `%${qEmail.trim()}%`);
    if (qPay) query = query.eq("payment_status", qPay);
    if (qFul) query = query.eq("fulfillment_status", qFul);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Order[]);
    setLoading(false);
  }, [qNumber, qEmail, qPay, qFul]);
  useEffect(() => { load(); }, [load]);

  const openOrder = async (o: Order) => {
    const [{ data: fd }, { data: da }] = await Promise.all([
      supabase.from("final_designs").select("*").eq("order_id", o.id),
      supabase.from("design_assets").select("*").eq("order_id", o.id),
    ]);
    setSelected({ ...o, final_designs: fd ?? [], design_assets: da ?? [] });
  };

  const setFulfillment = async (id: string, fulfillment_status: string) => {
    const { error } = await supabase.from("custom_orders")
      .update({ fulfillment_status } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Estado de producción actualizado"); load();
    if (selected?.id === id) setSelected({ ...selected, fulfillment_status });
  };

  const payColor = (s: string) =>
    s === "approved" ? "text-neon-green" :
    s === "pending" ? "text-yellow-400" :
    s === "rejected" || s === "charged_back" ? "text-destructive" :
    "text-muted-foreground";

  const fulColor = (s: string) =>
    s === "completed" ? "text-neon-green" :
    s === "in_production" || s === "ready" || s === "shipped" ? "text-neon-blue" :
    s === "cancelled" ? "text-destructive" :
    "text-muted-foreground";

  return (
    <div>
      <h2 className="mb-4 font-display text-lg font-semibold">Pedidos personalizados</h2>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input value={qNumber} onChange={(e) => setQNumber(e.target.value)} placeholder="Número de pedido…"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={qEmail} onChange={(e) => setQEmail(e.target.value)} placeholder="Email…"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <select value={qPay} onChange={(e) => setQPay(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          {PAYMENT_OPTIONS.map((o) => (
            <option key={o} value={o}>{o ? `Pago: ${o}` : "Pago: todos"}</option>
          ))}
        </select>
        <select value={qFul} onChange={(e) => setQFul(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="">Producción: todos</option>
          {FULFILLMENT_OPTIONS.map((o) => <option key={o} value={o}>Producción: {o}</option>)}
        </select>
      </div>

      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
        <Table headers={["Fecha", "Pedido", "Cliente", "Pack", "Total", "Pago", "Producción", "MP", ""]}>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("es-CL")}</td>
              <td className="p-3 font-mono text-xs">{r.order_number ?? "—"}</td>
              <td className="p-3">
                <div>{r.customer_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                {r.customer_phone && <div className="text-xs text-muted-foreground">{r.customer_phone}</div>}
              </td>
              <td className="p-3 text-xs">{r.pack_type}</td>
              <td className="p-3 font-mono">${r.total_amount.toLocaleString("es-CL")}</td>
              <td className={`p-3 text-xs font-medium ${payColor(r.payment_status)}`}>{r.payment_status}</td>
              <td className={`p-3 text-xs font-medium ${fulColor(r.fulfillment_status)}`}>{r.fulfillment_status}</td>
              <td className="p-3 font-mono text-[10px] text-muted-foreground">{r.mp_payment_id ?? "—"}</td>
              <td className="p-3 text-right">
                <button onClick={() => openOrder(r)} className="rounded border border-border px-3 py-1 text-xs hover:border-neon-blue">Ver</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="p-10 text-center text-xs text-muted-foreground">Sin resultados</td></tr>
          )}
        </Table>
      )}

      {selected && (
        <Modal onClose={() => setSelected(null)} title={`${selected.order_number ?? selected.id.slice(0,8)} · ${selected.customer_email}`}>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
              El estado de <b>pago</b> solo puede cambiarse desde la pasarela. Aquí solo se ajusta el estado de <b>producción</b>.
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Estado de producción</div>
              <div className="flex flex-wrap gap-2">
                {FULFILLMENT_OPTIONS.map((s) => (
                  <button key={s} onClick={() => setFulfillment(selected.id, s)}
                    className={`rounded-full border px-3 py-1 text-xs ${selected.fulfillment_status === s ? "border-neon-blue bg-neon-blue/10 text-neon-blue" : "border-border text-muted-foreground"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div><span className="text-muted-foreground">Pago:</span> <b className={payColor(selected.payment_status)}>{selected.payment_status}</b></div>
              <div><span className="text-muted-foreground">MP payment ID:</span> <span className="font-mono">{selected.mp_payment_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Total:</span> <b>${selected.total_amount.toLocaleString("es-CL")}</b></div>
              <div><span className="text-muted-foreground">Teléfono:</span> {selected.customer_phone ?? "—"}</div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Dirección:</span>{" "}
                {selected.shipping_address?.address ?? "—"}, {selected.shipping_address?.comuna ?? ""} {selected.shipping_address?.region ?? ""}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Imágenes subidas</div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {selected.design_assets.map((a: any) => (
                  <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded border border-border">
                    <img src={a.file_url} alt="asset" className="h-full w-full object-cover" />
                  </a>
                ))}
                {selected.design_assets.length === 0 && <div className="text-xs text-muted-foreground">Sin adjuntos</div>}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Diseños finales</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {selected.final_designs.map((f: any) => (
                  <div key={f.id} className="rounded border border-border p-2 text-xs">
                    <div>Talla: <b>{f.garment_size ?? "—"}</b></div>
                    {f.case_preview_url && <a className="mt-2 block" href={f.case_preview_url} target="_blank" rel="noreferrer"><img src={f.case_preview_url} className="rounded" /></a>}
                    {f.garment_preview_url && <a className="mt-2 block" href={f.garment_preview_url} target="_blank" rel="noreferrer"><img src={f.garment_preview_url} className="rounded" /></a>}
                  </div>
                ))}
                {selected.final_designs.length === 0 && <div className="text-xs text-muted-foreground">Sin diseños finales aún</div>}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ REUSABLE UI ============
function CrudLayout({ title, onCreate, loading, children }: { title: string; onCreate?: () => void; loading?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {onCreate && (
          <button onClick={onCreate} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-3 py-2 text-xs font-semibold text-background">
            <Plus className="h-3 w-3" /> Nuevo
          </button>
        )}
      </div>
      {loading ? <Loader2 className="h-6 w-6 animate-spin text-neon-blue" /> : children}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50">
          <tr>{headers.map((h) => <th key={h} className="p-3 text-left text-xs uppercase tracking-wider text-muted-foreground">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex gap-1">
      <button onClick={onEdit} className="grid h-8 w-8 place-items-center rounded border border-border hover:border-neon-blue hover:text-neon-blue"><Edit2 className="h-3 w-3" /></button>
      <button onClick={onDelete} className="grid h-8 w-8 place-items-center rounded border border-border hover:border-destructive hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
    </div>
  );
}

function Modal({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">{children}</div>
        {onSave && (
          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>
            <button onClick={onSave} className="rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background">Guardar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue" />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-neon-blue" />
      {label}
    </label>
  );
}

function FileUpload({ label, bucket, value, onChange }: { label: string; bucket: string; value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      onChange(signed?.signedUrl ?? path);
      toast.success("Archivo subido");
    } catch (err: any) {
      toast.error(err.message ?? "Error al subir");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs hover:border-neon-blue">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {value ? "Reemplazar" : "Subir archivo"}
          <input type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {value && <a href={value} target="_blank" rel="noreferrer" className="text-xs text-neon-blue hover:underline">Ver</a>}
      </div>
    </div>
  );
}
