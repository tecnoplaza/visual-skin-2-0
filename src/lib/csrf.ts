// Origin/Referer + token CSRF protection for cookie-authenticated server fns.
// The MP webhook is protected by HMAC and MUST NOT use this helper.
import { getRequest } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual, randomBytes } from "crypto";
import { tryGetAllowedOrigins } from "@/lib/server-config";

function extractOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function hashCsrfToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function constantTimeEqHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Rejects any mutating request whose Origin does not match PUBLIC_SITE_URL.
 * Fail-closed on both config errors and missing request context.
 */
export function assertSameOrigin(): void {
  const allowed = tryGetAllowedOrigins();
  if (allowed.length === 0) throw new Error("CSRF: server not configured");
  let req: Request;
  try {
    req = getRequest();
  } catch {
    throw new Error("CSRF: request context unavailable");
  }
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    throw new Error("CSRF: método no admitido para mutación");
  }
  const originHeader = extractOrigin(req.headers.get("origin"));
  const refererHeader = extractOrigin(req.headers.get("referer"));
  const seen = originHeader ?? refererHeader;
  if (!seen) throw new Error("CSRF: origin ausente");
  if (!allowed.includes(seen)) throw new Error("CSRF: origen no autorizado");

  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) {
    throw new Error("CSRF: content-type inválido");
  }
}

/**
 * Verify X-CSRF-Token header against a session-bound hash (constant time).
 * Call AFTER loading the session row.
 */
import { verifySignedCsrfToken } from "@/lib/csrf-signed";

/**
 * Verify X-CSRF-Token. Prefers a signed token bound to (sessionId, orderId);
 * falls back to a legacy per-session hashed token when provided.
 */
export function assertCsrfToken(
  expectedHash: string | null | undefined,
  boundTo?: { sessionId: string; orderId: string },
): void {
  let req: Request;
  try {
    req = getRequest();
  } catch {
    throw new Error("CSRF: request context unavailable");
  }
  const raw = req.headers.get("x-csrf-token");
  if (!raw || raw.length < 20 || raw.length > 400) {
    throw new Error("CSRF: token ausente");
  }
  if (boundTo && verifySignedCsrfToken(raw, boundTo)) return;
  if (expectedHash) {
    const providedHash = hashCsrfToken(raw);
    if (constantTimeEqHex(providedHash, expectedHash)) return;
  }
  throw new Error("CSRF: token inválido");
}
