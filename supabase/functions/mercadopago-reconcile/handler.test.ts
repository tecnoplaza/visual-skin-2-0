// Local mock-based tests for the Mercado Pago reconciler handler.
// No real network, no real secrets, no real Supabase, no real MP.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkAuth, handleRequest, type ReconcileDependencies } from "./handler.ts";

const SERVICE_ROLE = "test-service-role-key";

const ENV_FIXTURE: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
  MERCADOPAGO_ENV: "test",
  MERCADOPAGO_ACCESS_TOKEN_TEST: "test-mp-access-token",
  MERCADOPAGO_COLLECTOR_ID_TEST: "123456",
};

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID_2 = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const MP_ID = "999888777";
const NOW = new Date("2026-07-07T12:00:00.000Z");
const OLD_ISO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const FRESH_ISO = new Date(NOW.getTime() - 30_000).toISOString();

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    order_id: ORDER_ID,
    mercado_pago_payment_id: MP_ID,
    status: "awaiting_reconciliation",
    payment_environment: "test",
    created_at: OLD_ISO,
    ...overrides,
  };
}

// deno-lint-ignore no-explicit-any
type AnyInit = any;

type RecordedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

type Route = {
  match: (url: URL, init: AnyInit) => boolean;
  respond: (
    url: URL,
    init: AnyInit,
    call: RecordedCall,
  ) => Response | Promise<Response>;
};

type FetchState = {
  calls: RecordedCall[];
  routes: Route[];
  unmatched: number;
};

function makeFetch(state: FetchState): typeof fetch {
  // deno-lint-ignore no-explicit-any
  return (async (input: any, init: AnyInit) => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const method = ((init?.method ?? "GET") + "").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    }
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body == null
          ? null
          : String(init.body);
    const call: RecordedCall = { url: url.toString(), method, headers, body };
    state.calls.push(call);

    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    for (const r of state.routes) {
      if (r.match(url, init ?? {})) {
        return await r.respond(url, init ?? {}, call);
      }
    }
    state.unmatched += 1;
    throw new Error(`unmatched_fetch:${method} ${url}`);
  }) as typeof fetch;
}

function baseDeps(
  routes: Route[],
  envOverrides: Record<string, string | undefined> = {},
  extra: Partial<ReconcileDependencies> = {},
): { deps: Partial<ReconcileDependencies>; state: FetchState } {
  const state: FetchState = { calls: [], routes, unmatched: 0 };
  const env: Record<string, string> = { ...ENV_FIXTURE };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const deps: Partial<ReconcileDependencies> = {
    fetchFn: makeFetch(state),
    getEnv: (name) => env[name],
    now: () => NOW,
    mercadoPagoTimeoutMs: 5_000,
    ...extra,
  };
  return { deps, state };
}

function jsonReq(
  body: unknown,
  headers: Record<string, string> = {
    Authorization: `Bearer ${SERVICE_ROLE}`,
  },
  method = "POST",
): Request {
  return new Request("https://example.test/", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function rawReq(
  body: string | null,
  headers: Record<string, string> = {
    Authorization: `Bearer ${SERVICE_ROLE}`,
  },
  method = "POST",
): Request {
  return new Request("https://example.test/", {
    method,
    headers,
    body: body ?? undefined,
  });
}

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: "manual",
    action: "preview",
    attempt_id: ATTEMPT_ID,
    environment: "test",
    ...overrides,
  };
}

function executeBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: "manual",
    action: "execute",
    attempt_id: ATTEMPT_ID,
    environment: "test",
    confirmation: "EXECUTE_ONE_RECONCILIATION",
    ...overrides,
  };
}

