// Attaches X-CSRF-Token from an in-memory store (see order-csrf-store.ts)
// to every outgoing server-fn request. Client-only.
import { createMiddleware } from "@tanstack/react-start";
import { getCsrfTokenForCurrentOrder } from "@/lib/order-csrf-store";

export const attachOrderCsrf = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token =
      typeof window !== "undefined" ? getCsrfTokenForCurrentOrder() : null;
    return next({
      headers: token ? { "X-CSRF-Token": token } : {},
    });
  },
);
