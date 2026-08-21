export function hasPendingSensitiveToken(search: string): boolean {
  return new URLSearchParams(search).has("token");
}

export function sanitizedPageLocation(): string {
  const origin = window.location?.origin || "https://www.visualskin.cl";
  const pathname = window.location?.pathname?.startsWith("/") ? window.location.pathname : "/";
  return new URL(pathname, origin).toString();
}
