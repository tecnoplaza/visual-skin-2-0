import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Loader2, ShieldAlert, Download, Link2, Copy } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  adminGetOrderDetails,
  adminGetOrderDesignSignedUrl,
  adminDownloadProductionFile,
  adminSetFulfillmentStatus,
  adminIssueOrderRecoveryLink,
} from "@/lib/orders.functions";
import { toast } from "sonner";
import { productionDisplayLabel, shouldShowProductionControls } from "@/lib/production-display";
import AdminNotificationBell from "@/components/admin/AdminNotificationBell";

export const Route = createFileRoute("/admin/orders/$id")({
  component: AdminOrderDetailRoute,
  head: () => ({
    meta: [{ title: "Pedido — Admin VISUALSKIN" }, { name: "robots", content: "noindex,nofollow" }],
  }),
});

function AdminOrderDetailRoute() {
  const { user, isAdmin, loading } = useAuth();
  const { id } = useParams({ from: "/admin/orders/$id" });
  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-neon-blue" />
      </div>
    );
  }
  if (!user || !isAdmin) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <ShieldAlert className="mx-auto mb-4 h-8 w-8 text-destructive" />
        <h1 className="text-lg font-semibold">Acceso restringido</h1>
      </div>
    );
  }
  return <Detail id={id} />;
}

const FULFILLMENT_OPTIONS = [
  "new",
  "in_production",
  "ready",
  "shipped",
  "completed",
  "cancelled",
] as const;

function originalLabel(kind: string) {
  if (kind === "case") return "Carcasa";
  if (kind === "garment") return "Prenda";
  if (kind === "secondary_garment") return "Prenda secundaria";
  return kind || "Archivo";
}

