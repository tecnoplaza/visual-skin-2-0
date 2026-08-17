import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Loader2, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  adminListOrders,
  adminDeleteOrders,
  adminCleanupStaleUnpaidOrders,
} from "@/lib/orders.functions";
import { toast } from "sonner";
import { productionDisplayLabel } from "@/lib/production-display";

export const Route = createFileRoute("/admin/orders")({
  component: AdminOrdersRoute,
  head: () => ({
    meta: [
      { title: "Pedidos — Admin VISUALSKIN" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function AdminOrdersRoute() {
  const { user, isAdmin, loading } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
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
        <Link to="/admin" className="mt-4 inline-block text-sm text-neon-blue underline">
          Ir al panel
        </Link>
      </div>
    );
  }
  return pathname === "/admin/orders" ? <OrdersList /> : <Outlet />;
}

type Row = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string;
  customer_phone: string | null;
  total_amount: number;
  payment_status: string;
  fulfillment_status: string;
  design_status: string;
  manual_review_required: boolean;
  low_resolution_warning: boolean;
  created_at: string;
};

const PROTECTED_PAYMENT_STATUSES = new Set(["approved", "refunded", "charged_back"]);

function OrdersList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [f, setF] = useState({
    qNumber: "",
    qName: "",
    qEmail: "",
    paymentStatus: "",
    fulfillmentStatus: "",
    designStatus: "",
    manualReview: "" as "" | "yes" | "no",
    from: "",
    to: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListOrders({ data: { ...f, page, pageSize } });
      setRows(r.rows as Row[]);
      setTotal(r.total);
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }, [f, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(rows.map((r) => r.id));
      return new Set([...prev].filter((id) => visibleIds.has(id)));
    });
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectableRows = rows.filter((r) => !PROTECTED_PAYMENT_STATUSES.has(r.payment_status));
  const allSelectableSelected =
    selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        for (const r of selectableRows) next.delete(r.id);
      } else {
        for (const r of selectableRows) next.add(r.id);
      }
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;

    const ok = window.confirm(
      `Se eliminarán ${ids.length} pedido(s) NO PAGADO(S), sus registros asociados y sus archivos originales del storage.\n\nLos pedidos pagados/aprobados, reembolsados o con contracargo están protegidos y no pueden borrarse.\n\n¿Continuar?`,
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const r = await adminDeleteOrders({ data: { orderIds: ids } });
      setSelected(new Set());
      toast.success(
        `${r.deletedOrders} pedido(s) eliminado(s). ${r.deletedStorageObjects} archivo(s) borrado(s) del storage.`,
      );
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "No se pudieron eliminar los pedidos");
    } finally {
      setDeleting(false);
    }
  };

  const cleanupStale = async () => {
    const ok = window.confirm(
      "Esto eliminará pedidos NO PAGADOS con más de 72 horas y sus archivos originales. Los pedidos aprobados, reembolsados o con contracargo no se tocarán.\n\n¿Continuar?",
    );
    if (!ok) return;

    setCleanupBusy(true);
    try {
      const r = await adminCleanupStaleUnpaidOrders();
      toast.success(
        `${r.deletedOrders} pedido(s) antiguos eliminado(s). ${r.deletedStorageObjects} archivo(s) borrado(s) del storage.`,
      );
      setSelected(new Set());
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo ejecutar la limpieza");
    } finally {
      setCleanupBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Pedidos</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={cleanupStale}
            disabled={cleanupBusy || deleting}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/50 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {cleanupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Limpiar no pagados +72 h
          </button>
          <Link
            to="/admin"
            className="rounded-lg border border-border px-3 py-2 text-sm hover:border-neon-blue"
          >
            Volver al panel
          </Link>
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-3 lg:grid-cols-5">
        <Input p="Número…" v={f.qNumber} on={(v) => setF({ ...f, qNumber: v })} />
        <Input p="Nombre…" v={f.qName} on={(v) => setF({ ...f, qName: v })} />
        <Input p="Correo…" v={f.qEmail} on={(v) => setF({ ...f, qEmail: v })} />
        <Sel v={f.paymentStatus} on={(v) => setF({ ...f, paymentStatus: v })} opts={["", "pending", "approved", "rejected", "cancelled", "refunded", "charged_back"]} label="Pago" />
        <Sel v={f.fulfillmentStatus} on={(v) => setF({ ...f, fulfillmentStatus: v })} opts={["", "new", "in_production", "ready", "shipped", "completed", "cancelled"]} label="Producción" />
        <Sel v={f.designStatus} on={(v) => setF({ ...f, designStatus: v })} opts={["", "pending", "editable", "uploading", "ready", "locked", "failed"]} label="Diseño" />
        <Sel v={f.manualReview} on={(v) => setF({ ...f, manualReview: v as any })} opts={["", "yes", "no"]} label="Revisión manual" />
        <Input type="date" v={f.from} on={(v) => setF({ ...f, from: v })} />
        <Input type="date" v={f.to} on={(v) => setF({ ...f, to: v })} />
        <button
          onClick={() => { setPage(1); load(); }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-3 py-2 text-sm font-semibold text-background"
        >
          <Search className="h-4 w-4" /> Buscar
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <div className="text-muted-foreground">
          {selected.size} seleccionado(s). Los pedidos pagados/reembolsados/contracargados no son seleccionables.
        </div>
        <button
          onClick={deleteSelected}
          disabled={selected.size === 0 || deleting || cleanupBusy}
          className="inline-flex items-center gap-2 rounded border border-destructive/50 px-3 py-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Eliminar seleccionados
        </button>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    onChange={togglePage}
                    disabled={selectableRows.length === 0}
                    aria-label="Seleccionar pedidos no pagados de esta página"
                  />
                </th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Pedido</th>
                <th className="p-3">Cliente</th>
                <th className="p-3">Total</th>
                <th className="p-3">Pago</th>
                <th className="p-3">Producción</th>
                <th className="p-3">Diseño</th>
                <th className="p-3">Aviso</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const protectedOrder = PROTECTED_PAYMENT_STATUSES.has(r.payment_status);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        disabled={protectedOrder}
                        aria-label={`Seleccionar ${r.order_number ?? r.id}`}
                        title={protectedOrder ? "Pedido protegido por su estado de pago" : "Seleccionar pedido"}
                      />
                    </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("es-CL")}
                  </td>
                  <td className="p-3 font-mono text-xs">{r.order_number ?? "—"}</td>
                  <td className="p-3">
                    <div>{r.customer_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                    {r.customer_phone && (
                      <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                    )}
                  </td>
                  <td className="p-3 font-mono">${r.total_amount.toLocaleString("es-CL")}</td>
                    <td className="p-3 text-xs">
                      {r.payment_status}
                      {protectedOrder && (
                        <div className="mt-1 text-[10px] text-neon-green">protegido</div>
                      )}
                    </td>
                  <td className="p-3 text-xs">{productionDisplayLabel(r.payment_status, r.fulfillment_status)}</td>
                  <td className="p-3 text-xs">{r.design_status}</td>
                  <td className="p-3 text-xs">
                    {r.manual_review_required && (
                      <span className="rounded bg-destructive/20 px-2 py-0.5 text-destructive">
                        revisión
                      </span>
                    )}{" "}
                    {r.low_resolution_warning && (
                      <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-yellow-300">
                        baja res
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      to="/admin/orders/$id"
                      params={{ id: r.id }}
                      className="rounded border border-border px-3 py-1 text-xs hover:border-neon-blue"
                    >
                      Ver
                    </Link>
                  </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-10 text-center text-xs text-muted-foreground">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {total} pedidos · página {page} de {totalPages}
        </div>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-border px-3 py-1 disabled:opacity-40"
          >
            ← Anterior
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-border px-3 py-1 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      </div>
    </section>
  );
}

function Input({
  v, on, p, type = "text",
}: { v: string; on: (v: string) => void; p?: string; type?: string }) {
  return (
    <input
      type={type}
      value={v}
      onChange={(e) => on(e.target.value)}
      placeholder={p}
      className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
    />
  );
}

function Sel({
  v, on, opts, label,
}: { v: string; on: (v: string) => void; opts: string[]; label: string }) {
  return (
    <select
      value={v}
      onChange={(e) => on(e.target.value)}
      className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o ? `${label}: ${o}` : `${label}: todos`}
        </option>
      ))}
    </select>
  );
}
