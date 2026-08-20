import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, X, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import { useVisualContent } from "@/lib/cms";
import {
  activeCartItems,
  activeCartQueryOptions,
  cartItemCount,
  cartItemPreviewSlots,
  cartPackLabel,
  canContinueCart,
  CART_QUERY_KEY,
} from "@/lib/cart";
import { clearActiveCart, getOrderCsrfToken, removeOrderItem } from "@/lib/orders.functions";
import { setOrderCsrfToken } from "@/lib/order-csrf-store";

const nav = [
  { to: "/", label: "Inicio" },
  { to: "/crear-mi-pack", label: "Crear mi pack" },
  { to: "/catalogo", label: "Catálogo" },
  { to: "/personalizador", label: "Personalizador" },
  { to: "/faq", label: "FAQ" },
  { to: "/contacto", label: "Contacto" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const navigate = useNavigate();
  const { data: visual } = useVisualContent();
  const logoUrl = visual?.logo_url?.trim() ?? "";
  const [logoFailed, setLogoFailed] = useState(false);
  const { data: cart } = useQuery(activeCartQueryOptions());
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const itemCount = cartItemCount(cart);
  const items = activeCartItems(cart);
  const removeMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      if (!cart?.order.id) throw new Error("Carrito no disponible");
      const csrf = await getOrderCsrfToken({ data: { orderId: cart.order.id } });
      setOrderCsrfToken(cart.order.id, csrf.csrfToken);
      return removeOrderItem({ data: { orderId: cart.order.id, orderItemId } });
    },
    onMutate: async (orderItemId: string) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<any>(CART_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData(CART_QUERY_KEY, {
          ...previous,
          items: previous.items.filter((item: { id: string }) => item.id !== orderItemId),
        });
      }
      return { previous };
    },
    onError: (_error, _orderItemId, context) => {
      if (context?.previous) queryClient.setQueryData(CART_QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY }),
  });
  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!cart?.order.id) throw new Error("Carrito no disponible");
      const csrf = await getOrderCsrfToken({ data: { orderId: cart.order.id } });
      setOrderCsrfToken(cart.order.id, csrf.csrfToken);
      return clearActiveCart({ data: { orderId: cart.order.id } });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
      const previous = queryClient.getQueryData<any>(CART_QUERY_KEY);
      if (previous) queryClient.setQueryData(CART_QUERY_KEY, { ...previous, items: [] });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(CART_QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY }),
  });

  useEffect(() => {
    if (!cartOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCartOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cartOpen]);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const showCustomLogo = Boolean(logoUrl) && !logoFailed;
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
          {showCustomLogo ? (
            <img
              src={logoUrl}
              alt="VISUALSKIN"
              className="max-h-11 w-auto max-w-[160px] object-contain sm:max-w-[200px]"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-neon-blue to-neon-green text-background">
                <Sparkles className="h-4 w-4" />
              </span>
              <span>
                VISUAL<span className="text-gradient-neon">SKIN</span>
              </span>
            </>
          )}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground bg-secondary" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {!isAdmin && (
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label={`Carrito, ${itemCount} productos`}
              className="relative grid h-10 min-w-10 place-items-center rounded-md border border-border px-2 text-sm"
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-neon-green px-1 text-[10px] font-bold text-black">
                  {itemCount}
                </span>
              )}
            </button>
          )}
          <Link
            to="/crear-mi-pack"
            className="hidden items-center gap-2 rounded-md bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.02] md:inline-flex"
          >
            <ShoppingBag className="h-4 w-4" /> Diseñar pack
          </Link>
          <button
            className="grid h-10 w-10 place-items-center rounded-md border border-border md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border/60 md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground"
                activeProps={{ className: "text-foreground bg-secondary" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
            {!isAdmin && (
              <Link
                to="/carrito"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground"
              >
                <span>Carrito</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{itemCount}</span>
              </Link>
            )}
            <Link
              to="/crear-mi-pack"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background"
            >
              <ShoppingBag className="h-4 w-4" /> Diseñar pack
            </Link>
          </nav>
        </div>
      )}

      {!isAdmin &&
        cartOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Cerrar mini carrito"
              onClick={() => setCartOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-black/50"
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="mini-cart-title"
              className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-[460px] flex-col overflow-hidden border-l border-border bg-background shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
                <div className="min-w-0">
                  <h2 id="mini-cart-title" className="font-display text-lg font-semibold">
                    Tu carrito
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {itemCount} {itemCount === 1 ? "producto" : "productos"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  aria-label="Cerrar carrito"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-5">
                {items.length === 0 ? (
                  <div className="grid min-h-48 place-items-center text-center text-sm text-muted-foreground">
                    <div>
                      <ShoppingBag className="mx-auto mb-3 h-8 w-8" />
                      <p>Tu carrito está vacío.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item) => {
                      const previews = cartItemPreviewSlots(item);
                      return (
                        <article
                          key={item.id}
                          className="flex min-w-0 gap-3 overflow-hidden rounded-xl border border-border p-3"
                        >
                          <div className="grid h-16 w-16 shrink-0 grid-cols-2 gap-1 overflow-hidden rounded-lg bg-secondary p-1">
                            {previews.length > 0 ? (
                              previews
                                .slice(0, 2)
                                .map((preview) => (
                                  <img
                                    key={preview.kind}
                                    src={preview.url}
                                    alt={preview.label}
                                    className="h-full min-w-0 w-full object-contain"
                                  />
                                ))
                            ) : (
                              <span className="col-span-2 grid place-items-center text-center text-[9px] text-muted-foreground">
                                Sin preview
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 justify-between gap-2">
                              <h3 className="min-w-0 truncate text-sm font-semibold">
                                {cartPackLabel(item.pack_type)}
                              </h3>
                              <button
                                type="button"
                                aria-label={`Eliminar ${cartPackLabel(item.pack_type)}`}
                                disabled={removeMutation.isPending}
                                onClick={() => removeMutation.mutate(item.id)}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {[item.brand, item.phone_model].filter(Boolean).join(" · ") ||
                                "Modelo pendiente"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Cantidad: {item.quantity}
                            </p>
                            <p className="mt-1 font-mono text-sm text-neon-green">
                              ${item.line_total.toLocaleString("es-CL")}
                            </p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
              {items.length > 0 && (
                <div className="shrink-0 border-t border-border p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Link
                      to="/crear-mi-pack"
                      onClick={() => setCartOpen(false)}
                      className="min-w-40 flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-medium"
                    >
                      Agregar otro producto
                    </Link>
                    <button
                      type="button"
                      disabled={clearMutation.isPending}
                      onClick={() => {
                        if (window.confirm("¿Quieres eliminar todos los productos de tu carrito?"))
                          clearMutation.mutate();
                      }}
                      className="min-w-40 flex-1 rounded-lg px-3 py-2 text-center text-xs text-muted-foreground underline hover:text-destructive"
                    >
                      Vaciar carrito
                    </button>
                  </div>
                  <div className="mb-4 flex items-center justify-between gap-4 text-sm">
                    <span>Subtotal</span>
                    <strong className="shrink-0 font-mono">
                      ${(cart?.order.subtotal_amount ?? 0).toLocaleString("es-CL")}
                    </strong>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <Link
                      to="/carrito"
                      onClick={() => setCartOpen(false)}
                      className="rounded-xl border border-border px-4 py-3 text-center text-sm font-semibold"
                    >
                      Ver carrito
                    </Link>
                    <button
                      type="button"
                      disabled={!cart || !canContinueCart(cart)}
                      onClick={() => {
                        if (cart)
                          void navigate({
                            to: "/pedido/$id",
                            params: { id: cart.order.id },
                            search: {},
                          });
                        setCartOpen(false);
                      }}
                      className="rounded-xl bg-neon-blue px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </>,
          document.body,
        )}
    </header>
  );
}
