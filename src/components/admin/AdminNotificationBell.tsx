import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type AdminNotification = {
  id: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "critical";
  order_id: string | null;
  is_read: boolean;
  created_at: string;
};

export default function AdminNotificationBell() {
  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const db = supabase as any;
  const load = useCallback(async () => {
    setLoading(true);
    const [list, unread] = await Promise.all([
      db.rpc("admin_list_notifications", { p_limit: 20 }),
      db.rpc("admin_unread_notification_count"),
    ]);
    if (!list.error) setRows(list.data ?? []);
    if (!unread.error) setCount(Number(unread.data ?? 0));
    setLoading(false);
  }, [db]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const markRead = async (id: string) => {
    await db.rpc("admin_mark_notification_read", { p_notification_id: id });
    setRows((xs) => xs.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setCount((n) => Math.max(0, n - 1));
  };
  const markAll = async () => {
    await db.rpc("admin_mark_all_notifications_read");
    setRows((xs) => xs.map((n) => ({ ...n, is_read: true })));
    setCount(0);
  };
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={`Notificaciones${count ? `, ${count} sin leer` : ""}`}
          className="relative grid h-10 w-10 place-items-center rounded-lg border border-border hover:border-neon-blue/60"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-destructive px-1 text-[11px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="font-semibold">Notificaciones</span>
          <button
            onClick={() => void markAll()}
            className="inline-flex items-center gap-1 text-xs text-neon-blue"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Marcar todas
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && rows.length === 0 && (
            <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />
          )}
          {!loading && rows.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Sin notificaciones.</p>
          )}
          {rows.map((n) => (
            <a
              key={n.id}
              href={n.order_id ? `/admin/orders/${n.order_id}` : "/admin"}
              onClick={() => void markRead(n.id)}
              className={`block border-b border-border p-3 hover:bg-secondary/50 ${n.is_read ? "opacity-65" : "bg-neon-blue/5"}`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.severity === "critical" ? "bg-destructive" : n.severity === "warning" ? "bg-amber-400" : n.severity === "success" ? "bg-neon-green" : "bg-neon-blue"}`}
                />
                <div>
                  <p className="text-sm font-semibold">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                  <time className="mt-1 block text-[10px] text-muted-foreground">
                    {new Intl.DateTimeFormat("es-CL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(n.created_at))}
                  </time>
                </div>
              </div>
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
