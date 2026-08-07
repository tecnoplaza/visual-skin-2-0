// DEPRECATED endpoint. The canonical Mercado Pago webhook receiver is the
// Supabase Edge Function at /functions/v1/mercadopago-webhook. This route is
// preserved only so routeTree.gen.ts does not break; it performs no work and
// responds 410 Gone to all requests.
import { createFileRoute } from "@tanstack/react-router";

const GONE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
} as const;

function gone(): Response {
  return new Response("deprecated webhook endpoint", {
    status: 410,
    headers: GONE_HEADERS,
  });
}

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      GET: async () => gone(),
      POST: async () => gone(),
    },
  },
});
