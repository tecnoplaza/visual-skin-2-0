// Persistent rate limiting via public.rate_limits + consume_rate_limit RPC.
// Never store raw IPs — always hashed. Never call for the MP webhook.
import { createHash } from "crypto";
import { setResponseStatus, setResponseHeader } from "@tanstack/react-start/server";

export type RateLimitScope =
  | "create_order"
  | "exchange_token"
  | "request_upload"
  | "finalize_design"
  | "mark_failed"
  | "process_payment"
  | "recovery_request"
  | "recovery_consume"
  | "order_read"
  | "csp_report";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function hashBucketKey(...parts: (string | null | undefined)[]): string {
  const norm = parts.map((p) => (p ?? "").toString().trim().toLowerCase()).join("|");
  return createHash("sha256").update(norm, "utf8").digest("hex");
}

export function ipHashFromRequest(req: Request): string {
  const raw =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0";
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

export async function consumeRateLimit(
  scope: RateLimitScope,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit" as any, {
    p_scope: scope,
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  } as any);
  if (error) {
    console.error("[rate-limit-rpc-error]", {
      scope,
      code: (error as any).code,
      message: (error as any).message,
      details: (error as any).details,
      hint: (error as any).hint,
    });
    throwBackendError();
  }

  // Normalize response shape safely.
  let raw: unknown = data;
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      console.error("[rate-limit-rpc-error]", {
        scope,
        code: "invalid_json",
        message: "RPC returned non-JSON string",
        details: null,
        hint: null,
      });
      throwBackendError();
    }
  }
  if (!raw || typeof raw !== "object" || typeof (raw as any).allowed !== "boolean") {
    console.error("[rate-limit-rpc-error]", {
      scope,
      code: "invalid_shape",
      message: "RPC response missing boolean allowed",
      details: null,
      hint: null,
    });
    throwBackendError();
  }
  const r = raw as { allowed: boolean; remaining: number; retry_after_seconds: number };
  return {
    allowed: !!r.allowed,
    remaining: r.remaining ?? 0,
    retryAfterSeconds: r.retry_after_seconds ?? 60,
  };
}

function throwBackendError(): never {
  try {
    setResponseStatus(503);
    setResponseHeader("Retry-After", "30");
    setResponseHeader("Cache-Control", "no-store");
  } catch {
    /* outside request context */
  }
  const err = new Error("RATE_LIMIT_BACKEND_ERROR") as Error & {
    code: "RATE_LIMIT_BACKEND_ERROR";
    retryAfter: number;
    status: number;
  };
  err.code = "RATE_LIMIT_BACKEND_ERROR";
  err.retryAfter = 30;
  err.status = 503;
  throw err;
}

/** Throws a RATE_LIMITED error with retryAfter attached when exceeded. */
export async function enforceRateLimit(
  scope: RateLimitScope,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const r = await consumeRateLimit(scope, bucketKey, limit, windowSeconds);
  if (!r.allowed) {
    try {
      setResponseStatus(429);
      setResponseHeader("Retry-After", String(r.retryAfterSeconds));
      setResponseHeader("Cache-Control", "no-store");
      setResponseHeader("X-RateLimit-Scope", scope);
    } catch {
      /* outside request context (tests) */
    }
    const err = new Error("RATE_LIMITED") as Error & {
      code: "RATE_LIMITED";
      retryAfter: number;
      status: number;
    };
    err.code = "RATE_LIMITED";
    err.retryAfter = r.retryAfterSeconds;
    err.status = 429;
    throw err;
  }
}


export const RATE_LIMITS = {
  create_order:      { limit: 10, window: 60 * 60 },        // 10 / hour / ip
  exchange_token:    { limit: 10, window: 15 * 60 },        // 10 / 15 min / order
  request_upload:    { limit: 15, window: 60 * 60 },        // 15 / hour / order
  finalize_design:   { limit: 10, window: 60 * 60 },        // 10 / hour / order
  mark_failed:       { limit: 10, window: 60 * 60 },
  process_payment:   { limit: 6,  window: 60 * 60 },        //  6 / hour / order
  recovery_request_email: { limit: 5,  window: 60 * 60 },   //  5 / hour / email
  recovery_request_ip:    { limit: 10, window: 60 * 60 },   // 10 / hour / ip
  recovery_consume:  { limit: 20, window: 60 * 60 },
  order_read:        { limit: 240, window: 60 * 60 },       // wide, backend read
  csp_report:        { limit: 60,  window: 60 },            // 60 / min / ip
} as const;