function candidatesRoute(payload: unknown, status = 200): Route {
  return {
    match: (u, i) =>
      u.pathname.endsWith("/rest/v1/payment_attempts") &&
      ((i.method ?? "GET") + "").toUpperCase() === "GET",
    respond: () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

function candidatesRouteRaw(bodyText: string, status = 200): Route {
  return {
    match: (u, i) =>
      u.pathname.endsWith("/rest/v1/payment_attempts") &&
      ((i.method ?? "GET") + "").toUpperCase() === "GET",
    respond: () =>
      new Response(bodyText, {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

function mpRoute(
  mpId: string,
  respond: (call: RecordedCall) => Response | Promise<Response>,
): Route {
  return {
    match: (u) =>
      u.host === "api.mercadopago.com" &&
      u.pathname === `/v1/payments/${mpId}`,
    respond: (_u, _i, call) => respond(call),
  };
}

function rpcRoute(
  respond: (
    args: Record<string, unknown>,
    call: RecordedCall,
  ) => Response | Promise<Response>,
): Route {
  return {
    match: (u, i) =>
      u.pathname.endsWith("/rest/v1/rpc/apply_mercado_pago_payment_response") &&
      ((i.method ?? "GET") + "").toUpperCase() === "POST",
    respond: (_u, _i, call) => {
      const args = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {};
      return respond(args, call);
    },
  };
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}

function countCalls(state: FetchState, predicate: (c: RecordedCall) => boolean): number {
  return state.calls.filter(predicate).length;
}
function mpCalls(state: FetchState): number {
  return countCalls(state, (c) => new URL(c.url).host === "api.mercadopago.com");
}
function rpcCalls(state: FetchState): number {
  return countCalls(state, (c) =>
    new URL(c.url).pathname.endsWith(
      "/rest/v1/rpc/apply_mercado_pago_payment_response",
    ),
  );
}
function sbAttemptGet(state: FetchState): RecordedCall | undefined {
  return state.calls.find(
    (c) =>
      new URL(c.url).pathname.endsWith("/rest/v1/payment_attempts") &&
      c.method === "GET",
  );
}
function nonGetSupabaseCalls(state: FetchState): RecordedCall[] {
  return state.calls.filter((c) => {
    const u = new URL(c.url);
    if (u.host !== "example.supabase.co") return false;
    const p = u.pathname;
    const isProtected =
      p.endsWith("/rest/v1/custom_orders") ||
      p.endsWith("/rest/v1/payment_attempts") ||
      p.endsWith("/rest/v1/payment_events");
    return isProtected && c.method !== "GET";
  });
}

// -------------------- A. Method + Authorization --------------------

Deno.test("A: GET rejected 405, no fetch", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(
    new Request("https://x/", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("allow"), "POST");
  assertEquals(state.calls.length, 0);
});

Deno.test("A: authorization scheme parsing (incl. multi-space)", async () => {
  const cases: Array<{ header: string | undefined; expected: number | "ok" }> = [
    { header: undefined, expected: 401 },
    { header: "Basic dGVzdA==", expected: 401 },
    { header: "Bearer", expected: 401 },
    { header: "Bearer ", expected: 401 },
    { header: `Bearer wrong-token`, expected: 403 },
    { header: `Bearer ${SERVICE_ROLE}`, expected: "ok" },
    { header: `bearer ${SERVICE_ROLE}`, expected: "ok" },
    { header: `Bearer  ${SERVICE_ROLE}`, expected: "ok" },
    { header: `Bearer\t${SERVICE_ROLE}`, expected: "ok" },
  ];
  for (const { header, expected } of cases) {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate()]),
    ]);
    const h: Record<string, string> = header === undefined ? {} : { Authorization: header };
    const res = await handleRequest(jsonReq(previewBody(), h), deps);
    if (expected === "ok") {
      // Continues past auth into body validation → preview eligible → 200
      assertEquals(res.status, 200, `expected 200 for header: ${header}`);
    } else {
      assertEquals(res.status, expected, `header: ${header}`);
      // No side-effects when auth fails.
      assertEquals(mpCalls(state), 0);
      assertEquals(rpcCalls(state), 0);
    }
  }
});

Deno.test("A: checkAuth pure function", () => {
  const mk = (h?: string) =>
    new Request("https://x/", {
      method: "POST",
      headers: h ? { Authorization: h } : {},
    });
  assertEquals(checkAuth(mk(), SERVICE_ROLE).ok, false);
  assertEquals(checkAuth(mk(`Bearer ${SERVICE_ROLE}`), SERVICE_ROLE).ok, true);
  const r = checkAuth(mk("Bearer wrong"), SERVICE_ROLE);
  assert(!r.ok);
  assertEquals(r.ok === false && r.status, 403);
});

// -------------------- B. Configuration --------------------

Deno.test("B: missing MERCADOPAGO_ENV -> 503", async () => {
  const { deps } = baseDeps([], { MERCADOPAGO_ENV: undefined });
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 503);
  const body = await readJson(res);
  assertEquals(body.error, "configuration_unavailable");
});

Deno.test("B: invalid env / missing token / test does not use prod creds", async () => {
  for (const overrides of [
    { MERCADOPAGO_ENV: "staging" },
    { MERCADOPAGO_ACCESS_TOKEN_TEST: undefined },
    {
      MERCADOPAGO_ACCESS_TOKEN_TEST: undefined,
      MERCADOPAGO_ACCESS_TOKEN_PRODUCTION: "prod-token",
    },
  ]) {
    const { deps } = baseDeps([], overrides);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 503);
  }
});

