import { useEffect, useRef } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";

// Minimal local types for the Mercado Pago JS SDK surface we use.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CardFormData = any;

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

export type MercadoPagoCardClientProps = {
  publicKey: string;
  orderId: string;
  amount: number;
  email: string | null;
  retryGeneration: number;
  onReady: () => void;
  onError: (err: SanitizedMpError) => void;
  onSubmit: (cardFormData: CardFormData) => Promise<void> | void;
  onDiagnostic?: (d: MercadoPagoDiagnostic) => void;
  onMounted?: () => void;
  onSlowReady?: () => void;
};

function safeOriginOnly(src: string | undefined | null): string | null {
  if (!src) return null;
  const raw = String(src).trim();
  // Passthrough for non-URL blockedURI values ("inline", "eval", "").
  if (raw === "" || raw === "inline" || raw === "eval" || raw === "self") {
    return raw === "" ? "" : raw;
  }
  try {
    const u = new URL(raw, "http://localhost/");
    if (!u.protocol.startsWith("http")) return u.protocol;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickStringOrNumber(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function sanitizeMercadoPagoError(
  error: unknown,
  fallbackStage?: string,
): SanitizedMpError {
  const out: SanitizedMpError = {
    type: null,
    name: null,
    message: null,
    stage: fallbackStage ?? null,
    causeCode: null,
    causeDescription: null,
    severity: "critical",
  };
  if (!error || typeof error !== "object") {
    if (typeof error === "string") out.message = error;
    return out;
  }
  const e = error as Record<string, unknown>;
  out.type = pickString(e.type);
  out.name = pickString(e.name);
  out.message = pickString(e.message);
  out.stage = pickString(e.stage) ?? out.stage;

  const cause = e.cause;
  if (typeof cause === "string") {
    out.causeDescription = cause;
  } else if (Array.isArray(cause)) {
    const first = cause.find((c) => c && typeof c === "object") as
      | Record<string, unknown>
      | undefined;
    if (first) {
      out.causeCode = pickStringOrNumber(first.code);
      out.causeDescription =
        pickString(first.description) ?? pickString(first.message);
    }
  } else if (cause && typeof cause === "object") {
    const c = cause as Record<string, unknown>;
    out.causeCode = pickStringOrNumber(c.code);
    out.causeDescription =
      pickString(c.description) ?? pickString(c.message);
  }
  // Mercado Pago emits `type: "non_critical"` for field-level validation
  // signals (unknown BIN, incomplete number, etc.) after the Brick is
  // already mounted. Those must not tear down or hide the form.
  if (out.type === "non_critical") {
    out.severity = "non_critical";
  }
  return out;
}

export default function MercadoPagoCardClient(
  props: MercadoPagoCardClientProps,
) {
  const {
    publicKey,
    orderId,
    amount,
    email,
    retryGeneration,
    onReady,
    onError,
    onSubmit,
    onDiagnostic,
    onMounted,
    onSlowReady,
  } = props;

  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onSubmitRef = useRef(onSubmit);
  const onDiagnosticRef = useRef(onDiagnostic);
  const onMountedRef = useRef(onMounted);
  const onSlowReadyRef = useRef(onSlowReady);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onSubmitRef.current = onSubmit;
    onDiagnosticRef.current = onDiagnostic;
    onMountedRef.current = onMounted;
    onSlowReadyRef.current = onSlowReady;
  }, [onReady, onError, onSubmit, onDiagnostic, onMounted, onSlowReady]);

  const controllerRef = useRef<CardPaymentController | null>(null);
  const containerId = `card-payment-${orderId}-${retryGeneration}`;

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    let createdReceived = false;
    let readyReceived = false;
    let stage:
      | "load-sdk"
      | "create-instance"
      | "create-builder"
      | "create-brick"
      | "mounted"
      | "ready" = "load-sdk";
    let initTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let readyWatchdogHandle: ReturnType<typeof setTimeout> | null = null;

    const emitDiagnostic = (d: MercadoPagoDiagnostic) => {
      try {
        onDiagnosticRef.current?.(d);
      } catch {
        /* noop */
      }
    };

    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string; name?: string } | undefined;
      const info: RuntimeDiagnostic = {
        kind: "unhandledrejection",
        name: pickString(reason?.name),
        message: pickString(reason?.message),
        fileOrigin: null,
        at: Date.now(),
      };
      console.warn("[MP Card] unhandledrejection", info);
      emitDiagnostic(info);
    };
    const onWindowError = (e: ErrorEvent) => {
      const info: RuntimeDiagnostic = {
        kind: "window-error",
        name: null,
        message: pickString(e.message),
        fileOrigin: safeOriginOnly(e.filename),
        at: Date.now(),
      };
      console.warn("[MP Card] window.error", info);
      emitDiagnostic(info);
    };
    const onCsp = (e: SecurityPolicyViolationEvent) => {
      const rawDisposition = (e as SecurityPolicyViolationEvent & {
        disposition?: string;
      }).disposition;
      const disposition: CspDiagnostic["disposition"] =
        rawDisposition === "enforce" || rawDisposition === "report"
          ? rawDisposition
          : null;
      const info: CspDiagnostic = {
        kind: "csp",
        effectiveDirective:
          pickString(e.effectiveDirective) ?? pickString(e.violatedDirective),
        blockedOrigin: safeOriginOnly(e.blockedURI),
        sourceOrigin: safeOriginOnly(e.sourceFile),
        disposition,
        at: Date.now(),
      };
      console.warn("[MP Card] csp-violation", info);
      emitDiagnostic(info);
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("error", onWindowError);
    document.addEventListener("securitypolicyviolation", onCsp);

    const clearInitTimer = () => {
      if (initTimeoutHandle !== null) {
        clearTimeout(initTimeoutHandle);
        initTimeoutHandle = null;
      }
    };
    const clearReadyWatchdog = () => {
      if (readyWatchdogHandle !== null) {
        clearTimeout(readyWatchdogHandle);
        readyWatchdogHandle = null;
      }
    };

    // Init timer only covers load-sdk / create-instance / create-brick.
    // Once bricks.create resolves, this timer is cleared and cannot emit a
    // brick_initialization_timeout error.
    initTimeoutHandle = setTimeout(() => {
      if (createdReceived || readyReceived || cancelled) return;
      timedOut = true;
      console.warn("[MP Card] init-timeout", { stage });
      const existing = controllerRef.current;
      controllerRef.current = null;
      if (existing) {
        try {
          void existing.unmount();
        } catch {
          /* noop */
        }
      }
      onErrorRef.current(
        sanitizeMercadoPagoError(
          {
            type: "brick_initialization_timeout",
            stage: "create-brick",
            message: "Mercado Pago no pudo iniciar el formulario",
          },
          "create-brick",
        ),
      );
    }, 15_000);

    const settings = {
      initialization: {
        amount: Number(amount),
        payer: email ? { email } : undefined,
      },
      customization: {
        visual: {
          style: {
            theme: "dark",
          },
        },
      },
      callbacks: {
        onReady: () => {
          if (cancelled || timedOut) return;
          // Guard against duplicate onReady from the Brick lifecycle.
          if (readyReceived) return;
          readyReceived = true;
          stage = "ready";
          clearInitTimer();
          clearReadyWatchdog();
          console.info("[MP Card] onReady");
          onReadyRef.current();
        },
        onError: (error: unknown) => {
          const sanitized = sanitizeMercadoPagoError(error, stage);
          if (sanitized.severity === "non_critical") {
            // Field-level signal from the Brick (e.g. BIN not yet recognised).
            // Do NOT clear the init timer, do NOT unmount, do NOT reset.
            // The Brick continues to own field validation and rendering.
            console.info("[MP Card] non-critical", {
              type: sanitized.type,
              message: sanitized.message,
              stage: sanitized.stage,
            });
            if (cancelled || timedOut) return;
            onErrorRef.current(sanitized);
            return;
          }
          clearInitTimer();
          clearReadyWatchdog();
          console.warn("[MP Card] onError", sanitized);
          if (cancelled || timedOut) return;
          onErrorRef.current(sanitized);
        },
        onSubmit: (cardFormData: CardFormData) => {
          return Promise.resolve(onSubmitRef.current(cardFormData));
        },
      },
    };

    (async () => {
      try {
        stage = "load-sdk";
        console.info("[MP Card] loadMercadoPago:start");
        await loadMercadoPago();
        console.info("[MP Card] loadMercadoPago:success");
        if (cancelled || timedOut) return;

        stage = "create-instance";
        if (!window.MercadoPago) {
          throw new Error("window.MercadoPago no está disponible");
        }
        const mp = new window.MercadoPago(publicKey, {
          locale: "es-CL",
          frontEndStack: "react",
        });
        console.info("[MP Card] MercadoPago:instance-created");
        if (cancelled || timedOut) return;

        stage = "create-builder";
        const bricksBuilder = mp.bricks();
        if (cancelled || timedOut) return;

        stage = "create-brick";
        console.info("[MP Card] bricks.create:start");
        const controller = await bricksBuilder.create(
          "cardPayment",
          containerId,
          settings,
        );
        console.info("[MP Card] bricks.create:success");

        if (cancelled || timedOut) {
          try {
            void controller.unmount();
          } catch {
            /* noop */
          }
          return;
        }
        controllerRef.current = controller;
        createdReceived = true;
        stage = "mounted";
        // bricks.create resolved successfully — the Brick owns its iframes.
        // Cancel the init timer immediately so it can never emit
        // brick_initialization_timeout after this point. Do NOT simulate
        // callbacks.onReady; wait for Mercado Pago to fire it.
        clearInitTimer();
        try {
          onMountedRef.current?.();
        } catch {
          /* noop */
        }
        // Non-destructive watchdog: if onReady still hasn't arrived after
        // 20s, surface a soft "taking longer than expected" signal. Do NOT
        // unmount, reset, or hide the form.
        readyWatchdogHandle = setTimeout(() => {
          readyWatchdogHandle = null;
          if (cancelled || readyReceived) return;
          console.warn("[MP Card] ready-watchdog:slow");
          try {
            onSlowReadyRef.current?.();
          } catch {
            /* noop */
          }
        }, 20_000);
      } catch (err) {
        const sanitized = sanitizeMercadoPagoError(err, stage);
        console.warn("[MP Card] init-error", sanitized);
        clearInitTimer();
        clearReadyWatchdog();
        if (cancelled || timedOut) return;
        onErrorRef.current({
          ...sanitized,
          type: sanitized.type ?? "brick_initialization_failed",
        });
      }
    })();

    return () => {
      cancelled = true;
      clearInitTimer();
      clearReadyWatchdog();
      console.info("[MP Card] cleanup");
      const existing = controllerRef.current;
      controllerRef.current = null;
      if (existing) {
        try {
          void existing.unmount();
        } catch {
          /* noop */
        }
      }
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("error", onWindowError);
      document.removeEventListener("securitypolicyviolation", onCsp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, orderId, amount, email, retryGeneration]);

  return <div id={containerId} />;
}
