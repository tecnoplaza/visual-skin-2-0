// Handler for the internal Mercado Pago reconciler.
// Manual-only, single-attempt mode. Importing this module has zero side
// effects: no server, no fetch, no environment reads until handleRequest()
// is invoked.
//
// See index.ts for the entrypoint. No direct writes to custom_orders /
// payment_attempts / payment_events — the only mutation channel is the
// canonical RPC apply_mercado_pago_payment_response.

type MpEnv = "test" | "production";

type Cfg =
  | {
      ok: true;
      env: MpEnv;
      accessToken: string;
      collectorId: string | null;
      supabaseUrl: string;
      serviceRole: string;
    }
  | {
      ok: false;
      code:
        | "missing_environment"
        | "invalid_environment"
        | "missing_access_token"
        | "missing_supabase_config"
        | "missing_collector_id"
        | "invalid_collector_id";
    };

export interface ReconcileDependencies {
  fetchFn: typeof fetch;
  getEnv: (name: string) => string | undefined;
  now: () => Date;
  mercadoPagoTimeoutMs: number;
}

const COLLECTOR_ID_RE = /^[0-9]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MP_PAYMENT_ID_RE = /^[0-9]+$/;

const MIN_AGE_SECONDS = 120;
const DEFAULT_MP_TIMEOUT_MS = 10_000;
const SB_TIMEOUT_MS = 3_000;
const EXECUTE_CONFIRMATION = "EXECUTE_ONE_RECONCILIATION";

function resolveDeps(
  overrides?: Partial<ReconcileDependencies>,
): ReconcileDependencies {
  return {
    fetchFn: overrides?.fetchFn ?? ((input, init) => globalThis.fetch(input, init)),
    getEnv: overrides?.getEnv ?? ((name) => Deno.env.get(name)),
    now: overrides?.now ?? (() => new Date()),
    mercadoPagoTimeoutMs:
      overrides?.mercadoPagoTimeoutMs ?? DEFAULT_MP_TIMEOUT_MS,
  };
}

function loadConfig(getEnv: (name: string) => string | undefined): Cfg {
  const rawEnv = getEnv("MERCADOPAGO_ENV");
  if (!rawEnv || rawEnv.trim() === "") {
    return { ok: false, code: "missing_environment" };
  }
  const envNorm = rawEnv.trim().toLowerCase();
  if (envNorm !== "test" && envNorm !== "production") {
    return { ok: false, code: "invalid_environment" };
  }
  const env = envNorm as MpEnv;

  const accessToken =
    env === "production"
      ? getEnv("MERCADOPAGO_ACCESS_TOKEN_PRODUCTION")
      : getEnv("MERCADOPAGO_ACCESS_TOKEN_TEST");
  if (!accessToken || accessToken.trim() === "") {
    return { ok: false, code: "missing_access_token" };
  }

  const supabaseUrl = getEnv("SUPABASE_URL") ?? "";
  const serviceRole = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return { ok: false, code: "missing_supabase_config" };
  }

  const rawCollector =
    env === "production"
      ? getEnv("MERCADOPAGO_COLLECTOR_ID_PRODUCTION")
      : getEnv("MERCADOPAGO_COLLECTOR_ID_TEST");
  const trimmed = typeof rawCollector === "string" ? rawCollector.trim() : "";
  let collectorId: string | null;
  if (trimmed === "") {
    if (env === "production") {
      return { ok: false, code: "missing_collector_id" };
    }
    collectorId = null;
  } else if (!COLLECTOR_ID_RE.test(trimmed)) {
    return { ok: false, code: "invalid_collector_id" };
  } else {
    collectorId = trimmed;
  }

  return { ok: true, env, accessToken, collectorId, supabaseUrl, serviceRole };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const BEARER_RE = /^Bearer\s+(\S+)$/i;

type AuthCheck = { ok: true } | { ok: false; status: 401 | 403 };

