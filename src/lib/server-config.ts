// Server-only, centrally validated configuration.
// Never import from client code — this module reads server env vars and
// throws when required values are missing or malformed.
//
// §1 Physical separation of Mercado Pago test / production:
//   MERCADOPAGO_ENV is REQUIRED (no default). Credentials are looked up
//   exclusively in the *_TEST or *_PRODUCTION pair via getMercadoPagoConfig().
//   The legacy MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_PUBLIC_KEY /
//   MERCADOPAGO_WEBHOOK_SECRET / MERCADOPAGO_COLLECTOR_ID variables are IGNORED
//   — no fallback across environments.
import { z } from "zod";

const RawSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PUBLIC_SITE_URL: z.string().url(),
  /**
   * Lista opcional (coma-separada) de orígenes adicionales autorizados para
   * validación CSRF (preview de Lovable, dominio publicado alternativo, etc.).
   * Solo protocolo + host — sin path, query, fragmento ni comodines.
   */
  ALLOWED_ORIGINS: z.string().optional(),
  // Official Vercel system variable: current deployment hostname, without scheme.
  VERCEL_URL: z.string().optional(),

  // MP environment is REQUIRED. No default.
  MERCADOPAGO_ENV: z.enum(["test", "production"]).optional(),

  // Test credentials — required when MERCADOPAGO_ENV === "test".
  MERCADOPAGO_ACCESS_TOKEN_TEST: z.string().min(10).optional(),
  MERCADOPAGO_PUBLIC_KEY_TEST: z.string().min(10).optional(),
  MERCADOPAGO_WEBHOOK_SECRET_TEST: z.string().min(10).optional(),
  MERCADOPAGO_COLLECTOR_ID_TEST: z.string().min(1).optional(),

  // Production credentials — required when MERCADOPAGO_ENV === "production".
  MERCADOPAGO_ACCESS_TOKEN_PRODUCTION: z.string().min(10).optional(),
  MERCADOPAGO_PUBLIC_KEY_PRODUCTION: z.string().min(10).optional(),
  MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION: z.string().min(10).optional(),
  MERCADOPAGO_COLLECTOR_ID_PRODUCTION: z.string().min(1).optional(),

  // Master payments switch — when != "true", no MP calls, no attempts.
  PAYMENTS_ENABLED: z.string().optional(),
  NODE_ENV: z.string().optional(),
  // Cron endpoint auth — required in production, optional in dev.
  CLEANUP_CRON_SECRET: z.string().min(32).optional(),
  // Dedicated CSRF signing secret — MUST NOT be reused as any other secret.
  CSRF_SIGNING_SECRET: z.string().min(32).optional(),
  // Report-only CSP toggle: "1" = report-only headers only.
  CSP_REPORT_ONLY: z.string().optional(),
  // Optional email provider marker — presence enables recovery token issuance.
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().min(10).optional(),
  VISUALSKIN_EMAIL_FROM: z.string().min(3).max(320).optional(),
  VISUALSKIN_ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),
  NOTIFICATION_CRON_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  // URL base del proyecto Supabase para el cliente administrativo.
  // Lovable reserva el prefijo SUPABASE_ para secretos, por eso este nombre.
  VISUALSKIN_SUPABASE_ADMIN_URL: z.string().optional(),
});

export type MpEnv = "test" | "production";

export type MercadoPagoConfig = {
  env: MpEnv;
  isLiveMode: boolean;
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  collectorId: string | null;
};

export type ServerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** URL absoluta del proyecto Supabase para el cliente administrativo. */
  supabaseAdminUrl: string | null;
  siteOrigin: string;
  siteHost: string;
  /** Orígenes autorizados para validación CSRF (incluye siteOrigin). */
  allowedOrigins: string[];
  /** Selected MP env when set (test | production). `null` when not configured. */
  mpEnv: MpEnv | null;
  /** True only when mpEnv === "production" AND the full production pair is set. */
  isLiveMode: boolean;
  paymentsEnabled: boolean;
  cleanupCronSecret: string | null;
  csrfSigningSecret: string | null;
  cspReportOnly: boolean;
  emailProviderConfigured: boolean;
  emailProvider: string | null;
  emailProviderApiKey: string | null;
  emailFrom: string | null;
  adminNotificationEmail: string | null;
  notificationCronSecret: string | null;
  cronSecret: string | null;
  isProduction: boolean;
};

