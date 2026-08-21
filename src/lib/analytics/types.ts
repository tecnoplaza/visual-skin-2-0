export type AnalyticsEventName =
  | "page_view" | "view_item" | "customizer_started" | "customizer_completed"
  | "add_to_cart" | "remove_from_cart" | "begin_checkout" | "add_payment_info"
  | "purchase" | "checkout_shipping_completed" | "payment_rejected";

export type AnalyticsConsent = { necessary: true; analytics: boolean; marketing: boolean };
export type Provider = "meta" | "ga4" | "google_ads" | "tiktok";
export function consentAllowsProvider(provider: Provider, consent: AnalyticsConsent): boolean {
  return provider === "ga4" ? consent.analytics : consent.marketing;
}
export type AnalyticsSetting = {
  provider: Provider; enabled: boolean; public_id: string | null;
  conversion_id: string | null; conversion_label: string | null;
};
export type AnalyticsItem = { item_id?: string; pack_type?: string; brand?: string; model?: string; quantity?: number; unit_price?: number };
export type VisualSkinEvent = {
  event_name: AnalyticsEventName; order_id?: string; order_item_id?: string;
  pack_type?: string; phone_brand?: string; phone_model?: string;
  value?: number; currency?: string; items?: AnalyticsItem[];
  metadata?: { quantity?: number; item_count?: number; step?: number; source?: string; item_ids?: string[] };
};

export type AdvertisingMetrics = {
  spend: number; impressions: number; clicks: number; cpc: number; cpm: number;
  conversions_reported: number; revenue_attributed: number; roas: number;
};