function Detail({ id }: { id: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminGetOrderDetails({ data: { orderId: id } });
      setData(d);
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openSigned = async (assetId: string) => {
    try {
      const r = await adminGetOrderDesignSignedUrl({ data: { orderId: id, assetId } });
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    }
  };

  const downloadOriginal = async (assetId: string) => {
    try {
      const r = await adminGetOrderDesignSignedUrl({ data: { orderId: id, assetId } });
      const res = await fetch(r.url);
      if (!res.ok) throw new Error(`No se pudo descargar el original (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    }
  };

  const downloadProduction = async (path: string) => {
    try {
      const r = await adminDownloadProductionFile({ data: { orderId: id, path } });
      if (!r.url) {
        toast.info("Archivo de producción aún no generado");
        return;
      }
      const a = document.createElement("a");
      a.href = r.url;
      a.download = path.split("/").pop() ?? "archivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    }
  };

  const setFulfillment = async (status: string) => {
    setBusy(true);
    try {
      await adminSetFulfillmentStatus({
        data: { orderId: id, fulfillmentStatus: status as any },
      });
      toast.success("Estado actualizado");
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setBusy(false);
    }
  };

  const issueRecoveryLink = async () => {
    setRecoveryBusy(true);
    setRecoveryUrl(null);
    try {
      const r = await adminIssueOrderRecoveryLink({ data: { orderId: id } });
      setRecoveryUrl(r.url);
      toast.success("Enlace generado. Se muestra una sola vez.");
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const copyRecoveryLink = async () => {
    if (!recoveryUrl) return;
    try {
      await navigator.clipboard.writeText(recoveryUrl);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  if (loading || !data) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const o = data.order;
  const snap = o.catalog_snapshot ?? {};
  const originalsAvailable = o.payment_status === "approved";

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/orders" className="text-xs text-neon-blue underline">
            ← Volver
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold">
            {o.order_number ?? o.id.slice(0, 8)}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-right text-xs text-muted-foreground">
          <AdminNotificationBell />
          <span>{new Date(o.created_at).toLocaleString("es-CL")}</span>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        El pago, el monto y los IDs del proveedor de pago no pueden modificarse desde aquí. La
        descarga permanente de originales se habilita únicamente para pedidos pagados.
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Comprador">
          <KV k="Nombre" v={o.customer_name ?? "—"} />
          <KV k="Correo" v={o.customer_email} />
          <KV k="Teléfono" v={o.customer_phone ?? "—"} />
          <KV
            k="Dirección"
            v={`${o.shipping_address?.address ?? ""}, ${o.shipping_address?.comuna ?? ""} ${o.shipping_address?.region ?? ""}`}
          />
        </Card>
        <Card title="Pago">
          <KV k="Estado" v={o.payment_status} />
          <KV k="Subtotal" v={`$${(o.subtotal_amount ?? 0).toLocaleString("es-CL")}`} />
          {o.discount_amount > 0 && (
            <KV k="Descuento" v={`-$${o.discount_amount.toLocaleString("es-CL")}`} />
          )}
          <KV
            k="Despacho"
            v={
              (o.shipping_amount ?? 0) === 0
                ? "Gratis"
                : `$${o.shipping_amount.toLocaleString("es-CL")}`
            }
          />
          <KV k="Total" v={`$${o.total_amount.toLocaleString("es-CL")}`} />
          <KV
            k="Regla despacho"
            v={
              o.catalog_snapshot?.shipping?.rule
                ? String(o.catalog_snapshot.shipping.rule)
                : "No registrado"
            }
          />
          <KV k="MP Payment ID" v={o.mp_payment_id ?? "—"} mono />
          <KV k="Revisión manual" v={o.manual_review_required ? "sí" : "no"} />
          <KV k="Baja resolución" v={o.low_resolution_warning ? "sí" : "no"} />
        </Card>
      </div>

      <Card title="Estado de producción">
        {shouldShowProductionControls(o.payment_status) ? (
          <div className="flex flex-wrap gap-2">
            {FULFILLMENT_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setFulfillment(s)}
                disabled={busy}
                className={`rounded-full border px-3 py-1 text-xs ${
                  o.fulfillment_status === s
                    ? "border-neon-blue bg-neon-blue/10 text-neon-blue"
                    : "border-border text-muted-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {productionDisplayLabel(o.payment_status, o.fulfillment_status)}
            <div className="mt-1 text-[10px] uppercase tracking-wider">
              La producción se habilita cuando el pago está aprobado.
            </div>
          </div>
        )}
      </Card>

      <Card title="Recuperar acceso al pedido">
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Genera un enlace de acceso de un solo uso. Rota el token público del pedido e invalida
            enlaces y sesiones anteriores. Se muestra una sola vez.
          </p>
          <button
            onClick={issueRecoveryLink}
            disabled={recoveryBusy}
            className="inline-flex items-center gap-2 rounded-full border border-neon-blue px-4 py-1.5 text-xs text-neon-blue hover:bg-neon-blue/10 disabled:opacity-60"
          >
            {recoveryBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Link2 className="h-3 w-3" />
            )}
            Generar enlace de recuperación
          </button>
          {recoveryUrl && (
            <div className="rounded border border-neon-blue/40 bg-neon-blue/5 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-neon-blue">
                Enlace único — cópialo ahora, no se volverá a mostrar
              </div>
              <div className="flex items-start gap-2">
                <code className="flex-1 break-all font-mono text-[11px]">{recoveryUrl}</code>
                <button
                  onClick={copyRecoveryLink}
                  className="shrink-0 rounded border border-border p-1 hover:border-neon-blue"
                  aria-label="Copiar enlace"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Aceptación legal">
        <LegalAcceptanceBlock order={o} />
      </Card>

      <Card title="Snapshot de catálogo">
        <KV k="Pack" v={`${snap?.pack?.type ?? o.pack_type}`} />
        <KV k="Marca" v={snap?.brand?.name ?? o.brand ?? "—"} />
        <KV k="Modelo" v={snap?.model?.name ?? o.phone_model ?? "—"} />
        {snap?.garment && (
          <>
            <KV
              k="Prenda"
              v={`${snap.garment.type} · ${snap.garment.name} · ${snap.garment.color}`}
            />
            <KV k="Talla" v={snap.garment.size ?? "—"} />
          </>
        )}
      </Card>

      <Card title="Archivos originales del cliente">
        {!originalsAvailable && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200/90">
            Pedido no pagado: los originales se conservan temporalmente y pueden limpiarse después
            de 72 horas. La descarga administrativa se habilita cuando el pago está aprobado.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {data.designAssets.map((a: any) => (
            <div key={a.id} className="rounded border border-border p-3 text-xs">
              <div className="font-semibold">
                Producto {Math.max(1, data.items.findIndex((item: any) => item.id === a.order_item_id) + 1)} · {originalLabel(a.kind)}
              </div>
              <div className="mt-1 break-all text-muted-foreground">
                {a.metadata?.original_filename ?? "archivo-original"}
              </div>
              <div className="mt-1">
                Formato: {a.detected_format ?? "?"} · {a.width ?? "?"}×{a.height ?? "?"} px
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => openSigned(a.id)}
                  className="rounded border border-border px-3 py-1 text-xs hover:border-neon-blue"
                >
                  Ver
                </button>
                <button
                  onClick={() => downloadOriginal(a.id)}
                  disabled={!originalsAvailable}
                  className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs hover:border-neon-green disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    originalsAvailable
                      ? "Descargar archivo original"
                      : "Disponible al aprobarse el pago"
                  }
                >
                  <Download className="h-3 w-3" /> Descargar original
                </button>
              </div>
            </div>
          ))}
          {data.designAssets.length === 0 && (
            <div className="text-xs text-muted-foreground">Sin archivos originales adjuntos.</div>
          )}
        </div>
      </Card>

      <Card title="Archivo de producción">
        <div className="text-xs text-muted-foreground">
          El archivo print-ready es independiente del original del cliente y del mockup. La
          generación automática todavía no está implementada.
        </div>
        {data.designAssets.length > 0 && (
          <button
            onClick={() => downloadProduction(data.designAssets[0].file_path)}
            className="mt-2 inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs hover:border-neon-green"
          >
            <Download className="h-3 w-3" /> Consultar archivo de producción
          </button>
        )}
      </Card>

      <Card title="Intentos de pago">
        <ul className="space-y-2 text-xs">
          {data.attempts.map((a: any) => (
            <li key={a.id} className="rounded border border-border p-2">
              <div>
                #{a.attempt_number} · <b>{a.status}</b>
                {a.status_detail && ` · ${a.status_detail}`}
              </div>
              <div className="text-muted-foreground">
                {a.mercado_pago_payment_id ?? "—"} ·{" "}
                {new Date(a.created_at).toLocaleString("es-CL")}
              </div>
            </li>
          ))}
          {data.attempts.length === 0 && (
            <li className="text-muted-foreground">Sin intentos aún.</li>
          )}
        </ul>
      </Card>

      <Card title="Eventos de webhook">
        <ul className="space-y-1 text-xs">
          {data.events.map((e: any) => (
            <li key={e.id} className="font-mono">
              [{e.status}] {e.event_type}/{e.event_action ?? "—"} —{" "}
              {new Date(e.created_at).toLocaleString("es-CL")}
            </li>
          ))}
          {data.events.length === 0 && <li className="text-muted-foreground">Sin eventos.</li>}
        </ul>
      </Card>

      <Card title="Autorizaciones de subida">
        <ul className="space-y-1 text-xs font-mono">
          {data.authorizations.map((a: any) => (
            <li key={a.id}>
              [{a.status}] {a.kind} · {a.storage_path} · {a.detected_width ?? "?"}×
              {a.detected_height ?? "?"}
            </li>
          ))}
          {data.authorizations.length === 0 && (
            <li className="text-muted-foreground">Sin autorizaciones registradas.</li>
          )}
        </ul>
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono" : ""}>{v}</span>
    </div>
  );
}

function LegalAcceptanceBlock({ order }: { order: any }) {
  const [showSnapshot, setShowSnapshot] = useState(false);
  const acceptedAt: string | null = order?.legal_accepted_at ?? null;
  const hash: string | null = order?.legal_acceptance_hash ?? null;
  const snap: any = order?.legal_acceptance_snapshot ?? null;
  const isPaid = order?.payment_status === "approved";

  if (!acceptedAt) {
    return (
      <div className="text-xs">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
          {isPaid ? "Aceptación legal no registrada" : "No registrada"}
        </div>
        {isPaid && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Pedido anterior a la implementación de la aceptación legal. No debe modificarse.
          </p>
        )}
      </div>
    );
  }

  const docs = snap?.documents ?? {};
  const termsUpdated = docs?.terms?.updatedAt ?? null;
  const privacyUpdated = docs?.privacy?.updatedAt ?? null;
  const returnsUpdated = docs?.returns?.updatedAt ?? null;

  return (
    <div className="space-y-2 text-xs">
      <div className="inline-flex items-center gap-1 rounded-full border border-neon-green/40 bg-neon-green/10 px-2 py-0.5 text-neon-green">
        Registrada
      </div>
      <KV k="Fecha" v={new Date(acceptedAt).toLocaleString("es-CL")} />
      <KV k="Hash (abrev.)" v={hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : "—"} mono />
      <KV
        k="Términos y Condiciones"
        v={termsUpdated ? new Date(termsUpdated).toLocaleString("es-CL") : "—"}
      />
      <KV
        k="Cambios y Devoluciones"
        v={returnsUpdated ? new Date(returnsUpdated).toLocaleString("es-CL") : "—"}
      />
      <KV
        k="Política de Privacidad"
        v={privacyUpdated ? new Date(privacyUpdated).toLocaleString("es-CL") : "—"}
      />
      <KV k="Marca" v="VisualSkin" />
      <KV k="Entidad jurídica" v="TECNOPLAZA SpA" />
      <button
        type="button"
        onClick={() => setShowSnapshot((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-neon-blue hover:text-neon-blue"
      >
        {showSnapshot ? "Ocultar snapshot" : "Ver snapshot"}
      </button>
      {showSnapshot && snap && (
        <pre className="mt-2 max-h-80 overflow-auto rounded border border-border bg-background p-2 font-mono text-[10px] leading-snug text-muted-foreground">
          {JSON.stringify(snap, null, 2)}
        </pre>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        Registro inmutable. No puede editarse ni eliminarse desde este panel.
      </p>
    </div>
  );
}
