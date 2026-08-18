import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveMercadoPagoPreferenceId } from "../../supabase/functions/_shared/mercadopago-preference.ts";

const orderId = "019ffe4f-a9ff-4e17-b398-80c1bdf6bdf9";
const paymentId = "174380791194";
const merchantOrderId = "43704696373";
const preferenceId = "3463684586-6ef2df47-a0fc-4707-ae13-c11ce55bec49";
const amount = 10980;

function payment(overrides: Record<string, unknown> = {}) {
  return { id: paymentId, preference_id: null, order: { id: merchantOrderId },
    external_reference: orderId, transaction_amount: amount, ...overrides };
}
function merchant(overrides: Record<string, unknown> = {}) {
  return { id: Number(merchantOrderId), preference_id: preferenceId,
    external_reference: orderId, total_amount: amount, paid_amount: amount,
    payments: [{ id: Number(paymentId), transaction_amount: amount, status: "approved" }], ...overrides };
}
function fetchJson(value: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(value), { status })) as typeof fetch;
}
function resolve(p = payment(), m = merchant(), fetchFn = fetchJson(m)) {
  return resolveMercadoPagoPreferenceId({ payment: p, paymentId, visualSkinOrderId: orderId,
    transactionAmount: amount, accessToken: "secret", timeoutMs: 50, fetchFn });
}

test("preference_id presente conserva flujo y no consulta Merchant Order", async () => {
  let calls = 0;
  const result = await resolve(payment({ preference_id: preferenceId }), merchant(), (async () => { calls++; throw new Error("unexpected"); }) as typeof fetch);
  assert.deepEqual(result, { ok: true, preferenceId, source: "payment" });
  assert.equal(calls, 0);
});

test("caso real recupera preference_id desde Merchant Order validada", async () => {
  const result = await resolve();
  assert.deepEqual(result, { ok: true, preferenceId, source: "merchant_order" });
});

test("external_reference distinto se rechaza", async () => {
  const result = await resolve(payment(), merchant({ external_reference: crypto.randomUUID() }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "merchant_order_external_reference_mismatch");
});

test("preference recuperida queda disponible para la validación snapshot existente", async () => {
  const different = "3463684586-different-snapshot-preference";
  const result = await resolve(payment(), merchant({ preference_id: different }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.preferenceId, different);
  const webhook = readFileSync(new URL("../../supabase/functions/mercadopago-webhook/index.ts", import.meta.url), "utf8");
  assert.match(webhook, /preference_id=eq\.\$\{encodeURIComponent\(preferenceId\)\}/);
});

test("Merchant Order sin payment.id se rechaza", async () => {
  const result = await resolve(payment(), merchant({ payments: [{ id: 1, transaction_amount: amount }] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "merchant_order_payment_missing");
});

test("montos incompatibles se rechazan", async () => {
  for (const value of [merchant({ total_amount: amount + 1 }), merchant({ paid_amount: amount - 1 }), merchant({ payments: [{ id: Number(paymentId), transaction_amount: amount - 1 }] })]) {
    assert.equal((await resolve(payment(), value)).ok, false);
  }
});

test("error HTTP y timeout son transitorios", async () => {
  const http = await resolve(payment(), merchant(), fetchJson({}, 503));
  assert.equal(http.ok, false);
  if (!http.ok) assert.equal(http.kind, "transient");
  const timeoutFetch = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;
  const timeout = await resolve(payment(), merchant(), timeoutFetch);
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.kind, "transient");
});

test("webhook y reconciliador reutilizan el helper antes de attach/apply", () => {
  const webhook = readFileSync(new URL("../../supabase/functions/mercadopago-webhook/index.ts", import.meta.url), "utf8");
  const reconcile = readFileSync(new URL("../../supabase/functions/mercadopago-reconcile/handler.ts", import.meta.url), "utf8");
  for (const source of [webhook, reconcile]) assert.match(source, /resolveMercadoPagoPreferenceId/);
  assert.ok(webhook.indexOf("resolveMercadoPagoPreferenceId({") < webhook.indexOf("attach_checkout_pro_snapshot_payment_v1"));
  assert.ok(reconcile.indexOf("resolveMercadoPagoPreferenceId({") < reconcile.indexOf("const applied = await rpcApply"));
});
