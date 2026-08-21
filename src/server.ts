import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applyOrderSecurityHeaders, isOrderPath } from "./lib/security-headers";
import { genericOrderNotFoundHtml, shouldReturnGenericOrder404 } from "./lib/order-page-http";
import { PRIVATE_ROBOTS_DIRECTIVE } from "./lib/seo";

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function applyRobotsHeader(response: Response, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}


type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    const orderScoped = isOrderPath(url.pathname);
    const adminScoped = isAdminPath(url.pathname);
    const apiScoped = isApiPath(url.pathname);
    const cartScoped = url.pathname === "/carrito";
    if (orderScoped && shouldReturnGenericOrder404(url, request.headers.get("cookie"))) {
      return applyOrderSecurityHeaders(
        new Response(genericOrderNotFoundHtml(), {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      if (orderScoped) return applyOrderSecurityHeaders(normalized);
      if (adminScoped || cartScoped) return applyRobotsHeader(normalized, PRIVATE_ROBOTS_DIRECTIVE);
      if (apiScoped) return applyRobotsHeader(normalized, "noindex");
      return normalized;
    } catch (error) {
      console.error(error);
      const errResp = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      if (orderScoped) return applyOrderSecurityHeaders(errResp);
      if (adminScoped || cartScoped) return applyRobotsHeader(errResp, PRIVATE_ROBOTS_DIRECTIVE);
      if (apiScoped) return applyRobotsHeader(errResp, "noindex");
      return errResp;
    }
  },
};