// Bearer parser accepts single/multiple spaces or tabs between the scheme
// and the token; rejects empty token, trailing content, or interior spaces.
export function checkAuth(req: Request, serviceRole: string): AuthCheck {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return { ok: false, status: 401 };
  const match = h.trim().match(BEARER_RE);
  if (!match) return { ok: false, status: 401 };
  const token = match[1];
  if (!token) return { ok: false, status: 401 };
  return timingSafeEq(token, serviceRole)
    ? { ok: true }
    : { ok: false, status: 403 };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sbFetch(
  deps: ReconcileDependencies,
  cfg: Extract<Cfg, { ok: true }>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", cfg.serviceRole);
  headers.set("Authorization", `Bearer ${cfg.serviceRole}`);
  headers.set("Content-Type", "application/json");
  return fetchWithTimeout(
    deps.fetchFn,
    `${cfg.supabaseUrl}${path}`,
    { ...init, headers },
    SB_TIMEOUT_MS,
  );
}

type Candidate = {
  id: string;
  order_id: string;
  mercado_pago_payment_id: string;
  status: string;
  payment_environment: string;
  created_at: string;
  payment_flow?: string;
  mercadopago_preference_id?: string | null;
};

// -------------------- Manual body validation --------------------

type BodyValidation =
  | { ok: true; action: "preview" | "execute"; attemptId: string; environment: MpEnv }
  | { ok: false; status: number; code: string };

function validateManualBody(raw: unknown, cfg: Extract<Cfg, { ok: true }>): BodyValidation {
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return { ok: false, status: 400, code: "invalid_request_body" };
  }
  const body = raw as Record<string, unknown>;

  const mode = body.mode;
  if (mode !== "manual") {
    return { ok: false, status: 400, code: "manual_mode_required" };
  }

  const action = body.action;
  if (action !== "preview" && action !== "execute") {
    return { ok: false, status: 400, code: "invalid_action" };
  }

  const attemptId = body.attempt_id;
  if (typeof attemptId !== "string" || !UUID_RE.test(attemptId)) {
    return { ok: false, status: 400, code: "invalid_attempt_id" };
  }

  const environment = body.environment;
  if (
    typeof environment !== "string" ||
    (environment !== "test" && environment !== "production") ||
    environment !== cfg.env
  ) {
    return { ok: false, status: 409, code: "environment_confirmation_mismatch" };
  }

  if (action === "execute") {
    const confirmation = body.confirmation;
    if (confirmation !== EXECUTE_CONFIRMATION) {
      return { ok: false, status: 400, code: "execution_confirmation_required" };
    }
  }

  return {
    ok: true,
    action,
    attemptId,
    environment: environment as MpEnv,
  };
}

// -------------------- Manual candidate selection (id=eq, limit=1) --------------------

type CandidateLookup =
  | { ok: true; rows: unknown[] }
  | { ok: false; status: number; code: string };

async function selectManualCandidate(
  attemptId: string,
  cfg: Extract<Cfg, { ok: true }>,
  deps: ReconcileDependencies,
): Promise<CandidateLookup> {
  const cutoff = new Date(
    deps.now().getTime() - MIN_AGE_SECONDS * 1000,
  ).toISOString();
  const qs = new URLSearchParams({
    select:
      "id,order_id,mercado_pago_payment_id,status,payment_environment,created_at,payment_flow,mercadopago_preference_id",
    id: `eq.${attemptId}`,
    status: "in.(awaiting_reconciliation,processing,pending)",
    payment_environment: `eq.${cfg.env}`,
    mercado_pago_payment_id: "not.is.null",
    created_at: `lt.${cutoff}`,
    order: "created_at.asc",
    limit: "1",
  });

  let r: Response;
  try {
    r = await sbFetch(deps, cfg, `/rest/v1/payment_attempts?${qs.toString()}`);
  } catch {
    return { ok: false, status: 503, code: "candidates_lookup_failed" };
  }
  if (!r.ok) {
    return { ok: false, status: 503, code: "candidates_lookup_failed" };
  }
  let parsed: unknown;
  try {
    parsed = await r.json();
  } catch {
    return { ok: false, status: 503, code: "candidates_lookup_failed" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, status: 503, code: "candidates_lookup_failed" };
  }
  return { ok: true, rows: parsed };
}