// -------------------- C. Body validation --------------------

Deno.test("C: empty body -> 400 invalid_request_body", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(rawReq(""), deps);
  assertEquals(res.status, 400);
  const body = await readJson(res);
  assertEquals(body.error, "invalid_request_body");
  assertEquals(state.calls.length, 0);
});

Deno.test("C: invalid JSON -> 400", async () => {
  const { deps } = baseDeps([]);
  const res = await handleRequest(rawReq("not-json{"), deps);
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "invalid_request_body");
});

Deno.test("C: array / null / string / number / boolean -> 400", async () => {
  for (const raw of ["[1,2,3]", "null", '"hello"', "42", "true"]) {
    const { deps } = baseDeps([]);
    const res = await handleRequest(rawReq(raw), deps);
    assertEquals(res.status, 400, `raw=${raw}`);
    assertEquals((await readJson(res)).error, "invalid_request_body");
  }
});

Deno.test("C: mode missing -> 400 manual_mode_required, no fetch", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(jsonReq({ action: "preview" }), deps);
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "manual_mode_required");
  assertEquals(state.calls.length, 0);
});

Deno.test("C: batch / scheduled / automatic / cron -> 400 manual_mode_required, no fetch", async () => {
  for (const mode of ["batch", "scheduled", "automatic", "cron", "all", "retry-all"]) {
    const { deps, state } = baseDeps([]);
    const res = await handleRequest(jsonReq({ mode }), deps);
    assertEquals(res.status, 400, `mode=${mode}`);
    assertEquals((await readJson(res)).error, "manual_mode_required");
    assertEquals(state.calls.length, 0, `mode=${mode}`);
  }
});

Deno.test("C: action missing / invalid -> 400 invalid_action", async () => {
  for (const body of [
    { mode: "manual" },
    { mode: "manual", action: "delete" },
    { mode: "manual", action: 5 },
  ]) {
    const { deps } = baseDeps([]);
    const res = await handleRequest(jsonReq(body), deps);
    assertEquals(res.status, 400);
    assertEquals((await readJson(res)).error, "invalid_action");
  }
});

Deno.test("C: attempt_id missing / invalid / non-UUID -> 400 invalid_attempt_id", async () => {
  for (const attempt_id of [
    undefined,
    "not-a-uuid",
    "",
    [ATTEMPT_ID],
    `${ATTEMPT_ID},${ATTEMPT_ID_2}`,
    "*",
  ]) {
    const body: Record<string, unknown> = { mode: "manual", action: "preview" };
    if (attempt_id !== undefined) body.attempt_id = attempt_id;
    const { deps } = baseDeps([]);
    const res = await handleRequest(jsonReq(body), deps);
    assertEquals(res.status, 400, `attempt_id=${JSON.stringify(attempt_id)}`);
    assertEquals((await readJson(res)).error, "invalid_attempt_id");
  }
});

Deno.test("C: environment missing -> 409, no fetch", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(
    jsonReq({ mode: "manual", action: "preview", attempt_id: ATTEMPT_ID }),
    deps,
  );
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "environment_confirmation_mismatch");
  assertEquals(state.calls.length, 0);
});

Deno.test("C: environment mismatch (production while env=test) -> 409, no fetch", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(
    jsonReq(previewBody({ environment: "production" })),
    deps,
  );
  assertEquals(res.status, 409);
  assertEquals(state.calls.length, 0);
});

