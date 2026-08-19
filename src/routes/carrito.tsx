import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { activeCartItems, activeCartQueryOptions, canContinueCart, cartItemPreviewSlots, cartPackLabel, designStatusLabel, CART_QUERY_KEY } from "@/lib/cart";
import { getOrderCsrfToken, removeOrderItem } from "@/lib/orders.functions";
import { setOrderCsrfToken } from "@/lib/order-csrf-store";
import { trackVisualSkinEvent } from "@/lib/analytics";

type Search = { added?: boolean };

export const Route = createFileRoute("/carrito")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    added: search.added === true || search.added === "1",
  }),
  component: CartPage,
  head: () => ({ meta: [
    { title: "Carrito — VISUALSKIN" },
    { name: "robots", content: "noindex,nofollow" },
  ] }),
});

const clp = (amount: number) => new Intl.NumberFormat("es-CL", {
  style: "currency", currency: "CLP", maximumFractionDigits: 0,
}).format(amount);

function CartPage() {
  const { added } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cartQuery = useQuery(activeCartQueryOptions());
  const cart = cartQuery.data;
  const items = useMemo(() => activeCartItems(cart), [cart]);
  const [noticeShown, setNoticeShown] = useState(false);

  useEffect(() => {
    if (added && !noticeShown) {
      toast.success("Producto agregado al carrito");
      setNoticeShown(true);
      void navigate({ to: "/carrito", search: {}, replace: true });
    }
  }, [added, navigate, noticeShown]);

  useEffect(() => {
    if (!cart?.order.id) return;
    void getOrderCsrfToken({ data: { orderId: cart.order.id } })
      .then((result) => setOrderCsrfToken(cart.order.id, result.csrfToken))
      .catch(() => undefined);
  }, [cart?.order.id]);

  const removeMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      if (!cart?.order.id) throw new Error("Carrito no disponible");
      await removeOrderItem({ data: { orderId: cart.order.id, orderItemId } });
    },
    onSuccess: async (_data, orderItemId) => {
      toast.success("Producto eliminado");
      trackVisualSkinEvent({event_name:"remove_from_cart",order_id:cart?.order.id,order_item_id:orderItemId});
      await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "No se pudo eliminar el producto";
      toast.error(message.includes("last_active_item_required")
        ? "No puedes eliminar el único producto del pedido. Puedes editarlo o agregar otro producto."
        : message);
    },
  });

  if (cartQuery.isLoading) return <Centered><Loader2 className="h-7 w-7 animate-spin text-neon-blue" /></Centered>;
  if (cartQuery.isError) return <Centered><AlertTriangle className="h-7 w-7 text-destructive" /><p>No pudimos cargar tu carrito.</p></Centered>;
  if (!cart || items.length === 0) return (
    <Centered>
      <ShoppingBag className="h-10 w-10 text-muted-foreground" />
      <h1 className="font-display text-2xl font-bold">Tu carrito está vacío</h1>
      <Link to="/crear-mi-pack" className="rounded-xl bg-neon-blue px-5 py-3 font-semibold text-black">Crear mi pack</Link>
    </Centered>
  );

  const ready = canContinueCart(cart);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[.2em] text-neon-blue">Pedido {cart.order.order_number ?? "activo"}</p><h1 className="font-display text-3xl font-bold">Tu carrito</h1></div>
        <Link to="/crear-mi-pack" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Agregar otro producto</Link>
      </div>
      {noticeShown && (
        <div className="mt-6 rounded-2xl border border-neon-green/40 bg-neon-green/10 p-5">
          <h2 className="font-display text-lg font-semibold text-neon-green">Producto agregado al carrito</h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link to="/crear-mi-pack" className="rounded-xl bg-neon-green px-4 py-2 text-center text-sm font-semibold text-black">Crear otro producto</Link>
            <a href="#productos" className="rounded-xl border border-border px-4 py-2 text-center text-sm font-semibold">Ver carrito</a>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section id="productos" className="space-y-4">
          {items.map((item, index) => {
            const discount = item.discount_amount;
            const previews = cartItemPreviewSlots(item);
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-5 sm:flex-row sm:justify-between">
                  <div className={`grid shrink-0 gap-2 ${previews.length === 1 ? "grid-cols-1" : previews.length === 2 ? "grid-cols-2" : "grid-cols-3"} sm:w-auto`}>
                    {previews.map((preview) => (
                      <figure key={preview.kind} className="min-w-0">
                        <div className="flex h-24 min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background sm:h-28 sm:w-24">
                          {preview.url ? (
                            <img src={preview.url} alt={`${preview.label} del producto ${index + 1}`} className="h-full w-full object-contain p-1.5" />
                          ) : (
                            <div className="px-2 text-center text-[10px] leading-tight text-muted-foreground">Preview no disponible</div>
                          )}
                        </div>
                        <figcaption className="mt-1 text-center text-[10px] font-medium text-muted-foreground">{preview.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <p className="text-xs text-muted-foreground">Producto {index + 1}</p>
                    <h2 className="font-display text-xl font-semibold">{cartPackLabel(item.pack_type)}</h2>
                    <p className="text-sm">{item.brand ? `${item.brand} · ` : ""}{item.phone_model ?? "Modelo pendiente"}</p>
                    {item.garment_id && <p className="text-sm text-muted-foreground">Prenda: {item.garment_size ?? "—"}{item.garment_color ? ` / ${item.garment_color}` : ""}</p>}
                    {item.secondary_garment_id && <p className="text-sm text-muted-foreground">Segunda prenda: {item.secondary_garment_size ?? "—"}{item.secondary_garment_color ? ` / ${item.secondary_garment_color}` : ""}</p>}
                    <p className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${item.design_status === "ready" ? "bg-neon-green/10 text-neon-green" : "bg-yellow-500/10 text-yellow-400"}`}>
                      {item.design_status === "ready" && <CheckCircle2 className="h-3.5 w-3.5" />}{designStatusLabel(item.design_status)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
                    <div className="text-left sm:text-right"><p className="font-mono text-xl font-bold">{clp(item.line_total)}</p>{discount > 0 && <p className="text-xs text-neon-green">Ahorras {clp(discount)}</p>}</div>
                    <div className="flex flex-wrap gap-2">
                      <Link to="/personalizador" search={{ editItem: item.id }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"><Pencil className="h-3.5 w-3.5" /> Editar producto</Link>
                      <button type="button" disabled={removeMutation.isPending} onClick={() => {
                        if (window.confirm("¿Eliminar este producto del carrito?")) removeMutation.mutate(item.id);
                      }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-20">
          <h2 className="font-display text-xl font-semibold">Resumen</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <Money label="Subtotal productos" value={clp(cart.order.subtotal_amount)} />
            {cart.order.discount_amount > 0 && <Money label="Descuentos incluidos" value={clp(cart.order.discount_amount)} accent />}
            <Money label="Envío" value={cart.order.shipping_amount === 0 ? "Gratis" : clp(cart.order.shipping_amount)} />
          </dl>
          <div className="mt-5 flex items-end justify-between border-t border-border pt-5"><span>Total</span><strong className="font-mono text-2xl text-neon-green">{clp(cart.order.total_amount)}</strong></div>
          {!ready && <p className="mt-4 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-400">Todos los productos deben tener su diseño listo antes de continuar.</p>}
          <button type="button" disabled={!ready} onClick={() => { trackVisualSkinEvent({event_name:"begin_checkout",order_id:cart.order.id,value:cart.order.total_amount,currency:cart.order.currency,metadata:{item_count:items.length,item_ids:items.map(i=>i.id)}}); void navigate({ to: "/pedido/$id", params: { id: cart.order.id }, search: {} }); }} className="mt-5 w-full rounded-xl bg-neon-blue px-5 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">Continuar con el pedido</button>
        </aside>
      </div>
    </div>
  );
}

function Money({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className={accent ? "text-neon-green" : ""}>{value}</dd></div>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[55vh] max-w-lg flex-col items-center justify-center gap-5 px-4 text-center">{children}</div>;
}