function normalizeSiteOrigin(raw: string, isProduction: boolean): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("PUBLIC_SITE_URL no es una URL absoluta válida");
  }
  if (u.search || u.hash) {
    throw new Error("PUBLIC_SITE_URL no debe contener query ni fragmento");
  }
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (isProduction && u.protocol !== "https:") {
    throw new Error("PUBLIC_SITE_URL debe usar HTTPS en producción");
  }
  if (!isProduction && u.protocol !== "https:" && !isLocal) {
    throw new Error("PUBLIC_SITE_URL debe usar HTTPS salvo en localhost");
  }
  return `${u.protocol}//${u.host}`;
}

/**
 * Valida VISUALSKIN_SUPABASE_ADMIN_URL.
 * Devuelve la URL normalizada sin path. Devuelve null si no está configurada.
 * Lanza si es inválida.
 */
function normalizeSupabaseAdminUrl(raw: string | undefined): string | null {
  if (!raw || raw.trim().length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: no es una URL absoluta válida",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  if (u.protocol !== "https:") {
    const err = new Error("VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: debe usar HTTPS") as Error & {
      code: string;
    };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  if (u.search || u.hash) {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: no debe contener query ni fragmento",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  if (u.username || u.password) {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: no debe contener credenciales",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  if (u.pathname && u.pathname !== "/" && u.pathname !== "") {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: no debe contener path",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  const host = u.hostname.toLowerCase();
  if (host.endsWith(".lovable.cloud") || host === "lovable.cloud") {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: dominio lovable.cloud rechazado",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  if (!host.endsWith(".supabase.co")) {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID: el hostname debe terminar en .supabase.co",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_INVALID";
    throw err;
  }
  return `${u.protocol}//${u.host}`;
}

/**
 * Devuelve la URL absoluta obligatoria para el cliente administrativo.
 * Lanza VISUALSKIN_SUPABASE_ADMIN_URL_NOT_CONFIGURED si no está definida.
 */
export function getSupabaseAdminUrl(): string {
  const cfg = getServerConfig();
  if (!cfg.supabaseAdminUrl) {
    const err = new Error(
      "VISUALSKIN_SUPABASE_ADMIN_URL_NOT_CONFIGURED: define VISUALSKIN_SUPABASE_ADMIN_URL con la URL absoluta del proyecto Supabase",
    ) as Error & { code: string };
    err.code = "VISUALSKIN_SUPABASE_ADMIN_URL_NOT_CONFIGURED";
    throw err;
  }
  return cfg.supabaseAdminUrl;
}

let cached: ServerConfig | null = null;
let cachedRaw: z.infer<typeof RawSchema> | null = null;

export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = RawSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración de servidor inválida — ${missing}`);
  }
  const raw = parsed.data;
  cachedRaw = raw;
  const isProduction = (raw.NODE_ENV ?? "").toLowerCase() === "production";
  const siteOrigin = normalizeSiteOrigin(raw.PUBLIC_SITE_URL, isProduction);
  const siteHost = new URL(siteOrigin).host;
  if (isProduction && !raw.CLEANUP_CRON_SECRET) {
    throw new Error("CLEANUP_CRON_SECRET es obligatorio en producción (mín. 32 bytes)");
  }
  const mpEnv: MpEnv | null = raw.MERCADOPAGO_ENV ?? null;
  const paymentsEnabled = (raw.PAYMENTS_ENABLED ?? "").toLowerCase() === "true";
  const csrfSigningSecret = raw.CSRF_SIGNING_SECRET ?? null;

  // Reject reusing the CSRF signing secret for anything else.
  if (csrfSigningSecret) {
    const forbiddenReuse = [
      raw.CLEANUP_CRON_SECRET,
      raw.MERCADOPAGO_WEBHOOK_SECRET_TEST,
      raw.MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION,
      raw.MERCADOPAGO_ACCESS_TOKEN_TEST,
      raw.MERCADOPAGO_ACCESS_TOKEN_PRODUCTION,
      raw.SUPABASE_SERVICE_ROLE_KEY,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    if (forbiddenReuse.includes(csrfSigningSecret)) {
      throw new Error(
        "CSRF_SIGNING_SECRET no puede reutilizar CLEANUP_CRON_SECRET, MERCADOPAGO_*_SECRET, MERCADOPAGO_*_ACCESS_TOKEN ni SUPABASE_SERVICE_ROLE_KEY",
      );
    }
  }

  // In production, the dedicated CSRF secret is mandatory.
  if (isProduction && !csrfSigningSecret) {
    throw new Error("CSRF_SIGNING_SECRET es obligatorio en producción (mín. 32 bytes)");
  }

  // isLiveMode is true only when the *full* production pair resolves.
  let isLiveMode = false;
  if (mpEnv === "production") {
    isLiveMode = !!(
      raw.MERCADOPAGO_ACCESS_TOKEN_PRODUCTION &&
      raw.MERCADOPAGO_PUBLIC_KEY_PRODUCTION &&
      raw.MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION
    );
  }

  const supabaseAdminUrl = normalizeSupabaseAdminUrl(raw.VISUALSKIN_SUPABASE_ADMIN_URL);

  const allowedOrigins = buildAllowedOrigins(
    siteOrigin,
    raw.ALLOWED_ORIGINS,
    raw.VERCEL_URL,
    isProduction,
  );

  const resolved: ServerConfig = {
    supabaseUrl: raw.SUPABASE_URL.replace(/\/$/, ""),
    supabaseServiceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAdminUrl,
    siteOrigin,
    siteHost,
    allowedOrigins,
    mpEnv,
    isLiveMode,
    paymentsEnabled,
    cleanupCronSecret: raw.CLEANUP_CRON_SECRET ?? null,
    csrfSigningSecret,
    cspReportOnly: raw.CSP_REPORT_ONLY === "1",
    emailProviderConfigured:
      raw.EMAIL_PROVIDER === "resend" &&
      !!raw.EMAIL_PROVIDER_API_KEY &&
      !!raw.VISUALSKIN_EMAIL_FROM,
    emailProvider: raw.EMAIL_PROVIDER?.trim().toLowerCase() || null,
    emailProviderApiKey: raw.EMAIL_PROVIDER_API_KEY ?? null,
    emailFrom: raw.VISUALSKIN_EMAIL_FROM ?? null,
    adminNotificationEmail: raw.VISUALSKIN_ADMIN_NOTIFICATION_EMAIL ?? null,
    notificationCronSecret: raw.NOTIFICATION_CRON_SECRET ?? null,
    cronSecret: raw.CRON_SECRET ?? null,
    isProduction,
  };
  cached = resolved;
  return resolved;
}

/**
 * Normaliza un origen crudo a `protocolo//host` en minúsculas.
 * Rechaza cualquier valor con path, query, fragmento, comodín o credenciales.
 * Retorna null si es inválido.
 */
function normalizeOriginStrict(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.includes("*")) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.search || u.hash) return null;
  if (u.username || u.password) return null;
  if (u.pathname && u.pathname !== "/" && u.pathname !== "") return null;
  return `${u.protocol}//${u.host.toLowerCase()}`;
}

/**
 * Convierte el hostname exacto del deployment actual informado por Vercel en
 * un origen HTTPS. No acepta paths, puertos, credenciales ni otros dominios.
 */
function normalizeVercelDeploymentOrigin(raw: string | undefined): string | null {
  if (!raw || raw !== raw.trim()) return null;
  if (raw.length > 253) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/i.test(raw)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(`https://${raw}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return null;
  if (!hostname.endsWith(".vercel.app") || hostname === "vercel.app") return null;
  if (url.port || url.pathname !== "/" || url.search || url.hash) return null;
  if (url.username || url.password) return null;
  if (raw.toLowerCase() !== hostname) return null;

  return `https://${hostname}`;
}

function buildAllowedOrigins(
  siteOrigin: string,
  rawList: string | undefined,
  vercelDeploymentHost: string | undefined,
  isProduction: boolean,
): string[] {
  const set = new Set<string>();
  const site = normalizeOriginStrict(siteOrigin);
  if (site) set.add(site);
  if (rawList) {
    for (const part of rawList.split(",")) {
      const norm = normalizeOriginStrict(part);
      if (norm) set.add(norm);
    }
  }
  const vercelDeploymentOrigin = normalizeVercelDeploymentOrigin(vercelDeploymentHost);
  if (vercelDeploymentOrigin) set.add(vercelDeploymentOrigin);
  if (!isProduction) {
    set.add("http://localhost:8080");
    set.add("http://localhost:3000");
    set.add("http://127.0.0.1:8080");
  }
  return Array.from(set);
}

/**
 * Resolve the Mercado Pago credential set for the currently selected env.
 * Never falls back across environments.
 *
 * Throws:
 *   PAYMENT_ENVIRONMENT_NOT_CONFIGURED — MERCADOPAGO_ENV is missing.
 *   PAYMENT_CREDENTIALS_INCOMPLETE      — the selected pair is missing keys.
 */
export function getMercadoPagoConfig(): MercadoPagoConfig {
  const cfg = getServerConfig();
  const raw = cachedRaw;
  if (!raw || !cfg.mpEnv) {
    const err = new Error(
      "PAYMENT_ENVIRONMENT_NOT_CONFIGURED: MERCADOPAGO_ENV no está definido (test|production)",
    ) as Error & { code: string };
    err.code = "PAYMENT_ENVIRONMENT_NOT_CONFIGURED";
    throw err;
  }
  const isProd = cfg.mpEnv === "production";
  const accessToken = isProd
    ? raw.MERCADOPAGO_ACCESS_TOKEN_PRODUCTION
    : raw.MERCADOPAGO_ACCESS_TOKEN_TEST;
  const publicKey = isProd
    ? raw.MERCADOPAGO_PUBLIC_KEY_PRODUCTION
    : raw.MERCADOPAGO_PUBLIC_KEY_TEST;
  const webhookSecret = isProd
    ? raw.MERCADOPAGO_WEBHOOK_SECRET_PRODUCTION
    : raw.MERCADOPAGO_WEBHOOK_SECRET_TEST;
  const collectorId =
    (isProd ? raw.MERCADOPAGO_COLLECTOR_ID_PRODUCTION : raw.MERCADOPAGO_COLLECTOR_ID_TEST) ?? null;

  const missing: string[] = [];
  const suffix = isProd ? "PRODUCTION" : "TEST";
  if (!accessToken) missing.push(`MERCADOPAGO_ACCESS_TOKEN_${suffix}`);
  if (!publicKey) missing.push(`MERCADOPAGO_PUBLIC_KEY_${suffix}`);
  if (!webhookSecret) missing.push(`MERCADOPAGO_WEBHOOK_SECRET_${suffix}`);
  if (missing.length > 0) {
    const err = new Error(`PAYMENT_CREDENTIALS_INCOMPLETE: ${missing.join(", ")}`) as Error & {
      code: string;
      missing: string[];
    };
    err.code = "PAYMENT_CREDENTIALS_INCOMPLETE";
    err.missing = missing;
    throw err;
  }
  return {
    env: cfg.mpEnv,
    isLiveMode: isProd,
    accessToken: accessToken!,
    publicKey: publicKey!,
    webhookSecret: webhookSecret!,
    collectorId,
  };
}

/** Non-throwing probe used by diagnostics. */
export function tryGetMercadoPagoConfig(): MercadoPagoConfig | null {
  try {
    return getMercadoPagoConfig();
  } catch {
    return null;
  }
}

// Lightweight helpers that never throw — used by the request-header layer.
export function tryGetSiteOrigin(): string | null {
  try {
    return getServerConfig().siteOrigin;
  } catch {
    return null;
  }
}

export function tryGetAllowedOrigins(): string[] {
  try {
    return getServerConfig().allowedOrigins;
  } catch {
    return [];
  }
}

/** Dedicated CSRF signing key — MUST NOT reuse any other secret. */
export function getCsrfSigningKey(): string {
  const cfg = getServerConfig();
  if (!cfg.csrfSigningSecret) {
    throw new Error("CSRF_SIGNING_SECRET no configurado — no se puede firmar tokens CSRF");
  }
  return cfg.csrfSigningSecret + "|csrf-v1";
}

/**
 * Enforce every precondition required to run MP in production mode.
 * Throws PRODUCTION_PAYMENT_CONFIGURATION_INCOMPLETE with details.
 * Called from any code path that would create or process a live payment.
 */
export function assertProductionPaymentsConfigured(): void {
  const cfg = getServerConfig();
  if (cfg.mpEnv !== "production") return;

  const missing: string[] = [];
  if (!cfg.isProduction) missing.push("NODE_ENV=production");
  if (!cfg.paymentsEnabled) missing.push("PAYMENTS_ENABLED=true");

  let u: URL | null = null;
  try {
    u = new URL(cfg.siteOrigin);
  } catch {
    missing.push("PUBLIC_SITE_URL válida");
  }
  if (u) {
    if (u.protocol !== "https:") missing.push("PUBLIC_SITE_URL HTTPS");
    const host = u.hostname;
    const isPreviewOrLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".lovable.app") ||
      host.endsWith(".lovable.dev") ||
      host.includes("id-preview") ||
      host.includes("-dev.");
    if (isPreviewOrLocal) missing.push("PUBLIC_SITE_URL dominio definitivo");
  }

  try {
    const mp = getMercadoPagoConfig();
    if (!mp.collectorId) missing.push("MERCADOPAGO_COLLECTOR_ID_PRODUCTION");
  } catch (e) {
    const code = (e as { code?: string })?.code;
    missing.push(code ?? "MERCADOPAGO_CREDENTIALS_PRODUCTION");
  }
  if (!cfg.cleanupCronSecret) missing.push("CLEANUP_CRON_SECRET");
  if (!cfg.csrfSigningSecret) missing.push("CSRF_SIGNING_SECRET");

  if (missing.length > 0) {
    const err = new Error(
      `PRODUCTION_PAYMENT_CONFIGURATION_INCOMPLETE: ${missing.join(", ")}`,
    ) as Error & { code: string; missing: string[] };
    err.code = "PRODUCTION_PAYMENT_CONFIGURATION_INCOMPLETE";
    err.missing = missing;
    throw err;
  }
}

// ------------------------------------------------------------------
// Admin key selection & validation.
//
// The admin (privileged) Supabase client MUST NOT fall back to a
// publishable/anon key, nor inherit the caller's JWT. Accept only:
//   1. SUPABASE_ADMIN_KEY
//   2. SUPABASE_SECRET_KEY
//   3. SUPABASE_SERVICE_ROLE_KEY
// ------------------------------------------------------------------
export type SupabaseAdminKeyType = "secret" | "legacy_service_role";
export type SupabaseAdminKeyConfig = {
  key: string;
  type: SupabaseAdminKeyType;
};

function decodeJwtRoleClaim(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const json = Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(json) as { role?: unknown };
    return typeof obj.role === "string" ? obj.role : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the administrative Supabase key. Never falls back to a
 * publishable/anon key or a browser session. Throws with a stable code
 * on any misconfiguration. Never logs the key or fragments of it.
 */
export function getSupabaseAdminKeyConfig(): SupabaseAdminKeyConfig {
  const raw =
    process.env.SUPABASE_ADMIN_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw || raw.length < 10) {
    const err = new Error("SUPABASE_ADMIN_KEY_MISSING") as Error & {
      code: string;
    };
    err.code = "SUPABASE_ADMIN_KEY_MISSING";
    throw err;
  }
  if (raw.startsWith("sb_publishable_")) {
    const err = new Error("SUPABASE_ADMIN_KEY_IS_PUBLISHABLE") as Error & {
      code: string;
    };
    err.code = "SUPABASE_ADMIN_KEY_IS_PUBLISHABLE";
    throw err;
  }
  if (raw.startsWith("sb_secret_")) {
    return { key: raw, type: "secret" };
  }
  if (raw.split(".").length === 3) {
    const role = decodeJwtRoleClaim(raw);
    if (role !== "service_role") {
      const err = new Error("SUPABASE_ADMIN_KEY_INVALID_ROLE") as Error & {
        code: string;
      };
      err.code = "SUPABASE_ADMIN_KEY_INVALID_ROLE";
      throw err;
    }
    return { key: raw, type: "legacy_service_role" };
  }
  const err = new Error("SUPABASE_ADMIN_KEY_INVALID") as Error & {
    code: string;
  };
  err.code = "SUPABASE_ADMIN_KEY_INVALID";
  throw err;
}

export type AdminKeyDiagLabel = "secret" | "legacy_service_role" | "invalida" | "ausente";

function classifyAdminKey(): {
  configured: boolean;
  label: AdminKeyDiagLabel;
} {
  try {
    const c = getSupabaseAdminKeyConfig();
    return { configured: true, label: c.type };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "SUPABASE_ADMIN_KEY_MISSING") {
      return { configured: false, label: "ausente" };
    }
    return { configured: false, label: "invalida" };
  }
}

