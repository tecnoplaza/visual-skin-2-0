// §15 Physical storage cleanup — POST-only, authenticated with
// CLEANUP_CRON_SECRET (Bearer). Never accepts the anon/publishable key,
// never accepts credentials in the URL, never logs the secret.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { getServerConfig } from "@/lib/server-config";

const LOCK_SCOPE = "storage_cleanup";
const LOCK_TTL_SECONDS = 5 * 60;
const BATCH = 50;
const BUCKETS = ["order-designs", "customer-uploads"];

function eqCT(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function noStore(body: BodyInit | null, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}

async function runCleanup(request: Request): Promise<Response> {
  let cfg;
  try {
    cfg = getServerConfig();
  } catch (e) {
    console.error("[cleanup] server-config invalid");
    return noStore("Server misconfigured", 500);
  }
  const expected = cfg.cleanupCronSecret;
  if (!expected) {
    // Endpoint disabled unless a secret is configured.
    return noStore("Cleanup endpoint disabled", 503);
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth) return noStore("Unauthorized", 401);
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return noStore("Unauthorized", 401);
  const provided = m[1].trim();
  if (!provided || !eqCT(provided, expected)) {
    return noStore("Forbidden", 403);
  }

  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const { data: lockOk } = await supabaseAdmin.rpc(
    "acquire_cleanup_lock" as any,
    {
      p_scope: LOCK_SCOPE,
      p_ttl_seconds: LOCK_TTL_SECONDS,
      p_actor: "cron",
    } as any,
  );
  if (!lockOk) {
    return new Response(JSON.stringify({ ok: true, skipped: "locked" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  const summary = {
    scanned: 0,
    orders_deleted: 0,
    objects_deleted: 0,
    errors: [] as string[],
  };

  try {
    const { data: rows } = await supabaseAdmin.rpc(
      "list_abandoned_orders" as any,
      { p_limit: BATCH } as any,
    );
    const orders = (rows ?? []) as { id: string }[];
    summary.scanned = orders.length;

    for (const o of orders) {
      let orderHasErrors = false;
      for (const bucket of BUCKETS) {
        try {
          const { data: list } = await supabaseAdmin.storage
            .from(bucket)
            .list(o.id, { limit: 200 });
          if (list && list.length > 0) {
            const paths = list.map((f) => `${o.id}/${f.name}`);
            const { error: rmErr } = await supabaseAdmin.storage
              .from(bucket)
              .remove(paths);
            if (rmErr) {
              orderHasErrors = true;
              summary.errors.push(
                `remove:${bucket}:${o.id}:${rmErr.message}`,
              );
            } else {
              summary.objects_deleted += paths.length;
            }
          }
        } catch (e) {
          orderHasErrors = true;
          summary.errors.push(
            `list:${bucket}:${o.id}:${(e as Error).message}`,
          );
        }
      }
      if (!orderHasErrors) {
        const { data: still } = await supabaseAdmin
          .from("custom_orders")
          .select("id,payment_status,design_status")
          .eq("id", o.id)
          .maybeSingle();
        if (
          still &&
          ["pending", "rejected", "cancelled"].includes(
            still.payment_status as string,
          ) &&
          (still as any).design_status !== "ready"
        ) {
          const { error: delErr } = await supabaseAdmin
            .from("custom_orders")
            .delete()
            .eq("id", o.id);
          if (delErr) {
            summary.errors.push(`order:${o.id}:${delErr.message}`);
          } else {
            summary.orders_deleted += 1;
          }
        }
      }
    }

    await supabaseAdmin
      .from("rate_limits")
      .delete()
      .lt("window_expires_at", new Date(Date.now() - 60_000).toISOString());
    await supabaseAdmin.rpc("cleanup_expired_payment_sessions" as any);
  } finally {
    await supabaseAdmin.rpc("release_cleanup_lock" as any, {
      p_scope: LOCK_SCOPE,
    } as any);
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/hooks/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => runCleanup(request),
      GET: async () => methodNotAllowed(),
    },
  },
});
