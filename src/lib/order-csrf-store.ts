// Client-only in-memory CSRF token store keyed by order id.
// The token is returned by createSecureOrder / exchangeOrderToken and
// refreshed via getOrderCsrfToken. It never lands in localStorage.
type State = { orderId: string | null; token: string | null };
const state: State = { orderId: null, token: null };

export function setOrderCsrfToken(orderId: string, token: string): void {
  state.orderId = orderId;
  state.token = token;
}

export function getCsrfTokenForCurrentOrder(): string | null {
  return state.token;
}

export function clearOrderCsrfToken(): void {
  state.orderId = null;
  state.token = null;
}
