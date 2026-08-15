import { useEffect, useRef } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";

type CardPaymentController = {
  unmount: () => void | Promise<void>;
};

type BricksBuilder = {
  create: (
    brick: "cardPayment",
    containerId: string,
    settings: Record<string, unknown>,
  ) => Promise<CardPaymentController>;
};

type MercadoPagoInstance = {
  bricks: () => BricksBuilder;
};

type MercadoPagoConstructor = new (
  publicKey: string,
  options?: { locale?: string; frontEndStack?: string },
) => MercadoPagoInstance;

declare global {
  interface Window {
    MercadoPago?: MercadoPagoConstructor;
  }
}

export type MercadoPagoCardSubmitData = {
  token: string;
  payment_method_id: string;
  issuer_id?: string | number;
  installments: number;
  payer?: { email?: string };
};

export type SanitizedMpError = {
  type: string | null;
  name: string | null;
  message: string | null;
  stage: string | null;
  causeCode: string | null;
  causeDescription: string | null;
  severity: "critical" | "non_critical";
};

export type CspDiagnostic = {
  kind: "csp";
  effectiveDirective: string | null;
  blockedOrigin: string | null;
  sourceOrigin: string | null;
  disposition: "enforce" | "report" | null;
  at: number;
};

export type RuntimeDiagnostic = {
  kind: "unhandledrejection" | "window-error";
  name: string | null;
  message: string | null;
  fileOrigin: string | null;
  at: number;
};

export type MercadoPagoDiagnostic = CspDiagnostic | RuntimeDiagnostic;

type Props = {
  publicKey: string;
  orderId: string;
  amount: number;
  email: string | null;
  onReady: () => void;
  onError: (error: SanitizedMpError) => void;
  onSubmit: (data: MercadoPagoCardSubmitData) => Promise<void> | void;
  onDiagnostic?: (diagnostic: MercadoPagoDiagnostic) => void;
  onMounted?: () => void;
  onSlowReady?: () => void;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringOrNumberValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function safeOriginOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (raw === "inline" || raw === "eval" || raw === "self") return raw;
  try {
    const url = new URL(raw, "http://localhost/");
    return url.protocol.startsWith("http")
      ? `${url.protocol}//${url.host}`
      : url.protocol;
  } catch {
    return null;
  }
}

function sanitizeError(error: unknown, stage: string): SanitizedMpError {
  const result: SanitizedMpError = {
    type: null,
    name: null,
    message: null,
    stage,
    causeCode: null,
    causeDescription: null,
    severity: "critical",
  };
  if (typeof error === "string") {
    result.message = error;
    return result;
  }
  if (!error || typeof error !== "object") return result;

  const candidate = error as Record<string, unknown>;
  result.type = stringValue(candidate.type);
  result.name = stringValue(candidate.name);
  result.message = stringValue(candidate.message);
  result.stage = stringValue(candidate.stage) ?? stage;
  if (result.type === "non_critical") result.severity = "non_critical";

  const cause = candidate.cause;
  const causeRecord = Array.isArray(cause)
    ? cause.find((item) => item && typeof item === "object")
    : cause;
  if (causeRecord && typeof causeRecord === "object") {
    const detail = causeRecord as Record<string, unknown>;
    result.causeCode = stringOrNumberValue(detail.code);
    result.causeDescription =
      stringValue(detail.description) ?? stringValue(detail.message);
  } else if (typeof cause === "string") {
    result.causeDescription = cause;
  }
  return result;
}

function safeSubmitData(value: unknown): MercadoPagoCardSubmitData {
  if (!value || typeof value !== "object") {
    throw new Error("Mercado Pago no entregó datos de pago válidos");
  }
  const raw = value as Record<string, unknown>;
  const token = stringValue(raw.token);
  const paymentMethodId = stringValue(raw.payment_method_id);
  const rawInstallments = raw.installments;
  const installments =
    typeof rawInstallments === "number"
      ? rawInstallments
      : typeof rawInstallments === "string"
        ? Number(rawInstallments)
        : 1;
  if (!token || !paymentMethodId || !Number.isInteger(installments) || installments < 1) {
    throw new Error("Mercado Pago no entregó los campos tokenizados requeridos");
  }

  const payer =
    raw.payer && typeof raw.payer === "object"
      ? (raw.payer as Record<string, unknown>)
      : null;
  const payerEmail = stringValue(payer?.email);
  const issuer = raw.issuer_id;

  return {
    token,
    payment_method_id: paymentMethodId,
    installments,
    ...(typeof issuer === "string" || typeof issuer === "number"
      ? { issuer_id: issuer }
      : {}),
    ...(payerEmail ? { payer: { email: payerEmail } } : {}),
  };
}

