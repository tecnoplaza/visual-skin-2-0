import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Clock, FileText, ExternalLink, Lock } from "lucide-react";
import {
  exchangeOrderToken,
  getOrderBySession,
  getOrderCsrfToken,
  createMercadoPagoCheckoutPro,
  diagnoseExistingCheckoutProTestPreference,
  reconcileMercadoPagoCheckoutProReturn,
  createShopifyCheckout,
  unlockOrderDesign,
  acceptOrderLegalDocuments,
  getLegalAcceptanceAvailability,
} from "@/lib/orders.functions";
import { setOrderCsrfToken } from "@/lib/order-csrf-store";
import { productionDisplayLabel } from "@/lib/production-display";

// Phase 1: Mercado Pago is the only visible checkout. Shopify remains fully
// implemented below as a temporary fallback and can be re-enabled deliberately.
const SHOW_SHOPIFY_FALLBACK = false;

type Order = {
  id: string;
  order_number: string;
  pack_type: string;
  brand: string | null;
  phone_model: string | null;
  garment_size: string | null;
  garment_color: string | null;
  secondary_garment_size: string | null;
  secondary_garment_color: string | null;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  payment_environment: "test" | "production";
  payment_status:
    | "pending"
    | "approved"
    | "rejected"
    | "cancelled"
    | "refunded"
    | "charged_back";
  fulfillment_status:
    | "new"
    | "in_production"
    | "ready"
    | "shipped"
    | "completed"
    | "cancelled";
  design_status?: "pending" | "uploading" | "ready" | "locked" | "failed";
  mp_payment_id: string | null;
  customer_name: string | null;
  customer_email: string;
  customer_phone: string | null;
  shipping_address: {
    address?: string;
    comuna?: string;
    region?: string;
    notes?: string;
  } | null;
  case_design_url: string | null;
  garment_design_url: string | null;
  secondary_garment_design_url: string | null;
  notes: string | null;
  created_at: string;
  hasActiveAttempt?: boolean;
  activeAttemptStatus?:
    | "processing"
    | "pending"
    | "awaiting_reconciliation"
    | null;
  canRetryPayment?: boolean;
  legal_accepted_at?: string | null;
  legal_acceptance_hash?: string | null;
  preferenceDiagnosticAvailable?: boolean;
};

type CheckoutProPreferenceDiagnostic = Awaited<
  ReturnType<typeof diagnoseExistingCheckoutProTestPreference>
>;



type Search = {
  token?: string;
  mp_return?: "success" | "pending" | "failure";
  payment_id?: string;
};

