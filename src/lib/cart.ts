import { queryOptions } from "@tanstack/react-query";
import { getActiveCart } from "@/lib/orders.functions";
import type { ActiveCart } from "@/lib/cart-core";

export * from "@/lib/cart-core";

export const CART_QUERY_KEY = ["cart"] as const;

export const activeCartQueryOptions = () => queryOptions({
  queryKey: CART_QUERY_KEY,
  queryFn: async () => (await getActiveCart()) as ActiveCart | null,
  staleTime: 15_000,
  retry: false,
});
