// Public Edge Function to receive Mercado Pago IPN/webhook notifications.
// - Fail-closed configuration: MERCADOPAGO_ENV must be "test" or "production",
//   and the matching Access Token + Webhook Secret must be present.
// - No fallbacks to unsuffixed variables.
// - Signature (x-signature v1 HMAC) is mandatory for any POST that would be
//   processed, including the MP "test delivery" (data.id === "123456").
// - Never logs Access Tokens, card data, CVV, or secret material.
// - verify_jwt = false (public endpoint).

type MpEnv = "test" | "production";

type WebhookConfig =
  | {
      ok: true;
      env: MpEnv;
      accessToken: string;
      webhookSecret: string;
      supabaseUrl: string;
      serviceRole: string;
      collectorId: string | null;
    }
  | {
      ok: false;
      code:
        | "missing_environment"
        | "invalid_environment"
        | "missing_access_token"
        | "missing_webhook_secret"
        | "missing_supabase_config"
        | "missing_collector_id"
        | "invalid_collector_id";
    };

const COLLECTOR_ID_RE = /^[0-9]+$/;

function loadConfig(): WebhookConfig {
  const rawEnv = Deno.env.get("MERCADOPAGO_ENV");
  if (rawEnv === undefined || rawEnv === null || rawEnv.trim() === "") {
    return { ok: false, code: "missing_environment" };
  }
  const envNorm = rawEnv.trim().toLowerCase();
  if (envNorm !== "test" && envNorm !== "production") {
    return { ok: false, code: "invalid_environment" };
  }
  const env = envNorm as MpEnv;

  const accessToken =
    env === "production"
      ? Deno.env.get("MERCADOPAGO_ACCESS_TOKEN_PRODUCTION")
      : Deno.env.get("MERCADOPAGO_ACCESS_TOKEN_TEST");
  if (!accessToken || accessToken.trim() === "") {
    return { ok: false, code: "missing_access_token" };
  }

  const webhookSecret =
    env === "production"
      ? Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION")
      : Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_TEST");
  if (!webhookSecret || webhookSecret.trim() === "") {
    return { ok: false, code: "missing_webhook_secret" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return { ok: false, code: "missing_supabase_config" };
  }

  // Strict per-environment collector id. No unsuffixed fallback.
  const rawCollector =
    env === "production"
      ? Deno.env.get("MERCADOPAGO_COLLECTOR_ID_PRODUCTION")
      : Deno.env.get("MERCADOPAGO_COLLECTOR_ID_TEST");
  const trimmedCollector =
    typeof rawCollector === "string" ? rawCollector.trim() : "";
  let collectorId: string | null;
  if (trimmedCollector === "") {
    if (env === "production") {
      return { ok: false, code: "missing_collector_id" };
    }
    collectorId = null;
  } else if (!COLLECTOR_ID_RE.test(trimmedCollector)) {
    return { ok: false, code: "invalid_collector_id" };
  } else {
    collectorId = trimmedCollector;
  }

  return {
    ok: true,
    env,
    accessToken,
    webhookSecret,
    supabaseUrl,
    serviceRole,
    collectorId,
  };
}


// --- helpers ---------------------------------------------------------------

function ok(msg = "ok"): Response {
  return new Response(msg, { status: 200 });
}

function parseSigHeader(h: string | null): { ts: string; v1: string } | null {
  if (!h) return null;
  const parts = h.split(",").map((p) => p.trim());
  let ts = "", v1 = "";
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "ts") ts = v ?? "";
    else if (k === "v1") v1 = v ?? "";
  }
  return ts && v1 ? { ts, v1 } : null;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifySignature(
  req: Request,
  dataId: string,
  webhookSecret: string,
): Promise<"ok" | "missing" | "invalid"> {
  const parsed = parseSigHeader(req.headers.get("x-signature"));
  const requestId = req.headers.get("x-request-id") ?? "";
  if (!parsed) return "missing";
  const manifest = `id:${dataId};request-id:${requestId};ts:${parsed.ts};`;
  const expected = await hmacHex(webhookSecret, manifest);
  return timingSafeEq(expected, parsed.v1) ? "ok" : "invalid";
}