Deno.test("C: execute without confirmation -> 400 execution_confirmation_required, no fetch", async () => {
  const { deps, state } = baseDeps([]);
  const b = executeBody();
  delete (b as Record<string, unknown>).confirmation;
  const res = await handleRequest(jsonReq(b), deps);
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "execution_confirmation_required");
  assertEquals(state.calls.length, 0);
});

Deno.test("C: execute with wrong confirmation -> 400", async () => {
  const { deps, state } = baseDeps([]);
  const res = await handleRequest(
    jsonReq(executeBody({ confirmation: "WRONG" })),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "execution_confirmation_required");
  assertEquals(state.calls.length, 0);
});

// -------------------- D. Manual candidate query --------------------

Deno.test("D: manual query URL uses id=eq, limit=1, cutoff=now-120s, no limit=20", async () => {
  const { deps, state } = baseDeps([candidatesRoute([makeCandidate()])]);
  await handleRequest(jsonReq(previewBody()), deps);
  const call = sbAttemptGet(state);
  assert(call);
  const u = new URL(call!.url);
  assertEquals(u.searchParams.get("id"), `eq.${ATTEMPT_ID}`);
  assertEquals(u.searchParams.get("limit"), "1");
  assert(u.searchParams.get("limit") !== "20");
  const statusFilter = u.searchParams.get("status") ?? "";
  assertStringIncludes(statusFilter, "awaiting_reconciliation");
  assertStringIncludes(statusFilter, "processing");
  assertStringIncludes(statusFilter, "pending");
  for (const forbidden of ["approved", "rejected", "cancelled", "refunded", "charged_back"]) {
    assert(!statusFilter.includes(forbidden), `status filter should exclude ${forbidden}`);
  }
  assertEquals(u.searchParams.get("payment_environment"), "eq.test");
  assertEquals(u.searchParams.get("mercado_pago_payment_id"), "not.is.null");
  const cutoff = new Date(NOW.getTime() - 120_000).toISOString();
  assertEquals(u.searchParams.get("created_at"), `lt.${cutoff}`);
  assertEquals(u.searchParams.get("order"), "created_at.asc");
});

Deno.test("D: PostgREST HTTP error / invalid JSON / non-array -> 503 candidates_lookup_failed", async () => {
  for (const route of [
    candidatesRoute({ message: "x" }, 500),
    candidatesRouteRaw("not-json{"),
    candidatesRoute({ code: "PGRST", message: "boom" }),
  ]) {
    const { deps } = baseDeps([route]);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 503);
    assertEquals((await readJson(res)).error, "candidates_lookup_failed");
  }
});

Deno.test("D: zero rows -> 404 attempt_not_eligible", async () => {
  const { deps, state } = baseDeps([candidatesRoute([])]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "attempt_not_eligible");
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
});

Deno.test("D: >1 row -> 500 unexpected_candidate_count, no MP/RPC", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([
      makeCandidate(),
      makeCandidate({ id: ATTEMPT_ID_2 }),
    ]),
  ]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 500);
  assertEquals((await readJson(res)).error, "unexpected_candidate_count");
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
});

Deno.test("D: row id differs from attempt_id -> 404, no MP", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([makeCandidate({ id: ATTEMPT_ID_2 })]),
  ]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 404);
  assertEquals(mpCalls(state), 0);
});

Deno.test("D: row with wrong env / terminal status / fresh created_at / bad mp id -> 404", async () => {
  const bad = [
    makeCandidate({ payment_environment: "production" }),
    makeCandidate({ status: "approved" }),
    makeCandidate({ created_at: FRESH_ISO }),
    makeCandidate({ mercado_pago_payment_id: "" }),
    makeCandidate({ mercado_pago_payment_id: "abc123" }),
  ];
  for (const row of bad) {
    const { deps, state } = baseDeps([candidatesRoute([row])]);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 404, JSON.stringify(row));
    assertEquals(mpCalls(state), 0);
    assertEquals(rpcCalls(state), 0);
  }
});

// -------------------- E. Preview --------------------

Deno.test("E: preview does exactly one Supabase query, zero MP, zero RPC", async () => {
  const { deps, state } = baseDeps([candidatesRoute([makeCandidate()])]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 200);
  assertEquals(countCalls(state, (c) => new URL(c.url).host === "example.supabase.co"), 1);
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
  assertEquals(nonGetSupabaseCalls(state).length, 0);
});