export default function MercadoPagoCardCheckout({
  publicKey,
  orderId,
  amount,
  email,
  onReady,
  onError,
  onSubmit,
  onDiagnostic,
  onMounted,
  onSlowReady,
}: Props) {
  const callbacksRef = useRef({
    onReady,
    onError,
    onSubmit,
    onDiagnostic,
    onMounted,
    onSlowReady,
  });
  useEffect(() => {
    callbacksRef.current = {
      onReady,
      onError,
      onSubmit,
      onDiagnostic,
      onMounted,
      onSlowReady,
    };
  }, [onReady, onError, onSubmit, onDiagnostic, onMounted, onSlowReady]);

  const initialConfigRef = useRef({ publicKey, orderId, amount, email });
  const controllerRef = useRef<CardPaymentController | null>(null);
  const containerId = `mercadopago-card-checkout-${orderId}`;

  useEffect(() => {
    let disposed = false;
    let ready = false;
    let stage = "load-sdk";
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    const config = initialConfigRef.current;

    const emitDiagnostic = (diagnostic: MercadoPagoDiagnostic) => {
      callbacksRef.current.onDiagnostic?.(diagnostic);
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: unknown; message?: unknown } | undefined;
      emitDiagnostic({
        kind: "unhandledrejection",
        name: stringValue(reason?.name),
        message: stringValue(reason?.message),
        fileOrigin: null,
        at: Date.now(),
      });
    };
    const onWindowError = (event: ErrorEvent) => {
      emitDiagnostic({
        kind: "window-error",
        name: null,
        message: stringValue(event.message),
        fileOrigin: safeOriginOnly(event.filename),
        at: Date.now(),
      });
    };
    const onCsp = (event: SecurityPolicyViolationEvent) => {
      const disposition =
        event.disposition === "enforce" || event.disposition === "report"
          ? event.disposition
          : null;
      emitDiagnostic({
        kind: "csp",
        effectiveDirective:
          stringValue(event.effectiveDirective) ??
          stringValue(event.violatedDirective),
        blockedOrigin: safeOriginOnly(event.blockedURI),
        sourceOrigin: safeOriginOnly(event.sourceFile),
        disposition,
        at: Date.now(),
      });
    };

    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("error", onWindowError);
    document.addEventListener("securitypolicyviolation", onCsp);

    void (async () => {
      try {
        await loadMercadoPago();
        if (disposed) return;
        stage = "create-instance";
        if (!window.MercadoPago) {
          throw new Error("MercadoPago.js no está disponible");
        }

        const mercadoPago = new window.MercadoPago(config.publicKey, {
          locale: "es-CL",
        });
        stage = "create-brick";
        const controller = await mercadoPago.bricks().create(
          "cardPayment",
          containerId,
          {
            initialization: {
              amount: config.amount,
              payer: config.email ? { email: config.email } : undefined,
            },
            customization: {
              visual: { style: { theme: "dark" } },
            },
            callbacks: {
              onReady: () => {
                if (disposed || ready) return;
                ready = true;
                if (slowTimer) clearTimeout(slowTimer);
                callbacksRef.current.onReady();
              },
              onError: (error: unknown) => {
                if (disposed) return;
                callbacksRef.current.onError(sanitizeError(error, stage));
              },
              onSubmit: async (rawData: unknown) => {
                try {
                  await callbacksRef.current.onSubmit(safeSubmitData(rawData));
                } catch (error) {
                  callbacksRef.current.onError(sanitizeError(error, "submit"));
                  throw error;
                }
              },
            },
          },
        );
        if (disposed) {
          await controller.unmount();
          return;
        }
        controllerRef.current = controller;
        callbacksRef.current.onMounted?.();
        slowTimer = setTimeout(() => {
          if (!disposed && !ready) callbacksRef.current.onSlowReady?.();
        }, 20_000);
      } catch (error) {
        if (!disposed) callbacksRef.current.onError(sanitizeError(error, stage));
      }
    })();

    return () => {
      disposed = true;
      if (slowTimer) clearTimeout(slowTimer);
      const controller = controllerRef.current;
      controllerRef.current = null;
      if (controller) void controller.unmount();
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("error", onWindowError);
      document.removeEventListener("securitypolicyviolation", onCsp);
    };
    // The checkout configuration is intentionally captured once per order.
    // Polling and submit state must never recreate the Mercado Pago instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return <div id={containerId} />;
}
