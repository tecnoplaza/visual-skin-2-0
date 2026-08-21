import type { AnalyticsItem, AnalyticsSetting, VisualSkinEvent } from "../types";
import { sanitizedPageLocation } from "../privacy";

type GoogleTagState = { scriptIds: Set<string>; configuredIds: Set<string> };
declare global {
  interface Window {
    dataLayer?: IArguments[];
    gtag?: (...args: any[]) => void;
    __visualSkinGoogleTag?: GoogleTagState;
  }
}

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const GOOGLE_ADS_ID = /^AW-[0-9]{5,20}$/;
export const isValidGa4MeasurementId = (value: string | null | undefined): value is string =>
  typeof value === "string" && GA4_ID.test(value);

function googleState(): GoogleTagState {
  return window.__visualSkinGoogleTag ??= { scriptIds: new Set<string>(), configuredIds: new Set<string>() };
}

function ensureGoogleTag(id: string): void {
  const state = googleState();
  window.dataLayer ??= [];
  window.gtag ??= function gtag() { window.dataLayer!.push(arguments); };
  if (state.scriptIds.has(id)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  state.scriptIds.add(id);
  window.gtag("js", new Date());
}

function configureOnce(id: string, parameters?: Record<string, unknown>): void {
  const state = googleState();
  if (state.configuredIds.has(id)) return;
  state.configuredIds.add(id);
  window.gtag!("config", id, parameters);
}

export function loadGoogle(setting: AnalyticsSetting): void {
  if (!setting.enabled || !isValidGa4MeasurementId(setting.public_id)) return;
  ensureGoogleTag(setting.public_id);
  configureOnce(setting.public_id, { send_page_view: false });
}

export function configureGoogleAds(setting: AnalyticsSetting): void {
  if (!setting.enabled || !setting.conversion_id || !GOOGLE_ADS_ID.test(setting.conversion_id)) return;
  ensureGoogleTag(setting.conversion_id);
  configureOnce(setting.conversion_id);
}

const GA4_EVENT_NAMES: Partial<Record<VisualSkinEvent["event_name"], string>> = {
  page_view: "page_view", view_item: "view_item", add_to_cart: "add_to_cart",
  remove_from_cart: "remove_from_cart", begin_checkout: "begin_checkout",
  add_payment_info: "add_payment_info", purchase: "purchase",
};

function googleItem(item: AnalyticsItem): Record<string, string | number> | null {
  const mapped: Record<string, string | number> = {};
  if (item.item_id) mapped.item_id = item.item_id;
  if (typeof item.unit_price === "number") mapped.price = item.unit_price;
  if (typeof item.quantity === "number") mapped.quantity = item.quantity;
  return Object.keys(mapped).length > 0 ? mapped : null;
}

export function mapGoogleEvent(event: VisualSkinEvent): { name: string; parameters: Record<string, unknown> } {
  const parameters: Record<string, unknown> = {};
  if (typeof event.value === "number") parameters.value = event.value;
  if (event.currency) parameters.currency = event.currency;
  const items = event.items?.map(googleItem).filter((item): item is Record<string, string | number> => item !== null);
  if (items?.length) parameters.items = items;
  if (event.event_name === "purchase" && event.order_id) parameters.transaction_id = event.order_id;
  if (event.event_name === "page_view") {
    const pageLocation = sanitizedPageLocation();
    parameters.page_location = pageLocation;
    parameters.page_path = new URL(pageLocation).pathname;
  }
  return { name: GA4_EVENT_NAMES[event.event_name] ?? event.event_name, parameters };
}

export function sendGoogle(event: VisualSkinEvent, ads?: AnalyticsSetting): void {
  if (!window.gtag) return;
  const mapped = mapGoogleEvent(event);
  window.gtag("event", mapped.name, mapped.parameters);
  if (event.event_name === "purchase" && ads?.enabled && ads.conversion_id && ads.conversion_label) {
    window.gtag("event", "conversion", { send_to: `${ads.conversion_id}/${ads.conversion_label}`, value: event.value, currency: event.currency, transaction_id: event.order_id });
  }
}