/**
 * Controlled probe against consume_rate_limit using the admin client.
 * Booleans only — never returns error strings or fragments of the key.
 */
async function probeAdminClient(): Promise<boolean> {
  try {
    const adminUrl = getSupabaseAdminUrl();
    const admin = getSupabaseAdminKeyConfig();
    const headers: Record<string, string> = {
      apikey: admin.key,
      "content-type": "application/json",
      accept: "application/json",
    };
    if (admin.type === "legacy_service_role") {
      headers.Authorization = `Bearer ${admin.key}`;
    }
    const resp = await fetch(`${adminUrl}/rest/v1/rpc/consume_rate_limit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_scope: "admin_key_diagnostic",
        p_bucket_key: "diag",
        p_limit: 2,
        p_window_seconds: 60,
      }),
    });
    if (!resp.ok) {
      try {
        await resp.text();
      } catch {}
      return false;
    }
    try {
      await fetch(`${adminUrl}/rest/v1/rate_limits?scope=eq.admin_key_diagnostic`, {
        method: "DELETE",
        headers,
      });
    } catch {}
    return true;
  } catch {
    return false;
  }
}

export type PaymentsGateSummary = {
  mpEnv: MpEnv | null;
  paymentsEnabled: boolean;
  credentialsConfigured: boolean;
  webhookConfigured: boolean;
  collectorConfigured: boolean;
  cronSecretConfigured: boolean;
  csrfSigningSecretConfigured: boolean;
  cspReportOnly: boolean;
  siteOriginHttps: boolean;
  productionReady: boolean;
  adminKeyConfigured: boolean;
  adminKeyType: AdminKeyDiagLabel;
  adminClientValidated: boolean;
};

/** Simple boolean form for diagnostics — no throw, no values. */
export async function getPaymentsGateSummary(): Promise<PaymentsGateSummary> {
  const adminKey = classifyAdminKey();
  const adminClientValidated = adminKey.configured ? await probeAdminClient() : false;
  try {
    const cfg = getServerConfig();
    const mp = tryGetMercadoPagoConfig();
    let productionReady = true;
    try {
      assertProductionPaymentsConfigured();
    } catch {
      productionReady = false;
    }
    let siteOriginHttps = false;
    try {
      siteOriginHttps = new URL(cfg.siteOrigin).protocol === "https:";
    } catch {
      siteOriginHttps = false;
    }
    return {
      mpEnv: cfg.mpEnv,
      paymentsEnabled: cfg.paymentsEnabled,
      credentialsConfigured: !!mp,
      webhookConfigured: !!mp?.webhookSecret,
      collectorConfigured: !!mp?.collectorId,
      cronSecretConfigured: !!cfg.cleanupCronSecret,
      csrfSigningSecretConfigured: !!cfg.csrfSigningSecret,
      cspReportOnly: cfg.cspReportOnly,
      siteOriginHttps,
      productionReady: cfg.mpEnv === "production" ? productionReady : true,
      adminKeyConfigured: adminKey.configured,
      adminKeyType: adminKey.label,
      adminClientValidated,
    };
  } catch {
    return {
      mpEnv: null,
      paymentsEnabled: false,
      credentialsConfigured: false,
      webhookConfigured: false,
      collectorConfigured: false,
      cronSecretConfigured: false,
      csrfSigningSecretConfigured: false,
      cspReportOnly: false,
      siteOriginHttps: false,
      productionReady: false,
      adminKeyConfigured: adminKey.configured,
      adminKeyType: adminKey.label,
      adminClientValidated,
    };
  }
}
