// CSP violation report sink (Phase 1 — Report-Only).
// Logs only: violated-directive, blocked host, generic path, timestamp.
// Never logs query strings, cookies, tokens, or PII.
// POST-only. 8 KB body cap. IP-scoped rate limit.
import { createFileRoute } from "@tanstack/react-router";
import {
  consumeRateLimit,
  hashBucketKey,
  ipHashFromRequest,
  RATE_LIMITS,
} from "@/lib/rate-limit";

interface CspReport {
  "csp-report"?: {
    "violated-directive"?: string;
    "blocked-uri"?: string;
    "document-uri"?: string;
  };
}

const MAX_BODY_BYTES = 8 * 1024;

function safeHost(u: string | undefined): string {
  if (!u) return "-";
  if (u === "inline" || u === "eval" || u === "self") return u;
  try {
    return new URL(u).host || "-";
  } catch {
    return "-";
  }
}

function safePath(u: string | undefined): string {
  if (!u) return "-";
  try {
    return new URL(u).pathname.split("/").slice(0, 3).join("/") || "/";
  } catch {
    return "-";
  }
}

function noStore(status: number, body: string | null = null): Response {
  return new Response(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleReport(request: Request): Promise<Response> {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();
  if (
    !ct.includes("application/csp-report") &&
    !ct.includes("application/json") &&
    !ct.includes("application/reports+json")
  ) {
    return noStore(415);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared && declared > MAX_BODY_BYTES) return noStore(413);

  // Rate-limit by hashed IP, fail-closed on RPC failure.
  const ipHash = ipHashFromRequest(request);
  const rl = await consumeRateLimit(
    "csp_report",
    hashBucketKey("csp_report_ip", ipHash),
    RATE_LIMITS.csp_report.limit,
    RATE_LIMITS.csp_report.window,
  );
  if (!rl.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(rl.retryAfterSeconds),
      },
    });
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return noStore(400);
  }
  if (raw.length > MAX_BODY_BYTES) return noStore(413);

  let body: CspReport = {};
  try {
    body = JSON.parse(raw) as CspReport;
  } catch {
    return noStore(204);
  }
  const r = body["csp-report"] ?? {};
  console.warn("[csp-report]", {
    ts: new Date().toISOString(),
    directive: (r["violated-directive"] ?? "-").split(" ")[0],
    blocked: safeHost(r["blocked-uri"]),
    path: safePath(r["document-uri"]),
  });
  return noStore(204);
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/hooks/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => handleReport(request),
      GET: async () => methodNotAllowed(),
    },
  },
});
