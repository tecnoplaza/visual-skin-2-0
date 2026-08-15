import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Clock, FileText, ExternalLink, Lock } from "lucide-react";
import {
  exchangeOrderToken,
  getOrderBySession,
  getOrderCsrfToken,
  getPaymentBrickInit,
  diagnoseExistingMercadoPagoTestPayment,
  processMercadoPagoPayment,
  createShopifyCheckout,
  unlockOrderDesign,
  acceptOrderLegalDocuments,
  getLegalAcceptanceAvailability,
} from "@/lib/orders.functions";
import { setOrderCsrfToken } from "@/lib/order-csrf-store";
import { productionDisplayLabel } from "@/lib/production-display";

// Dynamically load the Mercado Pago SDK on the client only. The SDK reads
// browser globals at import time; keeping it out of the SSR bundle prevents
// hydration races that leave the CardPayment brick stuck on skeletons after
// a cold reload.
const MercadoPagoCardCheckout = lazy(
  () => import("@/components/payments/MercadoPagoCardCheckout"),
);
import type {
  SanitizedMpError,
  MercadoPagoDiagnostic,
  CspDiagnostic,
  MercadoPagoCardSubmitData,
} from "@/components/payments/MercadoPagoCardCheckout";

const KNOWN_BRICK_ERRORS = new Set([
  "fields_setup_failed",
  "get_payment_methods_failed",
  "incorrect_initialization",
  "missing_required_callbacks",
  "missing_container_id",
]);

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
};



type Search = { token?: string };

