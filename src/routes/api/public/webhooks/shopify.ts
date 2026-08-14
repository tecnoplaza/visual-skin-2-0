// Shopify orders/paid webhook.
// Receives the payment confirmation from Shopify, verifies the HMAC over the
// raw request body, maps the VisualSkin order id from cart attributes, and
// updates the canonical Supabase order. Never trusts browser redirects.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0",
  "Content-Type": "text/plain; charset=utf-8",
} as const;

function response(status: number, body = "") {
  return new Response(body, { status, headers: NO_STORE });
}

function verifyHmac(rawBody: Buffer, provided: string | null, secret: string): boolean {
  if (!provided || !secret) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(computed, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function money(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedVariantId(packType: unknown): string | null {
  const envKeyByPack: Record<string, string | undefined> = {
    carcasa: process.env.SHOPIFY_VARIANT_CARCASA,
    "carcasa+polera": process.env.SHOPIFY_VARIANT_CARCASA_POLERA,
    "carcasa+poleron": process.env.SHOPIFY_VARIANT_CARCASA_POLERON,
    "carcasa+polera+poleron": process.env.SHOPIFY_VARIANT_CARCASA_POLERA_POLERON,
  };
  const gid = envKeyByPack[String(packType)]?.trim() ?? "";
  const match = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(gid);
  return match?.[1] ?? null;
}

function getAttribute(
  attributes: unknown,
  key: string,
): string | null {
  if (!Array.isArray(attributes)) return null;
  for (const item of attributes) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.name === key || record.key === key) {
      return typeof record.value === "string" ? record.value : null;
    }
  }
  return null;
}

export const Route = createFileRoute("/api/public/webhooks/shopify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (process.env.SHOPIFY_WEBHOOK_SECRET ?? "").trim();
        if (!secret) return response(503, "webhook not configured");

        const rawBody = Buffer.from(await request.arrayBuffer());
        if (rawBody.byteLength > 2 * 1024 * 1024) return response(413, "payload too large");

        if (
          !verifyHmac(
            rawBody,
            request.headers.get("x-shopify-hmac-sha256"),
            secret,
          )
        ) {
          return response(401, "invalid signature");
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
        } catch {
          return response(400, "invalid json");
        }

        const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
        if (topic !== "orders/paid") return response(400, "unexpected topic");

        const configuredDomain = (process.env.SHOPIFY_STORE_DOMAIN ?? "")
          .trim()
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "")
          .toLowerCase();
        const webhookDomain = (request.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
        if (!configuredDomain || webhookDomain !== configuredDomain) {
          return response(401, "unexpected shop");
        }

        const orderId = payload.id;
        const attributes =
          payload.note_attributes ??
          payload.custom_attributes ??
          payload.attributes;
        const visualSkinOrderId = getAttribute(attributes, "visualskin_order_id");

        if (!visualSkinOrderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visualSkinOrderId)) {
          console.error("[Shopify webhook] missing VisualSkin order reference");
          return response(400, "missing VisualSkin order reference");
        }

        const financialStatus = String(
          payload.financial_status ??
            payload.display_financial_status ??
            "",
        ).toLowerCase();
        if (financialStatus && financialStatus !== "paid") {
          return response(200, "not paid");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existing, error: lookupError } = await (supabaseAdmin as any)
          .from("custom_orders")
          .select("id,payment_status,shopify_order_id,pack_type,subtotal_amount,total_amount,currency")
          .eq("id", visualSkinOrderId)
          .maybeSingle();

        if (lookupError || !existing) {
          console.error("[Shopify webhook] VisualSkin order not found", lookupError?.message);
          return response(404, "order not found");
        }

        const shopifyOrderId =
          typeof orderId === "number" || typeof orderId === "string"
            ? String(orderId)
            : null;

        if (!shopifyOrderId) return response(400, "missing Shopify order id");
        if (existing.shopify_order_id && existing.shopify_order_id !== shopifyOrderId) {
          return response(409, "order reference conflict");
        }

        const expectedVariant = expectedVariantId(existing.pack_type);
        const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
        const paidVariantIds = lineItems
          .map((item) =>
            item && typeof item === "object"
              ? String((item as Record<string, unknown>).variant_id ?? "")
              : "",
          )
          .filter(Boolean);
        if (!expectedVariant || paidVariantIds.length !== 1 || paidVariantIds[0] !== expectedVariant) {
          console.error("[Shopify webhook] variant mismatch", { visualSkinOrderId, paidVariantIds });
          return response(409, "variant mismatch");
        }

        const paidSubtotal = money(payload.current_subtotal_price ?? payload.subtotal_price);
        const paidTotal = money(payload.current_total_price ?? payload.total_price);
        const canonicalSubtotal = money(existing.subtotal_amount);
        const canonicalTotal = money(existing.total_amount);
        const paidCurrency = String(payload.currency ?? payload.presentment_currency ?? "");
        if (
          paidSubtotal === null ||
          paidTotal === null ||
          canonicalSubtotal === null ||
          canonicalTotal === null ||
          Math.round(paidSubtotal) !== Math.round(canonicalSubtotal) ||
          Math.round(paidTotal) !== Math.round(canonicalTotal) ||
          paidCurrency !== existing.currency
        ) {
          console.error("[Shopify webhook] canonical amount mismatch", {
            visualSkinOrderId,
            paidSubtotal,
            paidTotal,
            paidCurrency,
          });
          return response(409, "amount mismatch");
        }

        if (existing.payment_status === "approved") return response(200, "already paid");
        if (existing.payment_status !== "pending") return response(409, "invalid payment state");

        const { error: updateError } = await (supabaseAdmin as any)
          .from("custom_orders")
          .update({
            payment_status: "approved",
            payment_provider: "shopify",
            shopify_order_id: shopifyOrderId,
            design_status: "locked",
            manual_review_required: false,
            payment_status_updated_at: new Date().toISOString(),
          })
          .eq("id", visualSkinOrderId)
          .eq("payment_status", "pending");

        if (updateError) {
          console.error("[Shopify webhook] order update failed", updateError.message);
          return response(500, "update failed");
        }

        // Keep an auditable payment event. The webhook delivery itself is
        // idempotent at the order state level: once approved, later retries
        // cannot transition it to another state through this handler.
        const { error: eventError } = await supabaseAdmin.from("payment_events").insert({
          order_id: visualSkinOrderId,
          provider: "shopify",
          event_type: topic || "orders/paid",
          delivery_id:
            request.headers.get("x-shopify-webhook-id") ??
            request.headers.get("x-shopify-event-id"),
          provider_payment_id: shopifyOrderId,
          processed_at: new Date().toISOString(),
          processing_result: "approved",
          payload: {
            shopify_order_id: shopifyOrderId,
            webhook_id: request.headers.get("x-shopify-webhook-id"),
            event_id: request.headers.get("x-shopify-event-id"),
            financial_status: financialStatus || "paid",
          },
        });

        if (eventError && eventError.code !== "23505") {
          console.error("[Shopify webhook] payment event insert failed", eventError.message);
        }

        return response(200, "ok");
      },
    },
  },
});