Deno.test("E: preview response shape (no order_id, no full mp id, masked suffix)", async () => {
  const { deps } = baseDeps([candidatesRoute([makeCandidate()])]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  const body = await readJson(res);
  assertEquals(body.ok, true);
  assertEquals(body.mode, "manual");
  assertEquals(body.action, "preview");
  assertEquals(body.environment, "test");
  assertEquals(body.eligible, true);
  assertEquals(body.candidate_count, 1);
  assertEquals(body.max_candidates, 1);
  assertEquals(body.mercado_pago_called, false);
  assertEquals(body.rpc_called, false);
  const attempt = body.attempt as Record<string, unknown>;
  assertEquals(attempt.attempt_id, ATTEMPT_ID);
  assertEquals(attempt.status, "awaiting_reconciliation");
  assertEquals(attempt.has_payment_id, true);
  assertEquals(attempt.payment_id_suffix, MP_ID.slice(-4));
  // No sensitive fields leaked.
  const serialized = JSON.stringify(body);
  assert(!serialized.includes(ORDER_ID), "order_id leaked");
  assert(!serialized.includes(MP_ID), "full MP id leaked");
  assert(!serialized.includes(SERVICE_ROLE), "service role leaked");
  assert(!serialized.includes("collector"), "collector leaked");
  assert(!serialized.includes("metadata"), "metadata leaked");
});

Deno.test("E: preview ignores confirmation and does not execute", async () => {
  const { deps, state } = baseDeps([candidatesRoute([makeCandidate()])]);
  const res = await handleRequest(
    jsonReq(previewBody({ confirmation: "EXECUTE_ONE_RECONCILIATION" })),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
});

Deno.test("E: preview masks short payment id as ****", async () => {
  const shortId = "12";
  const { deps } = baseDeps([
    candidatesRoute([makeCandidate({ mercado_pago_payment_id: shortId })]),
  ]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  const body = await readJson(res);
  const attempt = body.attempt as Record<string, unknown>;
  assertEquals(attempt.payment_id_suffix, "****");
});

// -------------------- F. Execute --------------------

function approvedPayment(id: string | number = MP_ID) {
  return {
    id,
    status: "approved",
    status_detail: "accredited",
    live_mode: false,
    transaction_amount: 5000,
    currency_id: "CLP",
    external_reference: ORDER_ID,
    metadata: { order_id: ORDER_ID, payment_attempt_id: ATTEMPT_ID },
    payment_type_id: "credit_card",
    collector_id: 123456,
  };
}

Deno.test("F: execute does exactly one Supabase attempt lookup, one MP fetch, one RPC", async () => {
  let rpcArgs: Record<string, unknown> = {};
  const { deps, state } = baseDeps([
    candidatesRoute([makeCandidate()]),
    mpRoute(MP_ID, () => new Response(JSON.stringify(approvedPayment()))),
    rpcRoute((args) => {
      rpcArgs = args;
      return new Response(JSON.stringify({ ok: true, order_status: "approved" }));
    }),
  ]);
  const res = await handleRequest(jsonReq(executeBody()), deps);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.mode, "manual");
  assertEquals(body.action, "execute");
  assertEquals(body.candidate_count, 1);
  assertEquals(body.max_candidates, 1);
  assertEquals(body.processed, 1);
  assertEquals(mpCalls(state), 1);
  assertEquals(rpcCalls(state), 1);
  assertEquals(nonGetSupabaseCalls(state).length, 0);
  // Canonical RPC params intact.
  for (const p of [
    "p_order_id", "p_attempt_id", "p_payment_id", "p_payment_status",
    "p_status_detail", "p_live_mode", "p_transaction_amount", "p_currency_id",
    "p_external_reference", "p_metadata_order_id", "p_metadata_attempt_id",
    "p_payment_type_id", "p_collector_id", "p_expected_collector_id",
  ]) {
    assert(p in rpcArgs, `missing ${p}`);
  }
  assertEquals(rpcArgs.p_expected_collector_id, "123456");
});

Deno.test("F: requires_reconciliation -> reconciled=1", async () => {
  const { deps } = baseDeps([
    candidatesRoute([makeCandidate()]),
    mpRoute(MP_ID, () => new Response(JSON.stringify(approvedPayment()))),
    rpcRoute(() =>
      new Response(JSON.stringify({
        ok: false,
        code: "requires_reconciliation",
        reason: "amount_mismatch",
      })),
    ),
  ]);
  const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
  assertEquals(body.reconciled, 1);
});

Deno.test("F: MP 404 -> not_found=1, no RPC", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([makeCandidate()]),
    mpRoute(MP_ID, () => new Response("nope", { status: 404 })),
  ]);
  const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
  assertEquals(body.not_found, 1);
  assertEquals(rpcCalls(state), 0);
});