export const Route = createFileRoute("/pedido/$id")({
  // Private, noindex page. Disabling SSR prevents the Mercado Pago SDK (which
  // touches browser globals) from being evaluated on the server and avoids
  // hydration mismatches that leave CardPayment stuck on skeletons.
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" ? s.token : undefined,
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

type BrickInit = {
  publicKey: string;
  amount: number;
  payerEmail: string | null;
  environment: "test" | "live";
};

type ExistingPaymentDiagnostic = {
  exists: boolean;
  httpStatus: number;
  status: string | null;
  statusDetail: string | null;
  liveMode: boolean | null;
  currency: string | null;
  amount: number | null;
  externalReferenceMatches: boolean;
  paymentMethod: string | null;
};

function PedidoView() {
  const { id } = Route.useParams();
  const { token } = Route.useSearch();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [brickStatus, setBrickStatus] = useState<
    "idle" | "loading" | "mounted" | "ready" | "error"
  >("idle");
  const [brickSlow, setBrickSlow] = useState(false);
  const [brickError, setBrickError] = useState<string | null>(null);
  const [brickDiagnostic, setBrickDiagnostic] =
    useState<SanitizedMpError | null>(null);
  const [cspViolations, setCspViolations] = useState<CspDiagnostic[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [shopifyProcessing, setShopifyProcessing] = useState(false);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [paymentsDisabled, setPaymentsDisabled] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [brickInit, setBrickInit] = useState<BrickInit | null>(null);
  const [legalChecked, setLegalChecked] = useState(false);
  const [legalSubmitting, setLegalSubmitting] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [legalAvailable, setLegalAvailable] = useState<boolean | null>(null);
  const [paymentDiagnostic, setPaymentDiagnostic] =
    useState<ExistingPaymentDiagnostic | null>(null);
  const [paymentDiagnosticError, setPaymentDiagnosticError] =
    useState<string | null>(null);
  const [paymentDiagnosticRunning, setPaymentDiagnosticRunning] =
    useState(false);
  const [paymentDiagnosticInvoked, setPaymentDiagnosticInvoked] =
    useState(false);
  const legalSubmitLockRef = useRef(false);
  const submitLockRef = useRef(false);
  // Â§9 One in-flight unlock per order. `unlockedForRef` records the payment
  // status we unlocked for, so we never re-issue an unlock in a loop.
  const unlockInFlightRef = useRef(false);
  const unlockedForRef = useRef<string | null>(null);

  // Cold-reload guard: never touch the Brick until React has fully hydrated
  // on the client. Prevents SSR/hydration races that leave the SDK attached
  // to a detached node (root cause of "skeleton stuck forever" after F5 on
  // a rejected order).
  useEffect(() => {
    setHydrated(true);
  }, []);


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

  // Initialize Mercado Pago only when this order can start a payment. Once
  // obtained, keep this configuration latched: polling must never clear it or
  // recreate the mounted Brick while a submit is in flight.
  useEffect(() => {
    if (!hydrated || !sessionReady || !order || brickInit) return;
    const canInitialize =
      !order.hasActiveAttempt &&
      order.design_status === "ready" &&
      !!order.legal_accepted_at &&
      (order.payment_status === "pending" ||
        order.payment_status === "rejected" ||
        order.payment_status === "cancelled" ||
        order.canRetryPayment === true);
    if (!canInitialize) return;

    let cancelled = false;
    setBrickStatus("loading");
    setBrickSlow(false);
    setBrickError(null);
    setPayError(null);
    void (async () => {
      try {
        const init = await getPaymentBrickInit({ data: { orderId: order.id } });
        if (cancelled) return;
        if (!init.paymentsEnabled) {
          setPaymentsDisabled(true);
          setBrickStatus("idle");
          return;
        }
        setPaymentsDisabled(false);
        if (!init.payable) {
          setBrickStatus("idle");
          return;
        }
        if (!init.publicKey || typeof init.publicKey !== "string") {
          throw new Error("Public Key de Mercado Pago no disponible");
        }
        const amount = Number(init.amount);
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
          throw new Error("Monto de pago inválido");
        }
        setBrickInit({
          publicKey: init.publicKey,
          amount,
          payerEmail: init.payerEmail ?? null,
          environment:
            (init as { environment?: string }).environment === "live"
              ? "live"
              : "test",
        });
      } catch (error) {
        if (cancelled) return;
        console.error("[MP Brick init]", error);
        setBrickStatus("error");
        setBrickError("No pudimos cargar el formulario de tarjeta.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    sessionReady,
    order?.id,
    order?.payment_status,
    order?.design_status,
    order?.hasActiveAttempt,
    order?.canRetryPayment,
    order?.legal_accepted_at,
    brickInit,
  ]);

  // Stable submit callback. MercadoPagoCardCheckout already strips the SDK
  // payload; this second allow-list makes the server boundary explicit.
  const orderIdPrimitive = order?.id ?? null;
  const handleBrickSubmit = useCallback(
    async (cardFormData: MercadoPagoCardSubmitData) => {
      if (!orderIdPrimitive) return;
      if (submitLockRef.current) return;
      const formData: MercadoPagoCardSubmitData = {
        token: cardFormData.token,
        payment_method_id: cardFormData.payment_method_id,
        installments: cardFormData.installments,
        ...(cardFormData.issuer_id !== undefined
          ? { issuer_id: cardFormData.issuer_id }
          : {}),
        ...(cardFormData.payer?.email
          ? { payer: { email: cardFormData.payer.email } }
          : {}),
      };
      submitLockRef.current = true;
      setProcessing(true);
      setPayError(null);
      try {
        const r = await processMercadoPagoPayment({
          data: { orderId: orderIdPrimitive, formData },
        });

        if (!r.ok) {
          const code = (r as { code?: string }).code;
          if (
            code === "payments_disabled" ||
            code === "environment_mismatch" ||
            code === "production_config_incomplete"
          ) {
            setPaymentsDisabled(true);
          }
          if (code === "awaiting_confirmation") {
            setPayError(
              "Estamos esperando la confirmación de Mercado Pago para tu pago anterior. Esta pantalla se actualiza automáticamente.",
            );
          } else if (code === "awaiting_reconciliation") {
            setPayError(
              "Perdimos la conexión con Mercado Pago justo después de enviar el cobro. Estamos verificando si el pago quedó registrado; no vuelvas a pagar hasta que se confirme.",
            );
          } else if (code === "design_not_ready") {
            setPayError("Los diseños del pedido aún no están listos.");
          } else if (code === "order_locked") {
            setPayError("Este pedido ya no admite nuevos pagos.");
          } else {
            setPayError(r.message ?? "Pago rechazado");
          }
        }
        await loadOrderRef.current();
      } catch (e) {
        setPayError(
          e instanceof Error ? e.message : "Error al procesar el pago",
        );
      } finally {
        setProcessing(false);
        submitLockRef.current = false;
      }
    },
    [orderIdPrimitive],
  );

  const handleBrickMounted = useCallback(() => {
    console.info("[MP Brick] mounted");
    setBrickStatus((prev) => (prev === "ready" ? prev : "mounted"));
    setBrickError(null);
  }, []);

  const handleBrickReady = useCallback(() => {
    console.info("[MP Brick] onReady");
    setBrickStatus("ready");
    setBrickSlow(false);
    setBrickError(null);
    setBrickDiagnostic(null);
  }, []);

  const handleBrickSlowReady = useCallback(() => {
    console.warn("[MP Brick] slow-ready");
    setBrickSlow(true);
  }, []);

  const handleBrickError = useCallback((err: SanitizedMpError) => {
    // Non-critical events (e.g. `no_payment_method_for_provided_bin`) are
    // field-level signals emitted after `onReady`. They must not tear down
    // the Brick, hide the form, clear typed data, or trigger a retry.
    if (err.severity === "non_critical") {
      // Client component already logged a sanitized [MP Card] non-critical.
      return;
    }
    console.error("[MP Brick] onError", err);
    const type = err.type ?? err.name ?? null;
    const known =
      (type && KNOWN_BRICK_ERRORS.has(type)) ||
      (err.causeCode && KNOWN_BRICK_ERRORS.has(err.causeCode));
    setBrickStatus("error");
    setBrickSlow(false);
    setBrickError(
      known
        ? `No pudimos cargar el formulario de tarjeta (${type}). Reintenta`
        : "No pudimos cargar el formulario de tarjeta. Reintenta",
    );
    setBrickDiagnostic(err);
  }, []);

  const handleBrickDiagnostic = useCallback((d: MercadoPagoDiagnostic) => {
    if (d.kind === "csp") {
      setCspViolations((prev) => {
        // De-dup by directive+origin.
        const key = `${d.effectiveDirective ?? ""}|${d.blockedOrigin ?? ""}`;
        if (
          prev.some(
            (p) =>
              `${p.effectiveDirective ?? ""}|${p.blockedOrigin ?? ""}` === key,
          )
        ) {
          return prev;
        }
        return [...prev, d].slice(-5);
      });
    }
  }, []);

  const diagnosticEnabled = brickInit?.environment === "test";

  const copyDiagnostic = useCallback(async () => {
    const payload = {
      error: brickDiagnostic,
      csp: cspViolations.map((c) => ({
        effectiveDirective: c.effectiveDirective,
        blockedOrigin: c.blockedOrigin,
        sourceOrigin: c.sourceOrigin,
        disposition: c.disposition,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [brickDiagnostic, cspViolations]);

  const runExistingPaymentDiagnostic = useCallback(async () => {
    if (paymentDiagnosticInvoked || paymentDiagnosticRunning) return;
    setPaymentDiagnosticInvoked(true);
    setPaymentDiagnosticRunning(true);
    setPaymentDiagnosticError(null);
    try {
      const result = await diagnoseExistingMercadoPagoTestPayment();
      setPaymentDiagnostic(result as ExistingPaymentDiagnostic);
    } catch {
      setPaymentDiagnosticError("No se pudo ejecutar el diagnóstico read-only.");
    } finally {
      setPaymentDiagnosticRunning(false);
    }
  }, [paymentDiagnosticInvoked, paymentDiagnosticRunning]);






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
          ? "Carcasa + PolerÃ³n"
          : "Carcasa + Polera + PolerÃ³n";

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
    !paymentsDisabled &&
    legalAccepted;
  // Once initialized, the checkout stays in the tree until the order reaches
  // a state where a card form is no longer needed. Polling state is not part
  // of this condition, so processing/locking cannot tear down the Brick.
  const showBrickCheckout =
    !!brickInit && legalAccepted && !isApproved && !isFinalNoRetry;
  const brickInteractionDisabled =
    processing || order.hasActiveAttempt === true || paymentsDisabled;
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
  const showExistingPaymentDiagnostic =
    order.id === "1f4c6347-5a98-425d-89d4-19fdf7b114e9" &&
    order.payment_environment === "test";



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
        {showExistingPaymentDiagnostic && (
          <div className="mx-auto mt-4 max-w-xl rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-left text-xs">
            <button
              type="button"
              disabled={paymentDiagnosticInvoked || paymentDiagnosticRunning}
              onClick={() => void runExistingPaymentDiagnostic()}
              className="rounded-md border border-yellow-500/50 px-3 py-2 font-medium text-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {paymentDiagnosticRunning
                ? "Consultando pago TEST…"
                : paymentDiagnosticInvoked
                  ? "Diagnóstico ejecutado"
                  : "Consultar pago TEST existente"}
            </button>
            {paymentDiagnostic && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-yellow-100">
                {JSON.stringify(paymentDiagnostic, null, 2)}
              </pre>
            )}
            {paymentDiagnosticError && (
              <p className="mt-3 text-destructive">{paymentDiagnosticError}</p>
            )}
          </div>
        )}
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
            <h2 className="font-display text-lg font-semibold">Datos de envÃ­o</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Field k="Nombre" v={order.customer_name ?? "â€”"} />
              <Field k="Email" v={order.customer_email} />
              <Field k="TelÃ©fono" v={order.customer_phone ?? "â€”"} />
              <Field k="DirecciÃ³n" v={order.shipping_address?.address ?? "â€”"} />
              <Field k="Comuna" v={order.shipping_address?.comuna ?? "â€”"} />
              <Field k="RegiÃ³n" v={order.shipping_address?.region ?? "â€”"} />
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
              EnvÃ­os a todo Chile. El plazo de transporte depende del proveedor logÃ­stico y de la ciudad de destino.
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
              ProducciÃ³n:{" "}
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
                Completa tu pago con tarjeta de crédito o débito.
              </div>
            )}

            {!designReady && !designLocked && !isApproved && !isFinalNoRetry && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                {order.design_status === "failed"
                  ? "No pudimos guardar tus diseños. Vuelve al personalizador e inténtalo de nuevo."
                  : "Estamos guardando tus diseños. El pago se habilita cuando terminen."}
              </div>
            )}

            {paymentsDisabled && !isApproved && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center text-xs text-yellow-400">
                Los pagos están temporalmente deshabilitados. Tu pedido y tus diseños siguen accesibles.
              </div>
            )}

            {showLegalPrompt && !paymentsDisabled && (
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

            {brickStatus === "loading" && !brickInit && canRetry && (
              <div className="grid place-items-center py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="mt-2">Cargando medio de pago…</p>
              </div>
            )}

            {showBrickCheckout && brickInit && (
              <div className="relative rounded-2xl border border-neon-blue/40 bg-neon-blue/10 p-5">
                <div className="mb-4 text-center">
                  <div className="text-sm font-semibold text-foreground">
                    Pago seguro con Mercado Pago
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Paga con tarjeta de crédito, débito o prepago sin salir de VisualSkin.
                  </p>
                </div>

                <Suspense
                  fallback={
                    <div className="grid place-items-center py-6 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <p className="mt-2">Cargando medio de pago…</p>
                    </div>
                  }
                >
                  <div
                    className={brickInteractionDisabled ? "pointer-events-none opacity-60" : undefined}
                    aria-busy={brickInteractionDisabled}
                  >
                    <MercadoPagoCardCheckout
                      publicKey={brickInit.publicKey}
                      orderId={order.id}
                      amount={brickInit.amount}
                      email={brickInit.payerEmail}
                      onReady={handleBrickReady}
                      onMounted={handleBrickMounted}
                      onSlowReady={handleBrickSlowReady}
                      onError={handleBrickError}
                      onSubmit={handleBrickSubmit}
                      onDiagnostic={handleBrickDiagnostic}
                    />
                  </div>
                </Suspense>

                {processing && (
                  <div className="absolute inset-0 grid place-items-center rounded-2xl bg-background/75">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Procesando pago...
                    </div>
                  </div>
                )}
                {brickSlow && brickStatus !== "ready" && (
                  <p className="mt-3 text-center text-xs text-yellow-400">
                    El formulario está tardando más de lo esperado.
                  </p>
                )}
                {payError && (
                  <p className="mt-3 text-center text-xs text-destructive">{payError}</p>
                )}
                <p className="mt-3 text-center text-[10px] text-muted-foreground">
                  VisualSkin no almacena los datos de tu tarjeta.
                </p>
              </div>
            )}

            {brickStatus === "error" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-center text-xs text-destructive">
                <p>{brickError ?? "No pudimos cargar el formulario de tarjeta."}</p>
                {diagnosticEnabled && (brickDiagnostic || cspViolations.length > 0) && (
                  <button
                    type="button"
                    onClick={copyDiagnostic}
                    className="mt-3 rounded-md border border-destructive/50 px-3 py-1.5"
                  >
                    {copyStatus === "copied" ? "Copiado" : "Copiar diagnóstico"}
                  </button>
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