function isEligibleCandidate(
  row: unknown,
  attemptId: string,
  cfg: Extract<Cfg, { ok: true }>,
  now: Date,
): row is Candidate {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id !== attemptId || !UUID_RE.test(r.id)) return false;
  if (typeof r.order_id !== "string" || !UUID_RE.test(r.order_id)) return false;
  if (
    r.status !== "awaiting_reconciliation" &&
    r.status !== "processing" &&
    r.status !== "pending"
  ) return false;
  if (r.payment_environment !== cfg.env) return false;
  if (typeof r.mercado_pago_payment_id !== "string") return false;
  const mp = r.mercado_pago_payment_id.trim();
  if (mp === "" || !MP_PAYMENT_ID_RE.test(mp)) return false;
  if (typeof r.created_at !== "string") return false;
  const created = Date.parse(r.created_at);
  if (!Number.isFinite(created)) return false;
  if (now.getTime() - created < MIN_AGE_SECONDS * 1000) return false;
  return true;
}

// -------------------- MP + RPC helpers (single-shot) --------------------

async function rpcApply(
  deps: ReconcileDependencies,
  cfg: Extract<Cfg, { ok: true }>,
  args: Record<string, unknown>,
  checkoutPro = false,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const r = await sbFetch(
    deps,
    cfg,
    `/rest/v1/rpc/${checkoutPro ? "apply_checkout_pro_snapshot_payment_v1" : "apply_mercado_pago_payment_response"}`,
    { method: "POST", body: JSON.stringify(args) },
  );
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, body: await r.json().catch(() => null) };
}

type ExecuteCounters = {
  processed: number;
  reconciled: number;
  deferred: number;
  not_found: number;
  rpc_failed: number;
  payload_invalid: number;
  skipped_unsupported_status: number;
};

function zeroCounters(): ExecuteCounters {
  return {
    processed: 0,
    reconciled: 0,
    deferred: 0,
    not_found: 0,
    rpc_failed: 0,
    payload_invalid: 0,
    skipped_unsupported_status: 0,
  };
}

type ExecuteOutcome =
  | { kind: "ok"; counters: ExecuteCounters; stoppedReason: string | null }
  | { kind: "auth_error"; counters: ExecuteCounters; status: 401 | 403 };

