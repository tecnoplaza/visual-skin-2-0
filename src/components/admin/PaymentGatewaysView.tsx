import { useCallback, useEffect, useState } from "react";
import {
  CreditCard, Loader2, Plus, ShieldCheck, ShieldAlert, Copy, Zap,
  Trash2, Edit2, X, CheckCircle2, XCircle, ExternalLink, KeyRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  getGatewaySecretsStatus,
  testGatewayConnection,
} from "@/lib/payment-gateways.functions";

type Gateway = {
  id: string;
  provider: string;
  display_name: string;
  mode: "sandbox" | "live";
  enabled: boolean;
  public_key: string | null;
  webhook_path: string | null;
  config: Record<string, unknown>;
  notes: string | null;
  updated_at: string;
};

type SecretStatus = Record<
  string,
  {
    access: boolean;
    publicKey: boolean | null;
    webhook: boolean | null;
    collector?: boolean | null;
    env?: "test" | "production" | null;
    names: { access: string; publicKey?: string; webhook?: string; collector?: string };
  }
>;

const MP_WEBHOOK_PATH = "/functions/v1/mercadopago-webhook?source_news=webhooks";

const KNOWN_PROVIDERS = [
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
  { value: "transbank", label: "Transbank Webpay" },
  { value: "flow", label: "Flow.cl" },
  { value: "khipu", label: "Khipu" },
  { value: "other", label: "Otro (personalizado)" },
];

