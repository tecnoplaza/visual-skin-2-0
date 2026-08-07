// Security-header + CSP helpers, server-only.
// Applied to HTML responses under /pedido/* by src/server.ts and reused
// by order-scoped server functions.
//
// §11 Two policies are built:
//   - APPLIED: permissive, keeps 'unsafe-inline' in script-src so Payment
//     Brick continues to work.
//   - STRICT candidate (Report-Only only): drops 'unsafe-inline' from
//     script-src so real violations surface via /api/public/hooks/csp-report
//     without breaking Brick. Ship both headers only when CSP_REPORT_ONLY=1.
import {
  tryGetSiteOrigin,
  getServerConfig,
  getSupabaseAdminUrl,
} from "@/lib/server-config";

const MP_HOSTS = [
  "https://sdk.mercadopago.com",
  "https://http2.mlstatic.com",
  "https://secure.mlstatic.com",
  "https://api.mercadopago.com",
  "https://events.mercadopago.com",
  "https://www.mercadopago.com",
  "https://www.mercadopago.cl",
  "https://api.mercadolibre.com",
  "https://www.mercadolibre.com",
  "https://secure-fields.mercadopago.com",
  "https://api-static.mercadopago.com",
];

const MP_FRAME_HOSTS = [
  "https://sdk.mercadopago.com",
  "https://www.mercadopago.com",
  "https://www.mercadopago.cl",
  "https://api.mercadopago.com",
  "https://http2.mlstatic.com",
  "https://secure.mlstatic.com",
  "https://secure-fields.mercadopago.com",
  "https://www.mercadolibre.com",
];

const MP_IMG_HOSTS = [
  "https://http2.mlstatic.com",
  "https://www.mercadolibre.com",
  "https://www.mercadolivre.com",
  // Fallback issuer/brand logos are served from mercadopago.com when the
  // primary mlstatic CDN returns 403.
  "https://www.mercadopago.com",
];

function supabaseHosts(): string[] {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(getServerConfig().supabaseUrl).origin);
  } catch {
    /* ignore */
  }
  // Signed URLs for private buckets (order-designs) are minted against the
  // admin Supabase URL (arbupyyhdrlawxlqbkbs.supabase.co), which differs from
  // the Data API URL routed via lovable.cloud. Without this host in img-src /
  // connect-src, the browser blocks the signed image and only the alt text
  // shows after a reload.
  try {
    hosts.add(new URL(getSupabaseAdminUrl()).origin);
  } catch {
    /* admin URL not configured — nothing to add */
  }
  return Array.from(hosts);
}

type CspVariant = "applied" | "strict-report-only";

function buildCsp(variant: CspVariant): string {
  const site = tryGetSiteOrigin();
  const supa = supabaseHosts();
  const self = "'self'";
  const scriptParts: string[] = [self];
  if (variant === "applied") scriptParts.push("'unsafe-inline'", "'unsafe-eval'");
  scriptParts.push(...MP_HOSTS);
  const script = scriptParts.join(" ");
  const styleUrls = [self, "'unsafe-inline'", "https://http2.mlstatic.com"].join(" ");
  const img = [self, "data:", "blob:", ...supa, ...MP_IMG_HOSTS].join(" ");
  const font = [self, "data:", "https://http2.mlstatic.com"].join(" ");
  const connect = [self, ...supa, ...MP_HOSTS, site].filter(Boolean).join(" ");
  const frame = [self, ...MP_FRAME_HOSTS].join(" ");
  const worker = [self, "blob:"].join(" ");
  return [
    `default-src ${self}`,
    `base-uri ${self}`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action ${self}`,
    `script-src ${script}`,
    `style-src ${styleUrls}`,
    `img-src ${img}`,
    `font-src ${font}`,
    `connect-src ${connect}`,
    `frame-src ${frame}`,
    `worker-src ${worker}`,
  ].join("; ");
}

export const ORDER_SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, private, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function applyOrderSecurityHeaders(response: Response): Response {
  const h = new Headers(response.headers);
  for (const [k, v] of Object.entries(ORDER_SECURITY_HEADERS)) h.set(k, v);
  let reportOnly = false;
  try {
    reportOnly = getServerConfig().cspReportOnly;
  } catch {
    /* config unavailable — apply enforcing CSP */
  }
  h.delete("Content-Security-Policy");
  h.delete("Content-Security-Policy-Report-Only");
  h.set("Content-Security-Policy", buildCsp("applied"));
  if (reportOnly) {
    h.set(
      "Content-Security-Policy-Report-Only",
      `${buildCsp("strict-report-only")}; report-uri /api/public/hooks/csp-report`,
    );
  }
  h.set("X-VisualSkin-CSP-Revision", "mp-secure-fields-v3");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}

export function isOrderPath(pathname: string): boolean {
  return pathname === "/pedido" || pathname.startsWith("/pedido/");
}