async function executeSingle(
  candidate: Candidate,
  cfg: Extract<Cfg, { ok: true }>,
  deps: ReconcileDependencies,
): Promise<ExecuteOutcome> {
  const counters = zeroCounters();
  const mpId = candidate.mercado_pago_payment_id.trim();

  let mpRes: Response;
  try {
    mpRes = await fetchWithTimeout(
      deps.fetchFn,
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(mpId)}`,
      { headers: { Authorization: `Bearer ${cfg.accessToken}` } },
      deps.mercadoPagoTimeoutMs,
    );
  } catch {
    counters.deferred += 1;
    console.warn("[mp-reconcile] mp_network", { attempt: candidate.id });
    return { kind: "ok", counters, stoppedReason: "mp_network" };
  }

  if (mpRes.status === 401 || mpRes.status === 403) {
    console.error("[mp-reconcile] mp_auth_error", { status: mpRes.status });
    return { kind: "auth_error", counters, status: mpRes.status as 401 | 403 };
  }
  if (mpRes.status === 429) {
    counters.deferred += 1;
    console.warn("[mp-reconcile] mp_rate_limited");
    return { kind: "ok", counters, stoppedReason: "mp_rate_limited" };
  }
  if (mpRes.status === 404) {
    counters.not_found += 1;
    console.warn("[mp-reconcile] mp_not_found", { attempt: candidate.id });
    return { kind: "ok", counters, stoppedReason: null };
  }
  if (mpRes.status >= 500) {
    counters.deferred += 1;
    console.warn("[mp-reconcile] mp_5xx", {
      attempt: candidate.id,
      status: mpRes.status,
    });
    return { kind: "ok", counters, stoppedReason: null };
  }
  if (!mpRes.ok) {
    counters.deferred += 1;
    console.warn("[mp-reconcile] mp_http", {
      attempt: candidate.id,
      status: mpRes.status,
    });
    return { kind: "ok", counters, stoppedReason: null };
  }

  let payment: Record<string, unknown>;
  try {
    payment = (await mpRes.json()) as Record<string, unknown>;
  } catch {
    counters.payload_invalid += 1;
    console.warn("[mp-reconcile] mp_invalid_json", { attempt: candidate.id });
    return { kind: "ok", counters, stoppedReason: null };
  }

  const rawId = payment.id;
  let canonicalPaymentId = "";
  if (typeof rawId === "string") canonicalPaymentId = rawId;
  else if (typeof rawId === "number" && Number.isFinite(rawId)) {
    canonicalPaymentId = String(rawId);
  }
  if (!canonicalPaymentId || canonicalPaymentId !== mpId) {
    counters.payload_invalid += 1;
    console.warn("[mp-reconcile] payment_id_mismatch", { attempt: candidate.id });
    return { kind: "ok", counters, stoppedReason: null };
  }

  const mpStatus = typeof payment.status === "string" ? payment.status : "";
  if (mpStatus === "refunded" || mpStatus === "charged_back") {
    counters.skipped_unsupported_status += 1;
    console.log("[mp-reconcile] skipped_unsupported_status", {
      attempt: candidate.id,
      status: mpStatus,
    });
    return { kind: "ok", counters, stoppedReason: null };
  }

  const statusDetail =
    typeof payment.status_detail === "string" ? payment.status_detail : null;
  const rawLiveMode = payment.live_mode;
  const liveMode: boolean | null =
    typeof rawLiveMode === "boolean" ? rawLiveMode : null;
  const rawAmount = payment.transaction_amount;
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
  const metaOrder =
    typeof metadata.order_id === "string"
      ? metadata.order_id
      : typeof (metadata as { orderId?: unknown }).orderId === "string"
        ? (metadata as { orderId: string }).orderId
        : null;
  const metaAttempt =
    typeof (metadata as { payment_attempt_id?: unknown }).payment_attempt_id ===
    "string"
      ? (metadata as { payment_attempt_id: string }).payment_attempt_id
      : typeof (metadata as { attempt_id?: unknown }).attempt_id === "string"
        ? (metadata as { attempt_id: string }).attempt_id
        : typeof (metadata as { attemptId?: unknown }).attemptId === "string"
          ? (metadata as { attemptId: string }).attemptId
          : null;

  const paymentTypeId =
    typeof payment.payment_type_id === "string"
      ? payment.payment_type_id
      : null;
  const preferenceId =
    typeof payment.preference_id === "string" ? payment.preference_id : null;

  const rawCollector = payment.collector_id;
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

  const isCheckoutPro = candidate.payment_flow === "checkout_pro";
  const applied = await rpcApply(deps, cfg, {
    p_order_id: candidate.order_id,
    p_attempt_id: candidate.id,
    p_payment_id: canonicalPaymentId,
    ...(isCheckoutPro ? { p_preference_id: preferenceId } : {}),
    p_payment_status: mpStatus,
    p_status_detail: statusDetail,
    p_live_mode: liveMode,
    p_transaction_amount: transactionAmount,
    p_currency_id: currencyId,
    p_external_reference: externalReference,
    p_metadata_order_id: metaOrder,
    p_metadata_attempt_id: metaAttempt,
    p_payment_type_id: paymentTypeId,
    p_collector_id: collectorId,
    p_expected_collector_id: cfg.collectorId,
  }, isCheckoutPro);

  if (!applied.ok) {
    counters.rpc_failed += 1;
    console.error("[mp-reconcile] rpc_failed", {
      attempt: candidate.id,
      status: applied.status,
    });
    return { kind: "ok", counters, stoppedReason: null };
  }

  const r = applied.body as Record<string, unknown> | null;
  if (!r || typeof r !== "object") {
    counters.rpc_failed += 1;
    return { kind: "ok", counters, stoppedReason: null };
  }
  if (r.ok === true) {
    counters.processed += 1;
    console.log("[mp-reconcile] applied", {
      attempt: candidate.id,
      mp_status: mpStatus,
      order_status: r.order_status,
      attempt_status: r.attempt_status,
    });
  } else if (r.ok === false && r.code === "requires_reconciliation") {
    counters.reconciled += 1;
    console.log("[mp-reconcile] requires_reconciliation", {
      attempt: candidate.id,
      reason: r.reason,
    });
  } else {
    counters.rpc_failed += 1;
    console.warn("[mp-reconcile] rpc_unexpected", { attempt: candidate.id });
  }
  return { kind: "ok", counters, stoppedReason: null };
}

// -------------------- handleRequest --------------------

function maskPaymentId(mpId: string): string {
  if (mpId.length >= 4) return mpId.slice(-4);
  return "****";
}

export async function handleRequest(
  request: Request,
  dependencies?: Partial<ReconcileDependencies>,
): Promise<Response> {
  const deps = resolveDeps(dependencies);
  const started = deps.now().getTime();

  // 1. Method
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }

  // 2. Configuration
  const cfg = loadConfig(deps.getEnv);
  if (!cfg.ok) {
    console.warn("[mp-reconcile] configuration_error", { code: cfg.code });
    return jsonResponse({ ok: false, error: "configuration_unavailable" }, 503);
  }

  // 3. Authorization
  const auth = checkAuth(request, cfg.serviceRole);
  if (!auth.ok) {
    return new Response(auth.status === 401 ? "unauthorized" : "forbidden", {
      status: auth.status,
      headers: { "cache-control": "no-store" },
    });
  }

  // 4-5. Read + parse body
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.trim() === "") {
      return jsonResponse({ ok: false, error: "invalid_request_body" }, 400);
    }
    raw = JSON.parse(text);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_request_body" }, 400);
  }

  // 6-10. Manual contract validation
  const v = validateManualBody(raw, cfg);
  if (!v.ok) {
    return jsonResponse({ ok: false, error: v.code }, v.status);
  }

  console.log("[mp-reconcile] request", {
    mode: "manual",
    action: v.action,
    attempt: v.attemptId,
    env: cfg.env,
  });

  // 11. Manual candidate lookup (single UUID, limit=1)
  const lookup = await selectManualCandidate(v.attemptId, cfg, deps);
  if (!lookup.ok) {
    console.error("[mp-reconcile] candidates_error", { code: lookup.code });
    return jsonResponse({ ok: false, error: lookup.code }, lookup.status);
  }
  if (lookup.rows.length > 1) {
    console.error("[mp-reconcile] unexpected_candidate_count", {
      count: lookup.rows.length,
    });
    return jsonResponse(
      { ok: false, error: "unexpected_candidate_count" },
      500,
    );
  }
  if (lookup.rows.length === 0) {
    return jsonResponse({ ok: false, error: "attempt_not_eligible" }, 404);
  }

  const row = lookup.rows[0];
  const now = deps.now();
  if (!isEligibleCandidate(row, v.attemptId, cfg, now)) {
    return jsonResponse({ ok: false, error: "attempt_not_eligible" }, 404);
  }
  const candidate = row;
  const mpId = candidate.mercado_pago_payment_id.trim();
  const ageSeconds = Math.floor(
    (now.getTime() - Date.parse(candidate.created_at)) / 1000,
  );

  // 12a. Preview — no MP, no RPC.
  if (v.action === "preview") {
    console.log("[mp-reconcile] preview_only", {
      attempt: candidate.id,
      env: cfg.env,
      mode: "manual",
    });
    return jsonResponse({
      ok: true,
      mode: "manual",
      action: "preview",
      environment: cfg.env,
      eligible: true,
      candidate_count: 1,
      max_candidates: 1,
      attempt: {
        attempt_id: candidate.id,
        status: candidate.status,
        age_seconds: ageSeconds,
        has_payment_id: true,
        payment_id_suffix: maskPaymentId(mpId),
      },
      mercado_pago_called: false,
      rpc_called: false,
      duration_ms: deps.now().getTime() - started,
    });
  }

  // 12b. Execute — single MP fetch + at most one RPC call.
  const outcome = await executeSingle(candidate, cfg, deps);
  if (outcome.kind === "auth_error") {
    return jsonResponse(
      {
        ok: false,
        mode: "manual",
        action: "execute",
        environment: cfg.env,
        error: "mp_auth_error",
        candidate_count: 1,
        max_candidates: 1,
        ...outcome.counters,
        duration_ms: deps.now().getTime() - started,
      },
      503,
    );
  }
  const duration_ms = deps.now().getTime() - started;
  console.log("[mp-reconcile] end", {
    env: cfg.env,
    action: "execute",
    duration_ms,
    ...outcome.counters,
  });
  return jsonResponse({
    ok: true,
    mode: "manual",
    action: "execute",
    environment: cfg.env,
    candidate_count: 1,
    max_candidates: 1,
    ...outcome.counters,
    stopped_reason: outcome.stoppedReason,
    duration_ms,
  });
}
