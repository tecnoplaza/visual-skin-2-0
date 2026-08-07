// §14 Order recovery (infrastructure only — no email provider wired yet).
// Until getServerConfig().emailProviderConfigured is true, we DO NOT persist
// a usable token: the user always gets the generic response and no row is
// left behind in order_recovery_tokens.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { assertSameOrigin } from "@/lib/csrf";
import { getServerConfig } from "@/lib/server-config";
import {
  enforceRateLimit,
  hashBucketKey,
  ipHashFromRequest,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const RECOVERY_TTL_SECONDS = 30 * 60;

function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}
function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function sendOrderRecoveryEmail(_args: {
  email: string;
  token: string;
  orderId: string;
}): Promise<{ delivered: boolean; reason?: string }> {
  // No provider configured. Never log the raw token.
  console.warn("[recovery] EMAIL_PROVIDER_NOT_CONFIGURED");
  return { delivered: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
}

const RequestInput = z.object({
  email: z.string().trim().email().max(255),
});

export const requestOrderRecovery = createServerFn({ method: "POST" })
  .inputValidator((i) => RequestInput.parse(i))
  .handler(async ({ data }) => {
    assertSameOrigin();
    const req = getRequest();
    const email = normalizeEmail(data.email);
    const ipHash = ipHashFromRequest(req);

    await enforceRateLimit(
      "recovery_request",
      hashBucketKey("recovery_email", email),
      RATE_LIMITS.recovery_request_email.limit,
      RATE_LIMITS.recovery_request_email.window,
    );
    await enforceRateLimit(
      "recovery_request",
      hashBucketKey("recovery_ip", ipHash),
      RATE_LIMITS.recovery_request_ip.limit,
      RATE_LIMITS.recovery_request_ip.window,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: orders } = await supabaseAdmin
      .from("custom_orders")
      .select("id,customer_email")
      .ilike("customer_email", email)
      .order("created_at", { ascending: false })
      .limit(5);

    // If no email provider is configured we must NOT leave a usable token
    // behind. Always respond generically to avoid disclosing email presence.
    const providerReady = (() => {
      try {
        return getServerConfig().emailProviderConfigured;
      } catch {
        return false;
      }
    })();

    if (!providerReady) {
      console.warn("[recovery] EMAIL_PROVIDER_NOT_CONFIGURED");
    } else if (orders && orders.length > 0) {
      for (const o of orders) {
        const rawToken = randomBytes(32).toString("base64url");
        const tokenHash = hashToken(rawToken);
        const { error: issueErr } = await supabaseAdmin.rpc(
          "issue_recovery_token" as any,
          {
            p_order_id: o.id,
            p_email_normalized: email,
            p_token_hash: tokenHash,
            p_ttl_seconds: RECOVERY_TTL_SECONDS,
            p_ip_hash: ipHash,
          } as any,
        );
        if (issueErr) {
          console.error("[recovery] issue failed", issueErr.message);
          continue;
        }
        const sent = await sendOrderRecoveryEmail({
          email,
          token: rawToken,
          orderId: o.id,
        });
        if (!sent.delivered) {
          // Delivery failed — revoke the just-issued token so it cannot be
          // used by anyone who intercepts logs or the DB row.
          await supabaseAdmin
            .from("order_recovery_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("token_hash", tokenHash);
        }
      }
    }

    return {
      ok: true as const,
      message: "Si el correo tiene pedidos, recibirás un enlace en unos minutos.",
    };
  });

const ConsumeInput = z.object({
  token: z.string().min(20).max(200),
});

export const consumeOrderRecoveryToken = createServerFn({ method: "POST" })
  .inputValidator((i) => ConsumeInput.parse(i))
  .handler(async ({ data }) => {
    assertSameOrigin();
    const req = getRequest();
    const ipHash = ipHashFromRequest(req);
    await enforceRateLimit(
      "recovery_consume",
      hashBucketKey("recovery_consume_ip", ipHash),
      RATE_LIMITS.recovery_consume.limit,
      RATE_LIMITS.recovery_consume.window,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc(
      "consume_recovery_token" as any,
      { p_token_hash: hashToken(data.token) } as any,
    );
    if (error) throw new Error("No se pudo procesar el token");
    const r = res as { ok: boolean; code?: string; order_id?: string };
    if (!r?.ok) {
      throw new Error("Token inválido o expirado");
    }
    // Caller is expected to then invoke the existing session-open flow with the
    // returned order_id (a further server fn establishes the cookie session).
    return { ok: true as const, orderId: r.order_id! };
  });