export default function PaymentGatewaysView() {
  const [rows, setRows] = useState<Gateway[]>([]);
  const [secrets, setSecrets] = useState<SecretStatus>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Gateway> | null>(null);
  const [testingProv, setTestingProv] = useState<string | null>(null);

  const fetchStatus = useServerFn(getGatewaySecretsStatus);
  const runTest = useServerFn(testGatewayConnection);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, error }, statusRes] = await Promise.all([
        supabase.from("payment_gateways").select("*").order("provider"),
        fetchStatus().catch(() => ({ status: {} as SecretStatus })),
      ]);
      if (error) throw error;
      setRows((data ?? []) as Gateway[]);
      setSecrets(statusRes.status);
    } catch (e: any) {
      toast.error(e.message ?? "Error cargando pasarelas");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    if (!editing.provider || !editing.display_name) {
      return toast.error("Proveedor y nombre son obligatorios");
    }
    const provider = editing.provider.trim().toLowerCase();
    // Mercado Pago: forzar ruta canónica de la Edge Function. No permitir
    // guardar el endpoint TanStack antiguo (deprecado, responde 410).
    let webhookPath = editing.webhook_path?.trim() || null;
    if (provider === "mercadopago") {
      webhookPath = MP_WEBHOOK_PATH;
    }
    const payload = {
      provider,
      display_name: editing.display_name.trim(),
      mode: editing.mode ?? "sandbox",
      enabled: editing.enabled ?? false,
      public_key: editing.public_key?.trim() || null,
      webhook_path: webhookPath,
      config: (editing.config ?? {}) as any,
      notes: editing.notes?.trim() || null,
    };
    const q = editing.id
      ? supabase.from("payment_gateways").update(payload).eq("id", editing.id)
      : supabase.from("payment_gateways").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    setEditing(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta pasarela? La configuración se perderá.")) return;
    const { error } = await supabase.from("payment_gateways").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Eliminada");
    load();
  };

  const toggleEnabled = async (g: Gateway) => {
    const { error } = await supabase
      .from("payment_gateways")
      .update({ enabled: !g.enabled })
      .eq("id", g.id);
    if (error) return toast.error(error.message);
    load();
  };

  const test = async (provider: string) => {
    setTestingProv(provider);
    try {
      const r = await runTest({ data: { provider } });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e: any) {
      toast.error(e.message ?? "Fallo en test");
    } finally {
      setTestingProv(null);
    }
  };

  const copyWebhook = (provider: string, path: string | null) => {
    if (!path) return;
    let base: string;
    if (provider === "mercadopago") {
      const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      if (!raw) {
        toast.error("VITE_SUPABASE_URL no configurado — no se puede copiar la URL");
        return;
      }
      base = raw.replace(/\/+$/, "");
    } else {
      base = window.location.origin.replace(/\/+$/, "");
    }
    navigator.clipboard.writeText(`${base}${path}`);
    toast.success("URL copiada");
  };

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Pasarelas de pago</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Gestiona integraciones de forma segura. Las <b>credenciales secretas</b> se guardan como
            variables de entorno cifradas del backend (nunca en la base de datos ni en el cliente).
            Aquí solo configuras metadatos, claves públicas y el estado de cada pasarela.
          </p>
        </div>
        <button
          onClick={() =>
            setEditing({ provider: "", display_name: "", mode: "sandbox", enabled: false })
          }
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-3 py-2 text-xs font-semibold text-background"
        >
          <Plus className="h-3 w-3" /> Nueva integración
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200/90">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Seguridad:</b> las claves secretas (Access Token, Client Secret, Webhook Secret) se
            almacenan como secrets del backend con nombres estándar por proveedor. Para Mercado Pago
            el sufijo depende de <code className="rounded bg-black/40 px-1">MERCADOPAGO_ENV</code>{" "}
            (ej. <code className="rounded bg-black/40 px-1">MERCADOPAGO_ACCESS_TOKEN_TEST</code> o{" "}
            <code className="rounded bg-black/40 px-1">MERCADOPAGO_ACCESS_TOKEN_PRODUCTION</code>).
            Para agregar o rotar un secret, pídeselo al agente en el chat. Nunca los pegues en esta
            interfaz.
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((g) => {
          const s = secrets[g.provider];
          const isMp = g.provider === "mercadopago";
          // Para MP, "Listo" requiere los cuatro valores presentes. Para otros
          // proveedores mantenemos el comportamiento previo (solo access).
          const configured = isMp
            ? !!(s?.access && s?.publicKey && s?.webhook && s?.collector && s?.env)
            : (s?.access ?? false);
          return (
            <div
              key={g.id}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-neon-blue/20 to-neon-green/20 text-neon-blue">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">{g.display_name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {g.provider} · {g.mode}
                      {isMp && (
                        <>
                          {" · entorno "}
                          <span
                            className={
                              s?.env === "production"
                                ? "text-destructive"
                                : s?.env === "test"
                                  ? "text-neon-blue"
                                  : "text-amber-400"
                            }
                          >
                            {s?.env ?? "no-configurado"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={g.enabled}
                    onChange={() => toggleEnabled(g)}
                  />
                  <span className="relative h-5 w-9 rounded-full bg-border transition-colors peer-checked:bg-neon-green">
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                  </span>
                  {g.enabled ? "Activa" : "Inactiva"}
                </label>
              </div>

              {/* Secret status */}
              {s && (
                <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-background/40 p-3 text-xs">
                  <SecretRow label="Access / Secret Key" name={s.names.access} ok={s.access} />
                  {s.names.publicKey && (
                    <SecretRow
                      label="Public Key"
                      name={s.names.publicKey}
                      ok={!!s.publicKey}
                    />
                  )}
                  {s.names.webhook && (
                    <SecretRow
                      label="Webhook Secret"
                      name={s.names.webhook}
                      ok={!!s.webhook}
                    />
                  )}
                  {isMp && s.names.collector && (
                    <SecretRow
                      label="Collector ID"
                      name={s.names.collector}
                      ok={!!s.collector}
                    />
                  )}
                </div>
              )}
              {!s && (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  Proveedor personalizado. Configura sus secrets manualmente vía chat.
                </div>
              )}

              {g.webhook_path && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Webhook URL
                  </div>
                  <button
                    onClick={() => copyWebhook(g.provider, g.webhook_path)}
                    className="mt-1 inline-flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-2 py-1.5 text-left text-xs hover:border-neon-blue"
                  >
                    <span className="truncate font-mono">{g.webhook_path}</span>
                    <Copy className="h-3 w-3 shrink-0" />
                  </button>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  disabled={!configured || testingProv === g.provider}
                  onClick={() => test(g.provider)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-neon-green disabled:opacity-40"
                >
                  {testingProv === g.provider ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Zap className="h-3 w-3" />
                  )}
                  Probar conexión
                </button>
                <button
                  onClick={() => setEditing(g)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-neon-blue"
                >
                  <Edit2 className="h-3 w-3" /> Editar
                </button>
                <button
                  onClick={() => remove(g.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" /> Eliminar
                </button>
                {configured ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-neon-green">
                    <ShieldCheck className="h-3 w-3" /> Listo
                  </span>
                ) : (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-400">
                    <ShieldAlert className="h-3 w-3" /> Faltan secrets
                  </span>
                )}
              </div>

              {g.notes && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  {g.notes}
                </p>
              )}
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No hay pasarelas configuradas todavía.
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function SecretRow({ label, name, ok }: { label: string; name: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <KeyRound className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">{label}</span>
        <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">{name}</code>
      </div>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-neon-green">
          <CheckCircle2 className="h-3 w-3" /> OK
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-400">
          <XCircle className="h-3 w-3" /> Falta
        </span>
      )}
    </div>
  );
}

function EditModal({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: Partial<Gateway>;
  onChange: (v: Partial<Gateway>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const isNew = !value.id;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">
            {isNew ? "Nueva pasarela" : "Editar pasarela"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Proveedor
            </label>
            {isNew ? (
              <select
                value={value.provider ?? ""}
                onChange={(e) => {
                  const p = e.target.value;
                  const preset = KNOWN_PROVIDERS.find((x) => x.value === p);
                  onChange({
                    ...value,
                    provider: p === "other" ? "" : p,
                    display_name: value.display_name || preset?.label || "",
                    webhook_path:
                      p === "mercadopago"
                        ? MP_WEBHOOK_PATH
                        : value.webhook_path || (p !== "other" ? `/api/public/webhooks/${p}` : ""),
                  });
                }}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
              >
                <option value="">Selecciona…</option>
                {KNOWN_PROVIDERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                disabled
                value={value.provider ?? ""}
                className="mt-1 w-full cursor-not-allowed rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-sm text-muted-foreground"
              />
            )}
          </div>

          {isNew && !value.provider && (
            <input
              placeholder="ID del proveedor (ej. mi-pasarela)"
              onChange={(e) =>
                onChange({ ...value, provider: e.target.value.toLowerCase().replace(/\s+/g, "-") })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-neon-blue"
            />
          )}

          <Field
            label="Nombre visible"
            value={value.display_name ?? ""}
            onChange={(v) => onChange({ ...value, display_name: v })}
          />

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Modo</label>
            <select
              value={value.mode ?? "sandbox"}
              onChange={(e) => onChange({ ...value, mode: e.target.value as "sandbox" | "live" })}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
            >
              <option value="sandbox">Sandbox (pruebas)</option>
              <option value="live">Live (producción)</option>
            </select>
          </div>

          <Field
            label="Clave pública (opcional)"
            value={value.public_key ?? ""}
            onChange={(v) => onChange({ ...value, public_key: v })}
            placeholder="ej. pk_test_… — es segura de mostrar"
          />

          <Field
            label="Ruta del webhook"
            value={value.webhook_path ?? ""}
            onChange={(v) => onChange({ ...value, webhook_path: v })}
            placeholder="/api/public/webhooks/mi-proveedor"
          />

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Notas / instrucciones
            </label>
            <textarea
              value={value.notes ?? ""}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
              placeholder="Nombres de los secrets requeridos, dashboard URL, etc."
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.enabled ?? false}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
              className="h-4 w-4 accent-neon-blue"
            />
            Activar esta pasarela
          </label>

          <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 text-foreground">
              <ExternalLink className="h-3 w-3" /> Siguiente paso
            </div>
            Para las credenciales secretas, pide al agente en el chat: “agrega el secret
            <code className="mx-1 rounded bg-black/40 px-1">NOMBRE_DEL_SECRET</code>”. Se guardarán
            cifradas en el backend y estarán disponibles en tus server functions y webhooks.
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={onSave}
            className="rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
      />
    </div>
  );
}