Deno.test("F: MP 429 -> deferred=1, single MP call (no batch)", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([makeCandidate()]),
    mpRoute(MP_ID, () => new Response("slow", { status: 429 })),
  ]);
  const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
  assertEquals(body.deferred, 1);
  assertEquals(mpCalls(state), 1);
  assertEquals(rpcCalls(state), 0);
});

Deno.test("F: MP 500 -> deferred; MP 401/403 -> 503 mp_auth_error", async () => {
  {
    const { deps } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () => new Response("boom", { status: 500 })),
    ]);
    const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
    assertEquals(body.deferred, 1);
  }
  for (const status of [401, 403]) {
    const { deps } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () => new Response("nope", { status })),
    ]);
    const res = await handleRequest(jsonReq(executeBody()), deps);
    assertEquals(res.status, 503);
    assertEquals((await readJson(res)).error, "mp_auth_error");
  }
});

Deno.test("F: MP network error -> deferred=1", async () => {
  const { deps } = baseDeps([
    candidatesRoute([makeCandidate()]),
    {
      match: (u) => u.host === "api.mercadopago.com",
      respond: () => {
        throw new TypeError("network fail");
      },
    },
  ]);
  const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
  assertEquals(body.deferred, 1);
});

Deno.test("F: MP timeout -> deferred=1 within budget", async () => {
  const { deps } = baseDeps(
    [
      candidatesRoute([makeCandidate()]),
      {
        match: (u) => u.host === "api.mercadopago.com",
        respond: (_u, init) =>
          new Promise((_res, rej) => {
            const s = init.signal;
            if (s) s.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          }),
      },
    ],
    {},
    { mercadoPagoTimeoutMs: 20 },
  );
  const started = Date.now();
  const res = await handleRequest(jsonReq(executeBody()), deps);
  const elapsed = Date.now() - started;
  assert(elapsed < 2_000);
  const body = await readJson(res);
  assertEquals(body.deferred, 1);
});

Deno.test("F: MP invalid JSON / id mismatch -> payload_invalid, no RPC", async () => {
  {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () => new Response("garbage{")),
    ]);
    const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
    assertEquals(body.payload_invalid, 1);
    assertEquals(rpcCalls(state), 0);
  }
  {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () =>
        new Response(JSON.stringify({ ...approvedPayment(), id: "111" })),
      ),
    ]);
    const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
    assertEquals(body.payload_invalid, 1);
    assertEquals(rpcCalls(state), 0);
  }
});

Deno.test("F: refunded / charged_back -> skipped_unsupported_status, no RPC", async () => {
  for (const status of ["refunded", "charged_back"]) {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () =>
        new Response(JSON.stringify({ ...approvedPayment(), status }))),
    ]);
    const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
    assertEquals(body.skipped_unsupported_status, 1, status);
    assertEquals(rpcCalls(state), 0, status);
  }
});

Deno.test("F: RPC non-2xx / unexpected shape -> rpc_failed=1", async () => {
  for (const rpc of [
    rpcRoute(() => new Response("boom", { status: 500 })),
    rpcRoute(() => new Response(JSON.stringify({ weird: true }))),
  ]) {
    const { deps } = baseDeps([
      candidatesRoute([makeCandidate()]),
      mpRoute(MP_ID, () => new Response(JSON.stringify(approvedPayment()))),
      rpc,
    ]);
    const body = await readJson(await handleRequest(jsonReq(executeBody()), deps));
    assertEquals(body.rpc_failed, 1);
  }
});

// -------------------- G. Structural guarantees --------------------

Deno.test("G: no batch route reachable — bodies that pre-refactor triggered batch now fail closed", async () => {
  for (const body of [{}, { mode: "batch" }, { mode: "scheduled" }]) {
    const { deps, state } = baseDeps([]);
    const res = await handleRequest(jsonReq(body), deps);
    assert(res.status === 400, `body=${JSON.stringify(body)}`);
    assertEquals(state.calls.length, 0);
  }
});

