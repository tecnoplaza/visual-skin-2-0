// Server functions for payment gateway administration.
// Secrets themselves NEVER cross the wire — only "configured / missing" status.
// MP secrets are resolved from MERCADOPAGO_ENV — the sufix TEST/PRODUCTION is
// applied automatically. No fallback to legacy unsuffixed vars.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getMercadoPagoConfig } from "@/lib/server-config";

// Presence-only probe (never returns the value). Used strictly by
// getGatewaySecretsStatus to render "configured/missing" toggles.
function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

type MpEnv = "test" | "production";

function resolveMpEnv(): MpEnv | null {
  const v = (process.env.MERCADOPAGO_ENV ?? "").trim().toLowerCase();
  if (v === "test" || v === "production") return v;
  return null;
}

type ProviderNames = {
  access: string;
  publicKey?: string;
  webhook?: string;
  collector?: string;
};

function mpNames(env: MpEnv): ProviderNames {
  const suffix = env === "production" ? "PRODUCTION" : "TEST";
  return {
    access: `MERCADOPAGO_ACCESS_TOKEN_${suffix}`,
    publicKey: `MERCADOPAGO_PUBLIC_KEY_${suffix}`,
    webhook: `MERCADOPAGO_WEBHOOK_SECRET_${suffix}`,
    collector: `MERCADOPAGO_COLLECTOR_ID_${suffix}`,
  };
}

// Known non-MP providers + required env-var secrets.
const OTHER_PROVIDER_SECRETS: Record<string, ProviderNames> = {
  stripe: {
    access: "STRIPE_SECRET_KEY",
    publicKey: "STRIPE_PUBLISHABLE_KEY",
    webhook: "STRIPE_WEBHOOK_SECRET",
  },
  paypal: {
    access: "PAYPAL_CLIENT_SECRET",
    publicKey: "PAYPAL_CLIENT_ID",
    webhook: "PAYPAL_WEBHOOK_ID",
  },
  transbank: {
    access: "TRANSBANK_API_KEY_SECRET",
    publicKey: "TRANSBANK_COMMERCE_CODE",
  },
  flow: {
    access: "FLOW_SECRET_KEY",
    publicKey: "FLOW_API_KEY",
  },
  khipu: {
    access: "KHIPU_SECRET",
    publicKey: "KHIPU_RECEIVER_ID",
    webhook: "KHIPU_WEBHOOK_SECRET",
  },
};

export type GatewaySecretStatus = {
  access: boolean;
  publicKey: boolean | null;
  webhook: boolean | null;
  collector?: boolean | null;
  env?: MpEnv | null;
  names: ProviderNames;
};

export const getGatewaySecretsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    const status: Record<string, GatewaySecretStatus> = {};

    // Mercado Pago — env-aware. If MERCADOPAGO_ENV is missing/invalid, mark
    // everything as not configured; never assume production.
    const mpEnv = resolveMpEnv();
    if (mpEnv) {
      const n = mpNames(mpEnv);
      status.mercadopago = {
        access: envPresent(n.access),
        publicKey: envPresent(n.publicKey!),
        webhook: envPresent(n.webhook!),
        collector: envPresent(n.collector!),
        env: mpEnv,
        names: n,
      };
    } else {
      // Not configured — report unknown env, all secrets absent.
      status.mercadopago = {
        access: false,
        publicKey: false,
        webhook: false,
        collector: false,
        env: null,
        names: {
          access: "MERCADOPAGO_ACCESS_TOKEN_(TEST|PRODUCTION)",
          publicKey: "MERCADOPAGO_PUBLIC_KEY_(TEST|PRODUCTION)",
          webhook: "MERCADOPAGO_WEBHOOK_SECRET_(TEST|PRODUCTION)",
          collector: "MERCADOPAGO_COLLECTOR_ID_(TEST|PRODUCTION)",
        },
      };
    }

    for (const [prov, names] of Object.entries(OTHER_PROVIDER_SECRETS)) {
      status[prov] = {
        access: envPresent(names.access),
        publicKey: names.publicKey ? envPresent(names.publicKey) : null,
        webhook: names.webhook ? envPresent(names.webhook) : null,
        names,
      };
    }
    return { status };
  });

const TestInput = z.object({ provider: z.string() });

export const testGatewayConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => TestInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    if (data.provider === "mercadopago") {
      let token: string;
      try {
        token = getMercadoPagoConfig().accessToken;
      } catch (e) {
        const code = (e as { code?: string })?.code ?? "not_configured";
        return { ok: false, message: `MP no configurado (${code})` };
      }
      const r = await fetch("https://api.mercadopago.com/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { ok: false, message: `MP respondió ${r.status}` };
      const me = (await r.json()) as { nickname?: string; site_id?: string; email?: string };
      return { ok: true, message: `Conectado como ${me.nickname ?? me.email ?? "?"} (${me.site_id ?? "?"})` };
    }

    if (data.provider === "stripe") {
      const token = process.env.STRIPE_SECRET_KEY;
      if (!token) return { ok: false, message: "STRIPE_SECRET_KEY no está configurado" };
      const r = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { ok: false, message: `Stripe respondió ${r.status}` };
      const acc = (await r.json()) as { id?: string; email?: string };
      return { ok: true, message: `Conectado a ${acc.id ?? acc.email ?? "cuenta Stripe"}` };
    }

    return { ok: false, message: "Test no implementado para este proveedor" };
  });
