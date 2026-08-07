// Signed CSRF token: HMAC-signed payload bound to (sessionId, orderId, exp).
// Stateless — no per-request rotation needed, so multiple tabs and reloads
// can operate concurrently. The token is only accepted while the session
// referenced by sessionId is still active (verified by the caller).
import { createHmac, timingSafeEqual } from "crypto";
import { getCsrfSigningKey } from "@/lib/server-config";

const DEFAULT_TTL_SECONDS = 60 * 60 * 6; // 6h

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}
function fromB64u(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export interface CsrfPayload {
  sessionId: string;
  orderId: string;
  exp: number;
}

function sign(payload: string): string {
  return b64u(
    createHmac("sha256", getCsrfSigningKey())
      .update(payload, "utf8")
      .digest(),
  );
}

export function issueSignedCsrfToken(
  sessionId: string,
  orderId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const payload: CsrfPayload = {
    sessionId,
    orderId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export function verifySignedCsrfToken(
  token: string,
  expected: { sessionId: string; orderId: string },
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  if (!body || !sig) return false;
  const expectedSig = sign(body);
  const a = fromB64u(sig);
  const b = fromB64u(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  let payload: CsrfPayload;
  try {
    payload = JSON.parse(fromB64u(body).toString("utf8")) as CsrfPayload;
  } catch {
    return false;
  }
  if (!payload || typeof payload.exp !== "number") return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;
  if (payload.sessionId !== expected.sessionId) return false;
  if (payload.orderId !== expected.orderId) return false;
  return true;
}