Deno.test("G: execute processes at most one candidate even if PostgREST returned many (should 500 first)", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([
      makeCandidate(),
      makeCandidate({ id: ATTEMPT_ID_2 }),
    ]),
    mpRoute(MP_ID, () => new Response(JSON.stringify(approvedPayment()))),
  ]);
  await handleRequest(jsonReq(executeBody()), deps);
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
});

// -------------------- H. Pending eligibility (manual only) --------------------

Deno.test("H: accepts awaiting_reconciliation, processing, pending; rejects terminal/unknown", async () => {
  for (const status of ["awaiting_reconciliation", "processing", "pending"]) {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate({ status })]),
    ]);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 200, `should accept ${status}`);
    const body = await readJson(res);
    assertEquals(body.eligible, true);
    assertEquals((body.attempt as Record<string, unknown>).status, status);
    assertEquals(mpCalls(state), 0);
    assertEquals(rpcCalls(state), 0);
  }
  for (const status of ["approved", "rejected", "cancelled", "refunded", "charged_back", "completed", "failed", "wat", ""]) {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate({ status })]),
    ]);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 404, `should reject ${status}`);
    assertEquals(mpCalls(state), 0);
    assertEquals(rpcCalls(state), 0);
  }
  {
    const { deps } = baseDeps([
      candidatesRoute([makeCandidate({ status: null })]),
    ]);
    const res = await handleRequest(jsonReq(previewBody()), deps);
    assertEquals(res.status, 404);
  }
});

Deno.test("H: preview of pending row — one SB call, zero MP, zero RPC, masked shape", async () => {
  const { deps, state } = baseDeps([
    candidatesRoute([makeCandidate({ status: "pending" })]),
  ]);
  const res = await handleRequest(jsonReq(previewBody()), deps);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);
  assertEquals(body.eligible, true);
  assertEquals(body.candidate_count, 1);
  assertEquals(body.max_candidates, 1);
  assertEquals(body.mercado_pago_called, false);
  assertEquals(body.rpc_called, false);
  const attempt = body.attempt as Record<string, unknown>;
  assertEquals(attempt.status, "pending");
  assertEquals(attempt.has_payment_id, true);
  assertEquals(attempt.payment_id_suffix, MP_ID.slice(-4));
  assertEquals(countCalls(state, (c) => new URL(c.url).host === "example.supabase.co"), 1);
  assertEquals(mpCalls(state), 0);
  assertEquals(rpcCalls(state), 0);
  assertEquals(nonGetSupabaseCalls(state).length, 0);
  const serialized = JSON.stringify(body);
  assert(!serialized.includes(ORDER_ID));
  assert(!serialized.includes(MP_ID));
  assert(!serialized.includes(SERVICE_ROLE));
  assert(!serialized.includes("collector"));
  assert(!serialized.includes("metadata"));
});

Deno.test("H: execute on pending row — one MP fetch, one RPC, per MP status", async () => {
  for (const mpStatus of ["pending", "in_process", "approved", "rejected"]) {
    const { deps, state } = baseDeps([
      candidatesRoute([makeCandidate({ status: "pending" })]),
      mpRoute(MP_ID, () =>
        new Response(JSON.stringify({ ...approvedPayment(), status: mpStatus })),
      ),
      rpcRoute(() => new Response(JSON.stringify({ ok: true, order_status: mpStatus }))),
    ]);
    const res = await handleRequest(jsonReq(executeBody()), deps);
    assertEquals(res.status, 200, mpStatus);
    const body = await readJson(res);
    assertEquals(body.processed, 1, mpStatus);
    assertEquals(mpCalls(state), 1, mpStatus);
    assertEquals(rpcCalls(state), 1, mpStatus);
    assertEquals(nonGetSupabaseCalls(state).length, 0, mpStatus);
    // never touches a second attempt / second payment
    assertEquals(
      countCalls(state, (c) =>
        new URL(c.url).pathname.endsWith("/rest/v1/payment_attempts") && c.method === "GET",
      ),
      1,
      mpStatus,
    );
  }
});
