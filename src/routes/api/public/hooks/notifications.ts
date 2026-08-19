import { createFileRoute } from "@tanstack/react-router";
import { getServerConfig, type ServerConfig } from "@/lib/server-config";
import {
  handleAuthenticatedNotificationRequest,
  type NotificationMethod,
} from "@/lib/notification-worker-http";
import {
  containsSensitiveNotificationData,
  renderNotificationEmail,
} from "@/lib/notification-email";

type OutboxRow = {
  id: string;
  event_type: string;
  recipient_type: "customer" | "admin";
  recipient_email: string | null;
  order_id: string | null;
  payload: Record<string, unknown>;
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function sendWithResend(
  apiKey: string,
  from: string,
  to: string,
  message: ReturnType<typeof renderNotificationEmail>,
) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!r.ok) throw new Error(`email_provider_http_${r.status}`);
}

async function processNotificationOutbox(cfg: ServerConfig): Promise<Response> {
  if (
    !cfg.emailProviderConfigured ||
    cfg.emailProvider !== "resend" ||
    !cfg.emailProviderApiKey ||
    !cfg.emailFrom
  ) {
    return response({ ok: false, error: "email_provider_not_configured" }, 503);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "claim_notification_outbox_v1" as any,
    { p_limit: 20 } as any,
  );
  if (error) return response({ ok: false, error: "outbox_claim_failed" }, 500);
  const rows = (data ?? []) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const to = row.recipient_type === "admin" ? cfg.adminNotificationEmail : row.recipient_email;
      if (!to) throw new Error("recipient_not_configured");
      const payload = { ...row.payload, order_id: row.order_id };
      if (containsSensitiveNotificationData(payload)) throw new Error("sensitive_payload_rejected");
      const message = renderNotificationEmail(row.event_type, payload, cfg.siteOrigin);
      await sendWithResend(cfg.emailProviderApiKey, cfg.emailFrom, to, message);
      await supabaseAdmin.rpc("complete_notification_outbox_v1" as any, { p_id: row.id } as any);
      sent++;
    } catch (e) {
      await supabaseAdmin.rpc(
        "fail_notification_outbox_v1" as any,
        {
          p_id: row.id,
          p_error: e instanceof Error ? e.message : "provider_error",
        } as any,
      );
      failed++;
    }
  }
  return response({ ok: true, claimed: rows.length, sent, failed });
}

type ConfigReader = () => ServerConfig;
type Worker = (config: ServerConfig) => Promise<Response>;

export async function handleNotificationRequest(
  request: Request,
  method: NotificationMethod,
  readConfig: ConfigReader = getServerConfig,
  worker: Worker = processNotificationOutbox,
): Promise<Response> {
  let cfg: ServerConfig;
  try {
    cfg = readConfig();
  } catch {
    return response({ ok: false, error: "server_misconfigured" }, 500);
  }
  return handleAuthenticatedNotificationRequest(request, method, cfg, worker);
}

export const Route = createFileRoute("/api/public/hooks/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => handleNotificationRequest(request, "POST"),
      GET: async ({ request }) => handleNotificationRequest(request, "GET"),
    },
  },
});
