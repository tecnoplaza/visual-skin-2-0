const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_COOKIE_RE = /(?:^|;\s*)vs_order_sid=[^;\s]+/;

export function shouldReturnGenericOrder404(url: URL, cookieHeader: string | null): boolean {
  const match = /^\/pedido\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return false;
  if (!UUID_RE.test(match[1])) return true;
  if (SESSION_COOKIE_RE.test(cookieHeader ?? "")) return false;
  const token = url.searchParams.get("token");
  return !token || token.length < 20 || token.length > 200;
}

export function genericOrderNotFoundHtml(): string {
  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Pedido no accesible — VISUALSKIN</title></head><body><main><h1>Pedido no accesible</h1><p>No fue posible acceder al pedido solicitado.</p></main></body></html>`;
}