export const Route = createFileRoute("/pedido/$id")({
  // Private, noindex order page. Checkout Pro redirects from the browser only.
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" ? s.token : undefined,
    mp_return: s.mp_return === "success" || s.mp_return === "pending" || s.mp_return === "failure" ? s.mp_return : undefined,
    payment_id: typeof s.payment_id === "string" && /^[0-9]{1,30}$/.test(s.payment_id) ? s.payment_id : undefined,
  }),
  component: PedidoView,
  head: () => ({
    meta: [
      { title: "Resumen y pago â€” VISUALSKIN" },
      { name: "robots", content: "noindex,nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

function PedidoView() {
  const { id } = Route.useParams();
  const { token, mp_return: mpReturn, payment_id: returnPaymentId } = Route.useSearch();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [preferenceDiagnosticLoading, setPreferenceDiagnosticLoading] = useState(false);
  const [preferenceDiagnostic, setPreferenceDiagnostic] =
    useState<CheckoutProPreferenceDiagnostic | null>(null);
  const [preferenceDiagnosticError, setPreferenceDiagnosticError] = useState<string | null>(null);
  const [shopifyProcessing, setShopifyProcessing] = useState(false);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [legalChecked, setLegalChecked] = useState(false);
  const [legalSubmitting, setLegalSubmitting] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [legalAvailable, setLegalAvailable] = useState<boolean | null>(null);
  const legalSubmitLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const returnReconcileRef = useRef<string | null>(null);
  // Â§9 One in-flight unlock per order. `unlockedForRef` records the payment
  // status we unlocked for, so we never re-issue an unlock in a loop.
  const unlockInFlightRef = useRef(false);
  const unlockedForRef = useRef<string | null>(null);


  // ---- Load order via cookie session ----
  const loadOrder = useCallback(async () => {
    try {
      const o = await getOrderBySession({ data: { orderId: id } });
      setOrder(o as Order);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Pedido no accesible");
    } finally {
      setLoading(false);
    }
  }, [id]);
  const loadOrderRef = useRef(loadOrder);
  useEffect(() => {
    loadOrderRef.current = loadOrder;
  }, [loadOrder]);

  // ---- On mount: if URL has token, exchange it for a cookie session then
  //      remove the token from the URL, otherwise try to use existing cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token) {
        try {
          const ex = await exchangeOrderToken({ data: { orderId: id, token } });
          setOrderCsrfToken(id, ex.csrfToken);
          // Remove the token from the URL immediately (replace history entry).
          navigate({
            to: "/pedido/$id",
            params: { id },
            search: {},
            replace: true,
          });
        } catch (e) {
          if (!cancelled) {
            setErrMsg(e instanceof Error ? e.message : "Token invÃ¡lido");
            setLoading(false);
            return;
          }
        }
      }
      if (cancelled) return;
      // Ensure the client has a fresh CSRF token before any mutation
      // (payment, mark-failed, unlock, etc.).
      try {
        const c = await getOrderCsrfToken({ data: { orderId: id } });
        setOrderCsrfToken(id, c.csrfToken);
      } catch {
        /* handled downstream when a mutation is attempted */
      }
      setSessionReady(true);
      await loadOrder();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // ---- Poll while active/awaiting_reconciliation ----
  useEffect(() => {
    if (!order || !sessionReady) return;
    const shouldPoll =
      order.payment_status === "pending" ||
      order.hasActiveAttempt === true;
    if (!shouldPoll) return;
    const iv = setInterval(async () => {
      try {
        const o = await getOrderBySession({ data: { orderId: id } });
        setOrder(o as Order);
      } catch {
        /* ignore */
      }
    }, 5000);
    // Auto-stop after 5 minutes; user can manually refresh afterwards.
    const stop = setTimeout(() => clearInterval(iv), 5 * 60 * 1000);
    return () => {
      clearInterval(iv);
      clearTimeout(stop);
    };
  }, [order, sessionReady, id]);

  // Â§3/Â§9 Auto-unlock once when the order landed on rejected/cancelled but
  // the design is still locked (webhook or manual retry path). Guarded by a
  // ref so it runs AT MOST once per (order, payment_status) tuple.
  useEffect(() => {
    if (!order || !sessionReady) return;
    const needsUnlock =
      (order.payment_status === "rejected" ||
        order.payment_status === "cancelled") &&
      order.design_status === "locked" &&
      !order.hasActiveAttempt;
    if (!needsUnlock) return;
    const key = `${order.id}:${order.payment_status}`;
    if (unlockedForRef.current === key || unlockInFlightRef.current) return;
    unlockInFlightRef.current = true;
    unlockedForRef.current = key;
    (async () => {
      try {
        await unlockOrderDesign({ data: { orderId: order.id } });
      } catch (e) {
        // Idempotent RPC â€” a failure here just means "still locked".
        console.error("[unlockOrderDesign]", e);
      } finally {
        unlockInFlightRef.current = false;
        await loadOrder();
      }
    })();
  }, [order, sessionReady, loadOrder]);

  // Legal documents availability â€” only needed when the order still has to
  // accept (no legal_accepted_at yet). If any doc is missing/draft we hide
  // the checkbox and show a friendly "not available" message.
  const needsLegalPrompt =
    !!order &&
    !order.legal_accepted_at &&
    (order.payment_status === "pending" ||
      order.payment_status === "rejected" ||
      order.payment_status === "cancelled");

  useEffect(() => {
    if (!sessionReady || !needsLegalPrompt) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await getLegalAcceptanceAvailability();
        if (!cancelled) setLegalAvailable(!!r.available);
      } catch {
        if (!cancelled) setLegalAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionReady, needsLegalPrompt]);

  const handleAcceptLegal = useCallback(async () => {
    if (!order) return;
    if (legalSubmitLockRef.current) return;
    legalSubmitLockRef.current = true;
    setLegalSubmitting(true);
    setLegalError(null);
    try {
      const r = await acceptOrderLegalDocuments({ data: { orderId: order.id } });
      if (!r.accepted) {
        setLegalError(
          r.code === "documents_unavailable"
            ? "Las condiciones de compra no estÃ¡n disponibles en este momento. IntÃ©ntalo nuevamente mÃ¡s tarde."
            : "Este pedido ya no admite registrar la aceptación.",
        );
        return;
      }
      await loadOrder();
    } catch (e) {
      setLegalError(
        e instanceof Error ? e.message : "No se pudo registrar la aceptación",
      );
    } finally {
      setLegalSubmitting(false);
      legalSubmitLockRef.current = false;
    }
  }, [order, loadOrder]);


  const handleShopifyCheckout = useCallback(async () => {
    if (!order || shopifyProcessing) return;
    if (!order.legal_accepted_at) {
      setShopifyError("Debes aceptar las condiciones de compra antes de pagar.");
      return;
    }
    if (order.design_status !== "ready") {
      setShopifyError("El diseño todavía no está listo para pagar.");
      return;
    }

    setShopifyProcessing(true);
    setShopifyError(null);
    try {
      const result = await createShopifyCheckout({
        data: { orderId: order.id },
      });
      if (!result.ok) {
        if (result.code === "already_paid") {
          await loadOrderRef.current();
          return;
        }
        throw new Error("Este pedido ya no está disponible para pago.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      console.error("[Shopify Checkout]", e);
      setShopifyError(
        e instanceof Error
          ? e.message === "SHOPIFY_NOT_CONFIGURED"
            ? "El pago con Shopify todavía no está configurado."
            : e.message === "SHOPIFY_PRICE_MISMATCH" ||
                e.message === "SHOPIFY_CURRENCY_MISMATCH" ||
                e.message === "SHOPIFY_INVALID_PRICE_RESPONSE"
              ? "El total de Shopify no coincide con el pedido. No se realizó ningún cobro."
              : "No pudimos abrir el checkout seguro. Inténtalo nuevamente."
          : "No pudimos abrir el checkout seguro. Inténtalo nuevamente.",
      );
    } finally {
      setShopifyProcessing(false);
    }
  }, [order, shopifyProcessing]);

  const handleMercadoPagoCheckout = useCallback(async () => {
    if (!order || processing || submitLockRef.current || order.hasActiveAttempt) return;
    submitLockRef.current = true;
    setProcessing(true);
    setPayError(null);
    try {
      const result = await createMercadoPagoCheckoutPro({ data: { orderId: order.id } });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setPayError(error instanceof Error ? error.message : "No pudimos abrir Mercado Pago.");
      setProcessing(false);
      submitLockRef.current = false;
    }
  }, [order, processing]);

  const handlePreferenceDiagnostic = useCallback(async () => {
    if (!order?.preferenceDiagnosticAvailable || preferenceDiagnosticLoading) return;
    setPreferenceDiagnosticLoading(true);
    setPreferenceDiagnostic(null);
    setPreferenceDiagnosticError(null);
    try {
      const result = await diagnoseExistingCheckoutProTestPreference({
        data: { orderId: order.id },
      });
      setPreferenceDiagnostic(result);
    } catch (error) {
      setPreferenceDiagnosticError(
        error instanceof Error ? error.message : "No se pudo ejecutar el diagnóstico.",
      );
    } finally {
      setPreferenceDiagnosticLoading(false);
    }
  }, [order, preferenceDiagnosticLoading]);

  useEffect(() => {
    if (!sessionReady || !mpReturn || !returnPaymentId) return;
    const key = `${id}:${returnPaymentId}`;
    if (returnReconcileRef.current === key) return;
    returnReconcileRef.current = key;
    setProcessing(true);
    setPayError(null);
    void (async () => {
      try {
        await reconcileMercadoPagoCheckoutProReturn({ data: { orderId: id, paymentId: returnPaymentId } });
        await loadOrderRef.current();
      } catch (error) {
        setPayError(error instanceof Error ? error.message : "No pudimos verificar el pago todavía.");
      } finally {
        setProcessing(false);
      }
    })();
  }, [sessionReady, mpReturn, returnPaymentId, id]);
  if (loading) {
    return (
      <section className="mx-auto grid min-h-[60vh] max-w-4xl place-items-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </section>
    );
  }
  if (errMsg || !order) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {errMsg ?? "Pedido no encontrado"}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Verifica el enlace de acceso que recibiste al crear el pedido.
        </p>
        <Link to="/personalizador" className="mt-4 inline-block text-sm text-neon-blue underline">
          Volver al personalizador
        </Link>
      </section>
    );
  }

  const isCompletePack = order.pack_type === "carcasa+polera+poleron";
  const hasShirt = order.pack_type !== "carcasa";
  const packLabel =
    order.pack_type === "carcasa"
      ? "Solo Carcasa"
      : order.pack_type === "carcasa+polera"
        ? "Carcasa + Polera"
        : order.pack_type === "carcasa+poleron"
          ? "Carcasa + Polerón"
          : "Carcasa + Polera + Polerón";

  const isApproved = order.payment_status === "approved";
  const isRejected = order.payment_status === "rejected";
  const isCancelled = order.payment_status === "cancelled";
  const isPending = order.payment_status === "pending";
  const isFinalNoRetry =
    order.payment_status === "refunded" || order.payment_status === "charged_back";
  const activeStatus = order.activeAttemptStatus ?? null;
  const isProcessing =
    !!order.hasActiveAttempt && activeStatus === "processing";
  const isAwaitingReconciliation =
    !!order.hasActiveAttempt && activeStatus === "awaiting_reconciliation";
  const isAwaitingPending =
    !!order.hasActiveAttempt && activeStatus === "pending";
  const designReady =
    order.design_status === "ready" || order.design_status === undefined;
  const designLocked = order.design_status === "locked";
  // Fresh pending order (no attempts yet, design ready) â€” canonical first pay.
  const isFreshPending =
    isPending && !order.hasActiveAttempt && designReady;
  // Server is the single source of truth for retry after rejected/cancelled.
  const legalAccepted = !!order.legal_accepted_at;
  const canRetry =
    (isFreshPending || order.canRetryPayment === true) &&
    legalAccepted;
  // Show "preparing new attempt" while the auto-unlock is still in-flight.
  const preparingRetry =
    (isRejected || isCancelled) &&
    !order.hasActiveAttempt &&
    designLocked;
  const showLegalPrompt =
    !legalAccepted &&
    !isApproved &&
    !isFinalNoRetry &&
    !order.hasActiveAttempt &&
    designReady &&
    (isPending || isRejected || isCancelled);



  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-neon-blue/40 bg-neon-blue/10 px-4 py-1.5 text-xs text-neon-blue">
          Pedido Â· {order.order_number}
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold md:text-4xl">Resumen y pago</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Revisa tu diseño y paga con Mercado Pago dentro de VISUALSKIN.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className={`grid gap-4 ${isCompletePack ? "sm:grid-cols-2 lg:grid-cols-3" : hasShirt ? "sm:grid-cols-2" : ""}`}>
            {order.case_design_url && (
              <figure className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex min-h-[300px] items-center justify-center p-6 sm:min-h-[380px] sm:p-8">
                  <img
                    src={order.case_design_url}
                    alt="DiseÃ±o carcasa"
                    className="block h-auto max-h-[460px] w-auto max-w-[78%] object-contain sm:max-h-[540px] sm:max-w-[72%] lg:max-h-[580px] lg:max-w-[68%]"
                  />
                </div>
                <figcaption className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                  Carcasa Â· {order.phone_model}
                </figcaption>
              </figure>
            )}
            {isCompletePack ? (
              <>
                {order.garment_design_url && (
                  <figure className="overflow-hidden rounded-2xl border border-border bg-card">
                    <img src={order.garment_design_url} alt="DiseÃ±o polera" className="h-full w-full object-contain" />
                    <figcaption className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                      Polera Â· Talla {order.garment_size}
                    </figcaption>
                  </figure>
                )}
                {order.secondary_garment_design_url && (
                  <figure className="overflow-hidden rounded-2xl border border-border bg-card">
                    <img src={order.secondary_garment_design_url} alt="DiseÃ±o polerÃ³n" className="h-full w-full object-contain" />
                    <figcaption className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                      PolerÃ³n Â· Talla {order.secondary_garment_size}
                    </figcaption>
                  </figure>
                )}
              </>
            ) : (
              hasShirt && order.garment_design_url && (
                <figure className="overflow-hidden rounded-2xl border border-border bg-card">
                  <img src={order.garment_design_url} alt="DiseÃ±o prenda" className="h-full w-full object-contain" />
                  <figcaption className="border-t border-border p-3 text-center text-xs text-muted-foreground capitalize">
                    {order.pack_type === "carcasa+poleron" ? "PolerÃ³n" : "Polera"} Â· Talla {order.garment_size}
                  </figcaption>
                </figure>
              )
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-semibold">Datos de envío</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Field k="Nombre" v={order.customer_name ?? "â€”"} />
              <Field k="Email" v={order.customer_email} />
              <Field k="Teléfono" v={order.customer_phone ?? "—"} />
              <Field k="Dirección" v={order.shipping_address?.address ?? "—"} />
              <Field k="Comuna" v={order.shipping_address?.comuna ?? "â€”"} />
              <Field k="Región" v={order.shipping_address?.region ?? "—"} />
            </dl>
            {order.shipping_address?.notes && (
              <p className="mt-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                <b className="text-foreground">Observaciones:</b> {order.shipping_address.notes}
              </p>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-20">
          <h3 className="font-display text-lg font-semibold">Resumen</h3>
          <dl className="mt-4 space-y-2 text-sm">
            <Field k="Pack" v={packLabel} />
            <Field k="Marca" v={order.brand ?? "â€”"} />
            <Field k="Modelo" v={order.phone_model ?? "â€”"} />
            {isCompletePack ? (
              <>
                <Field k="Talla polera" v={order.garment_size ?? "â€”"} />
                {order.garment_color && <Field k="Color polera" v={order.garment_color} />}
                <Field k="Talla polerÃ³n" v={order.secondary_garment_size ?? "â€”"} />
                {order.secondary_garment_color && (
                  <Field k="Color polerÃ³n" v={order.secondary_garment_color} />
                )}
              </>
            ) : (
              <>
                {hasShirt && <Field k="Talla" v={order.garment_size ?? "â€”"} />}
                {order.garment_color && <Field k="Color" v={order.garment_color} />}
              </>
            )}
          </dl>
          <div className="mt-4 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <Row k="Subtotal" v={`$${order.subtotal_amount.toLocaleString("es-CL")}`} />
            {order.discount_amount > 0 && (
              <Row k="Descuento" v={`-$${order.discount_amount.toLocaleString("es-CL")}`} />
            )}
            <Row k="Despacho" v={order.shipping_amount === 0 ? "Gratis" : `$${order.shipping_amount.toLocaleString("es-CL")}`} />
            <div className="pt-1 text-[10px] leading-relaxed text-muted-foreground/70">
              Envíos a todo Chile. El plazo de transporte depende del proveedor logístico y de la ciudad de destino.
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-mono text-2xl font-bold text-neon-green">
              ${order.total_amount.toLocaleString("es-CL")}
            </span>
          </div>

          <div className="mt-6">
            <PaymentStatusBadge status={order.payment_status} />
            <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Producción:{" "}
              <b className="text-foreground">
                {productionDisplayLabel(order.payment_status, order.fulfillment_status)}
              </b>
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {isApproved && (
              <div className="rounded-lg border border-neon-green/40 bg-neon-green/10 p-3 text-center text-xs text-neon-green">
                <CheckCircle2 className="mx-auto mb-1 h-5 w-5" />
                Pago aprobado. Ya estamos preparando tu pedido.
                {order.mp_payment_id && (
                  <div className="mt-1 font-mono text-[10px] text-neon-green/70">
                    Pago #{order.mp_payment_id}
                  </div>
                )}
              </div>
            )}

            {isFinalNoRetry && (
              <div className="rounded-lg border border-border bg-secondary p-3 text-center text-xs text-muted-foreground">
                Este pedido ya no admite nuevos pagos.
              </div>
            )}

            {/* Â§7 Mutually exclusive states. */}
            {isProcessing && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                <Clock className="mx-auto mb-1 h-5 w-5" />
                Procesando pagoâ€¦
                <div className="mt-1 text-[10px] text-yellow-400/70">
                  No cierres esta página mientras confirmamos la operación.
                </div>
              </div>
            )}

            {isAwaitingPending && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                <Clock className="mx-auto mb-1 h-5 w-5" />
                Esperando confirmación
                <div className="mt-1 text-[10px] text-yellow-400/70">
                  Mercado Pago todavía está procesando tu pago. No necesitas volver a pagar.
                </div>
              </div>
            )}

            {isAwaitingReconciliation && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                <Clock className="mx-auto mb-1 h-5 w-5" />
                Estamos verificando tu pago
                <div className="mt-1 text-[10px] text-yellow-400/70">
                  No realices otro pago. Actualizaremos el estado cuando Mercado Pago confirme la operación.
                </div>
              </div>
            )}

            {preparingRetry && (
              <div className="rounded-lg border border-border bg-secondary p-3 text-center text-xs text-muted-foreground">
                <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />
                Preparando un nuevo intentoâ€¦
              </div>
            )}

            {!order.hasActiveAttempt && !preparingRetry && isRejected && designReady && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center text-xs text-destructive">
                <XCircle className="mx-auto mb-1 h-5 w-5" />
                El pago fue rechazado. Puedes intentarlo nuevamente con otra tarjeta o revisando los datos ingresados.
              </div>
            )}
            {!order.hasActiveAttempt && !preparingRetry && isCancelled && designReady && (
              <div className="rounded-lg border border-border bg-secondary p-3 text-center text-xs text-muted-foreground">
                El pago fue cancelado. Puedes reintentar.
              </div>
            )}
            {isFreshPending && (
              <div className="rounded-lg border border-neon-blue/40 bg-neon-blue/10 p-3 text-center text-xs text-neon-blue">
                Tu pedido está listo para continuar al checkout seguro de Mercado Pago.
              </div>
            )}

            {!designReady && !designLocked && !isApproved && !isFinalNoRetry && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                {order.design_status === "failed"
                  ? "No pudimos guardar tus diseños. Vuelve al personalizador e inténtalo de nuevo."
                  : "Estamos guardando tus diseños. El pago se habilita cuando terminen."}
              </div>
            )}

            {showLegalPrompt && (
              <LegalAcceptanceCard
                available={legalAvailable}
                checked={legalChecked}
                onCheckedChange={setLegalChecked}
                submitting={legalSubmitting}
                error={legalError}
                onSubmit={handleAcceptLegal}
              />
            )}

            {legalAccepted && !isApproved && !isFinalNoRetry && (
              <div className="rounded-lg border border-neon-green/40 bg-neon-green/10 p-3 text-xs text-neon-green">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Condiciones aceptadas. Ya puedes continuar con el pago.</span>
                </div>
                <div className="mt-1 pl-6 text-[10px] text-neon-green/80">
                  Aceptación registrada el{" "}
                  {new Date(order.legal_accepted_at!).toLocaleString("es-CL")}
                </div>
              </div>
            )}

            {canRetry && !order.hasActiveAttempt && !preparingRetry && (
              <div className="rounded-2xl border border-neon-blue/40 bg-neon-blue/10 p-5">
                <div className="text-center">
                  <div className="text-sm font-semibold text-foreground">Pago seguro con Mercado Pago</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Serás dirigido a Mercado Pago para completar el pago de forma segura.
                  </p>
                </div>
                {payError && <p className="mt-4 text-center text-xs text-destructive">{payError}</p>}
                <button type="button" disabled={processing}
                  onClick={() => void handleMercadoPagoCheckout()}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-neon-blue px-6 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {processing ? "Abriendo Mercado Pago…" : "Pagar con Mercado Pago"}
                </button>
              </div>
            )}
            {order.preferenceDiagnosticAvailable && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4">
                <p className="text-xs font-semibold text-amber-200">
                  Diagnóstico temporal Checkout Pro — Preview TEST
                </p>
                <button
                  type="button"
                  disabled={preferenceDiagnosticLoading}
                  onClick={() => void handlePreferenceDiagnostic()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300/50 px-3 py-2 text-xs text-amber-100 disabled:opacity-60"
                >
                  {preferenceDiagnosticLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Consultar preferencia existente
                </button>
                {preferenceDiagnosticError && (
                  <p className="mt-3 text-xs text-destructive">
                    {preferenceDiagnosticError}
                  </p>
                )}
                {preferenceDiagnostic && (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] text-amber-50">
                    {JSON.stringify(preferenceDiagnostic, null, 2)}
                  </pre>
                )}
              </div>
            )}
            {/* Shopify remains intact as a temporary fallback, hidden in Phase 1
                so the customer can never see two actions capable of charging. */}
            {SHOW_SHOPIFY_FALLBACK && legalAccepted && !isApproved && !isFinalNoRetry && (
              <div className="rounded-2xl border border-neon-blue/40 bg-neon-blue/10 p-5">
                <div className="text-center">
                  <div className="text-sm font-semibold text-foreground">
                    Pago seguro con Shopify
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Al continuar serás enviado al checkout seguro de Shopify,
                    donde podrás ingresar los datos de tu tarjeta.
                  </p>
                </div>

                {shopifyError && (
                  <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center text-xs text-destructive">
                    {shopifyError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={shopifyProcessing}
                  onClick={handleShopifyCheckout}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neon-blue px-5 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {shopifyProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Preparando pago seguro…
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      Pagar con Shopify
                    </>
                  )}
                </button>

                <p className="mt-3 text-center text-[10px] text-muted-foreground">
                  VisualSkin no almacena los datos de tu tarjeta. El pago se
                  procesa directamente en Shopify.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate({ to: "/personalizador" })}
            className="mt-6 w-full text-xs text-muted-foreground underline hover:text-foreground"
          >
            Volver al personalizador
          </button>
        </aside>
      </div>
    </section>
  );
}

function PaymentStatusBadge({ status }: { status: Order["payment_status"] }) {
  const map: Record<Order["payment_status"], { label: string; cls: string }> = {
    pending: { label: "Pago pendiente", cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400" },
    approved: { label: "Pago aprobado", cls: "border-neon-green/40 bg-neon-green/10 text-neon-green" },
    rejected: { label: "Pago rechazado", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
    cancelled: { label: "Pago cancelado", cls: "border-border bg-secondary text-muted-foreground" },
    refunded: { label: "Reembolsado", cls: "border-border bg-secondary text-muted-foreground" },
    charged_back: { label: "Contracargo", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  };
  const s = map[status];
  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${s.cls}`}>
      {s.label}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function LegalAcceptanceCard({
  available,
  checked,
  onCheckedChange,
  submitting,
  error,
  onSubmit,
}: {
  available: boolean | null;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  if (available === false) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-xs text-yellow-400"
      >
        Las condiciones de compra no estÃ¡n disponibles en este momento. IntÃ©ntalo nuevamente mÃ¡s tarde.
      </div>
    );
  }
  const loading = available === null;
  const disabled = !checked || submitting || loading;
  const linkCls =
    "inline-flex items-center gap-0.5 text-neon-blue underline underline-offset-2 hover:text-neon-blue/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue/50 rounded-sm";
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-xs">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4 text-neon-blue" />
        Antes de pagar
      </div>
      <p className="mt-2 text-muted-foreground">
        Revisa y acepta las condiciones aplicables a tu compra.
      </p>
      <ul className="mt-3 space-y-1 text-muted-foreground">
        <li>
          <Link to="/terminos" target="_blank" rel="noopener" className={linkCls}>
            TÃ©rminos y Condiciones <ExternalLink className="h-3 w-3" />
          </Link>
        </li>
        <li>
          <Link
            to="/cambios-y-devoluciones"
            target="_blank"
            rel="noopener"
            className={linkCls}
          >
            Cambios y Devoluciones <ExternalLink className="h-3 w-3" />
          </Link>
        </li>
        <li>
          <Link to="/privacidad" target="_blank" rel="noopener" className={linkCls}>
            PolÃ­tica de Privacidad <ExternalLink className="h-3 w-3" />
          </Link>
        </li>
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-3 text-left focus-within:ring-2 focus-within:ring-neon-blue/40">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={submitting || loading}
          className="mt-0.5 h-4 w-4 shrink-0 accent-neon-blue"
          aria-describedby="legal-accept-help"
        />
        <span id="legal-accept-help" className="text-[12px] leading-snug text-foreground">
          He leÃ­do y acepto los TÃ©rminos y Condiciones y la PolÃ­tica de Cambios y
          Devoluciones. TambiÃ©n declaro haber leÃ­do la PolÃ­tica de Privacidad.
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        aria-busy={submitting || undefined}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-neon-blue bg-neon-blue/10 px-4 py-2 text-xs font-medium text-neon-blue transition hover:bg-neon-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Registrando aceptaciÃ³nâ€¦
          </>
        ) : (
          "Aceptar y continuar al pago"
        )}
      </button>
    </div>
  );
}

