import { timingSafeEqual } from "crypto";

export type NotificationMethod = "GET" | "POST";
export type NotificationSecrets = {
  cronSecret: string | null;
  notificationCronSecret: string | null;
};

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function notificationAuthorizationStatus(
  request: Request,
  expectedSecret: string | null,
): 200 | 401 | 503 {
  if (!expectedSecret) return 503;
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match || !safeEqual(match[1].trim(), expectedSecret)) return 401;
  return 200;
}

export async function handleAuthenticatedNotificationRequest<T extends NotificationSecrets>(
  request: Request,
  method: NotificationMethod,
  config: T,
  worker: (config: T) => Promise<Response>,
): Promise<Response> {
  const expectedSecret = method === "GET" ? config.cronSecret : config.notificationCronSecret;
  const authStatus = notificationAuthorizationStatus(request, expectedSecret);
  if (authStatus === 503) return jsonResponse({ ok: false, error: "endpoint_disabled" }, 503);
  if (authStatus === 401) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  return worker(config);
}