const MP_FETCH_TIMEOUT_MS = 5000;
const SUPABASE_FETCH_TIMEOUT_MS = 3000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal ?? null;
  let onExternalAbort: (() => void) | null = null;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (external) {
      if (external.aborted) {
        controller.abort();
      } else {
        onExternalAbort = () => controller.abort();
        external.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    const { signal: _ignored, ...rest } = init;
    void _ignored;
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch {
    throw new Error("fetch_failed");
  } finally {
    clearTimeout(timer);
    if (external && onExternalAbort) {
      external.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function sbFetch(
  cfg: Extract<WebhookConfig, { ok: true }>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", cfg.serviceRole);
  headers.set("Authorization", `Bearer ${cfg.serviceRole}`);
  headers.set("Content-Type", "application/json");
  return fetchWithTimeout(
    `${cfg.supabaseUrl}${path}`,
    { ...init, headers },
    SUPABASE_FETCH_TIMEOUT_MS,
  );
}

async function sbRpc(
  cfg: Extract<WebhookConfig, { ok: true }>,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const r = await sbFetch(cfg, `/rest/v1/rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`rpc ${fn} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json().catch(() => null);
}

function mapStatus(mp: string | null | undefined): string | null {
  switch (mp) {
    case "approved":
      return "approved";
    case "pending":
    case "in_process":
    case "authorized":
      return "pending";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    default:
      return null;
  }
}

// --- processing -----------------------------------------------------------

type ReservationResult =
  | { result: "reserved"; eventId: string }
  | { result: "duplicate" }
  | { result: "in_progress" };

const UUID_RESERVE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reserveWebhookDelivery(
  cfg: Extract<WebhookConfig, { ok: true }>,
  args: {
    deliveryId: string;
    requestId: string;
    type: string;
    action: string;
    paymentId: string;
  },
): Promise<ReservationResult> {
  let raw: unknown;
  try {
    raw = await sbRpc(cfg, "reserve_webhook_delivery", {
      p_provider: "mercadopago",
      p_delivery_id: args.deliveryId,
      p_request_id: args.requestId || null,
      p_type: args.type || "",
      p_action: args.action || "",
      p_payment_id: args.paymentId,
    });
  } catch {
    throw new Error("webhook_reservation_failed");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("webhook_reservation_failed");
  }
  const r = raw as {
    ok?: boolean;
    code?: string;
    event_id?: unknown;
  };
  if (r.ok === true && r.code === "reserved") {
    const id = r.event_id;
    if (typeof id !== "string" || !UUID_RESERVE_RE.test(id)) {
      throw new Error("webhook_reservation_failed");
    }
    return { result: "reserved", eventId: id };
  }
  if (r.ok === false && r.code === "duplicate") return { result: "duplicate" };
  if (r.ok === false && r.code === "in_progress") return { result: "in_progress" };
  throw new Error("webhook_reservation_failed");
}

type ProcessResult = "applied" | "transient";

type TransientTag =
  | "mp_network"
  | "mp_http"
  | "mp_invalid_json"
  | "unsupported_status"
  | "missing_order_reference"
  | "invalid_order_reference"
  | "attempts_lookup"
  | "missing_attempt"
  | "apply_rpc"
  | "apply_unexpected"
  | "payment_id_mismatch"
  | "unexpected";

async function markEventTransient(
  cfg: Extract<WebhookConfig, { ok: true }>,
  eventId: string,
  tag: TransientTag,
): Promise<void> {
  try {
    const response = await sbFetch(
      cfg,
      `/rest/v1/payment_events?id=eq.${eventId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "failed",
          processing_result: `transient:${tag}`,
          last_error: null,
        }),
      },
    );
    if (!response.ok) {
      throw new Error("event_mark_failed");
    }
  } catch {
    throw new Error("event_mark_failed");
  }
}

async function markEventProcessed(
  cfg: Extract<WebhookConfig, { ok: true }>,
  eventId: string,
  orderId: string,
  processingResult: string,
  rawPayload: unknown,
): Promise<void> {
  try {
    const response = await sbFetch(
      cfg,
      `/rest/v1/payment_events?id=eq.${eventId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "processed",
          processed_at: new Date().toISOString(),
          processing_result: processingResult,
          last_error: null,
          order_id: orderId,
          payload: rawPayload ?? {},
        }),
      },
    );
    if (!response.ok) {
      throw new Error("event_close_failed");
    }
  } catch {
    throw new Error("event_close_failed");
  }
}

const CANONICAL_RECONCILE_REASONS = new Set<string>([
  "missing_payment_id",
  "unknown_status",
  "attempt_state_incompatible",
  "external_reference_mismatch",
  "metadata_order_mismatch",
  "metadata_attempt_mismatch",
  "amount_mismatch",
  "currency_mismatch",
  "environment_mismatch",
  "payment_type_not_allowed",
  "collector_mismatch",
  "attempt_payment_id_mismatch",
  "payment_id_reused",
  "unexpected_transition",
]);

async function processPayment(
  cfg: Extract<WebhookConfig, { ok: true }>,
  paymentId: string,
  eventId: string,
  _rawPayload: unknown,
): Promise<ProcessResult> {
  try {
    // 2) Fetch canonical payment from MP.
    let mpRes: Response;
    try {
      mpRes = await fetchWithTimeout(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        { headers: { Authorization: `Bearer ${cfg.accessToken}` } },
        MP_FETCH_TIMEOUT_MS,
      );
    } catch {
      await markEventTransient(cfg, eventId, "mp_network");
      return "transient";
    }
    if (!mpRes.ok) {
      await markEventTransient(cfg, eventId, "mp_http");
      return "transient";
    }
    let payment: Record<string, unknown>;
    try {
      payment = (await mpRes.json()) as Record<string, unknown>;
    } catch {
      await markEventTransient(cfg, eventId, "mp_invalid_json");
      return "transient";
    }

    // Canonical payment id (must match notification data.id).
    const rawId = (payment as any).id;
    let canonicalPaymentId = "";
    if (typeof rawId === "string") canonicalPaymentId = rawId;
    else if (typeof rawId === "number" && Number.isFinite(rawId)) {
      canonicalPaymentId = String(rawId);
    }
    if (!canonicalPaymentId || canonicalPaymentId !== paymentId) {
      await markEventTransient(cfg, eventId, "payment_id_mismatch");
      return "transient";
    }

    const mpStatus = typeof payment.status === "string" ? payment.status : "";
    const statusDetail =
      typeof payment.status_detail === "string" ? payment.status_detail : null;

    const rawLiveMode = (payment as any).live_mode;
    const liveMode: boolean | null =
      typeof rawLiveMode === "boolean" ? rawLiveMode : null;

    const rawAmount = (payment as any).transaction_amount;
    const transactionAmount: number | null =
      typeof rawAmount === "number" && Number.isFinite(rawAmount)
        ? rawAmount
        : null;

    const currencyId =
      typeof payment.currency_id === "string" ? payment.currency_id : null;

    const externalReference =
      typeof payment.external_reference === "string"
        ? payment.external_reference
        : null;

    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
    const rawMetaOrder =
      typeof metadata.order_id === "string"
        ? metadata.order_id
        : typeof (metadata as any).orderId === "string"
          ? (metadata as any).orderId
          : null;
    const metadataOrderId: string | null = rawMetaOrder;

    const rawMetaAttempt =
      typeof (metadata as any).payment_attempt_id === "string"
        ? (metadata as any).payment_attempt_id
        : typeof (metadata as any).attempt_id === "string"
          ? (metadata as any).attempt_id
          : typeof (metadata as any).attemptId === "string"
            ? (metadata as any).attemptId
            : null;
    const metadataAttemptId: string | null = rawMetaAttempt;

    const paymentTypeId =
      typeof (payment as any).payment_type_id === "string"
        ? ((payment as any).payment_type_id as string)
        : null;

    const rawCollector = (payment as any).collector_id;
    let collectorId: string | null = null;
    if (typeof rawCollector === "string" && /^[0-9]+$/.test(rawCollector)) {
      collectorId = rawCollector;
    } else if (
      typeof rawCollector === "number" &&
      Number.isFinite(rawCollector) &&
      Number.isInteger(rawCollector) &&
      rawCollector >= 0
    ) {
      collectorId = String(rawCollector);
    }

    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // 3) Resolve orderId for lookup — send both original values to the RPC.
    let orderId: string | null = null;
    const extRefIsUuid = !!externalReference && UUID_RE.test(externalReference);
    const metaOrderIsUuid = !!metadataOrderId && UUID_RE.test(metadataOrderId);
    if (extRefIsUuid) {
      orderId = externalReference!;
    } else if (metaOrderIsUuid) {
      orderId = metadataOrderId!;
    } else if (!externalReference && !metadataOrderId) {
      await markEventTransient(cfg, eventId, "missing_order_reference");
      return "transient";
    } else {
      await markEventTransient(cfg, eventId, "invalid_order_reference");
      return "transient";
    }

    // 4) Resolve attemptId: metadata first, else safe lookup.
    let attemptId: string | null = null;
    if (metadataAttemptId && UUID_RE.test(metadataAttemptId)) {
      attemptId = metadataAttemptId;
    } else {
      let q: Response;
      try {
        q = await sbFetch(
          cfg,
          `/rest/v1/payment_attempts?select=id,status,created_at&order_id=eq.${orderId}&or=(mercado_pago_payment_id.eq.${paymentId},status.in.(processing,pending,awaiting_reconciliation))&order=created_at.desc&limit=1`,
        );
      } catch {
        await markEventTransient(cfg, eventId, "attempts_lookup");
        return "transient";
      }
      if (!q.ok) {
        await markEventTransient(cfg, eventId, "attempts_lookup");
        return "transient";
      }
      let rows: Array<{ id: string }> = [];
      try {
        rows = (await q.json()) as Array<{ id: string }>;
      } catch {
        await markEventTransient(cfg, eventId, "attempts_lookup");
        return "transient";
      }
      if (rows.length > 0 && typeof rows[0].id === "string" && UUID_RE.test(rows[0].id)) {
        attemptId = rows[0].id;
      }
    }
    if (!attemptId) {
      await markEventTransient(cfg, eventId, "missing_attempt");
      return "transient";
    }

    // 5) Refunded / charged_back → legacy RPC (canonical RPC does not support them).
    if (mpStatus === "refunded" || mpStatus === "charged_back") {
      const legacyMapped = mapStatus(mpStatus);
      if (!legacyMapped) {
        await markEventTransient(cfg, eventId, "unsupported_status");
        return "transient";
      }
      let applied: unknown;
      try {
        applied = await sbRpc(cfg, "apply_mercado_pago_webhook", {
          p_event_id: eventId,
          p_order_id: orderId,
          p_attempt_id: attemptId,
          p_mp_payment_id: canonicalPaymentId,
          p_new_status: legacyMapped,
          p_status_detail: statusDetail ?? "",
          p_processing_result: `mp:${mpStatus}`,
          p_payload: _rawPayload ?? {},
        });
      } catch {
        await markEventTransient(cfg, eventId, "apply_rpc");
        return "transient";
      }
      if (
        !applied ||
        typeof applied !== "object" ||
        (applied as any).ok !== true ||
        typeof (applied as any).applied_transition !== "boolean" ||
        typeof (applied as any).from !== "string" ||
        typeof (applied as any).to !== "string"
      ) {
        await markEventTransient(cfg, eventId, "apply_unexpected");
        return "transient";
      }
      // Legacy RPC already atomically closes payment_events.
      return "applied";
    }

    // 6) Canonical branch — all other statuses.
    let applied: unknown;
    try {
      applied = await sbRpc(cfg, "apply_mercado_pago_payment_response", {
        p_order_id: orderId,
        p_attempt_id: attemptId,
        p_payment_id: canonicalPaymentId,
        p_payment_status: mpStatus,
        p_status_detail: statusDetail,
        p_live_mode: liveMode,
        p_transaction_amount: transactionAmount,
        p_currency_id: currencyId,
        p_external_reference: externalReference,
        p_metadata_order_id: metadataOrderId,
        p_metadata_attempt_id: metadataAttemptId,
        p_payment_type_id: paymentTypeId,
        p_collector_id: collectorId,
        p_expected_collector_id: cfg.collectorId,
      });
    } catch {
      await markEventTransient(cfg, eventId, "apply_rpc");
      return "transient";
    }

    if (!applied || typeof applied !== "object") {
      await markEventTransient(cfg, eventId, "apply_unexpected");
      return "transient";
    }
    const r = applied as Record<string, unknown>;

    // Canonical success shape.
    if (
      r.ok === true &&
      typeof r.applied_transition === "boolean" &&
      typeof r.order_status === "string" &&
      typeof r.attempt_status === "string" &&
      typeof r.terminal === "boolean"
    ) {
      await markEventProcessed(cfg, eventId, orderId, `mp:${mpStatus}`, _rawPayload);
      return "applied";
    }

    // Canonical requires_reconciliation shape.
    if (
      r.ok === false &&
      r.code === "requires_reconciliation" &&
      typeof r.reason === "string" &&
      CANONICAL_RECONCILE_REASONS.has(r.reason)
    ) {
      await markEventProcessed(
        cfg,
        eventId,
        orderId,
        `reconcile:${r.reason}`,
        _rawPayload,
      );
      return "applied";
    }

    await markEventTransient(cfg, eventId, "apply_unexpected");
    return "transient";
  } catch (e) {
    if (e instanceof Error && e.message === "event_mark_failed") {
      throw e;
    }
    await markEventTransient(cfg, eventId, "unexpected");
    return "transient";
  }

}

// --- entrypoint -----------------------------------------------------------

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health checks — no credentials needed.
  if (req.method === "GET" || req.method === "HEAD") return ok();
  if (req.method !== "POST") return ok();

  // Fail-closed configuration check BEFORE any body parse / DB / MP / crypto work.
  const cfg = loadConfig();
  if (!cfg.ok) {
    console.warn("[mp-webhook] configuration_error", { code: cfg.code });
    return new Response("configuration unavailable", { status: 503 });
  }

  const rawBody = await req.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // Accept empty/ping.
  }

  const dataId = String(
    (payload as any)?.data?.id ??
      url.searchParams.get("data.id") ??
      url.searchParams.get("id") ??
      "",
  );
  const type = String(
    (payload as any)?.type ??
      (payload as any)?.topic ??
      url.searchParams.get("type") ??
      "",
  );
  const action = String((payload as any)?.action ?? "");
  const requestId = req.headers.get("x-request-id") ?? "";
  const deliveryId = requestId || `${type}:${dataId}:${Date.now()}`;

  // Signature is MANDATORY for any processable POST, including MP test delivery.
  const sig = await verifySignature(req, dataId, cfg.webhookSecret);
  if (sig !== "ok") {
    console.warn("[mp-webhook] signature rejected", { sig });
    return new Response("invalid signature", { status: 401 });
  }

  // MP test delivery — configuration + signature already validated above.
  if (dataId === "123456") {
    console.log("[mp-webhook] test delivery", { type, dataId });
    return ok();
  }

  // Only payment notifications carry a payment id we can fetch.
  if (!dataId || (type && type !== "payment" && type !== "payment.updated" && type !== "payment.created")) {
    console.log("[mp-webhook] non-payment or empty", { type, hasId: !!dataId });
    return ok();
  }

  // Atomic reservation MUST run inline: a failure returns 503 so MP retries.
  let reservation: ReservationResult;
  try {
    reservation = await reserveWebhookDelivery(cfg, {
      deliveryId,
      requestId,
      type,
      action,
      paymentId: dataId,
    });
  } catch {
    console.error("[mp-webhook] reservation failed webhook_reservation_failed");
    return new Response("temporarily unavailable", { status: 503 });
  }

  if (reservation.result === "duplicate") {
    console.log("[mp-webhook] duplicate delivery ignored");
    return ok();
  }
  if (reservation.result === "in_progress") {
    console.log("[mp-webhook] in-progress delivery deferred");
    return new Response("temporarily unavailable", { status: 503 });
  }

  const eventId = reservation.eventId;

  let processResult: ProcessResult;
  try {
    processResult = await processPayment(cfg, dataId, eventId, payload);
  } catch {
    console.error("[mp-webhook] processing failed before acknowledgement");
    return new Response("temporarily unavailable", { status: 503 });
  }

  if (processResult === "applied") {
    return ok();
  }
  return new Response("temporarily unavailable", { status: 503 });
});
