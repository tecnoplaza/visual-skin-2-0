import type { AnalyticsConsent } from "./types";

const ANON_KEY = "visualskin_analytics_anonymous_id";
const SESSION_KEY = "visualskin_analytics_session";
const UTM_KEY = "visualskin_analytics_attribution";
const CONSENT_KEY = "visualskin_cookie_consent";
const SESSION_MS = 30 * 60 * 1000;
const safeId = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, "")}`;

export function getAnalyticsIdentity(now = Date.now()) {
  if (typeof window === "undefined") return { anonymousId: "", sessionId: "" };
  let anonymousId = localStorage.getItem(ANON_KEY);
  if (!anonymousId?.startsWith("vs_a_")) { anonymousId = safeId("vs_a_"); localStorage.setItem(ANON_KEY, anonymousId); }
  let session: { id: string; touched: number } | null = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null"); } catch { /* reset */ }
  if (!session?.id?.startsWith("vs_s_") || now - session.touched > SESSION_MS) session = { id: safeId("vs_s_"), touched: now };
  else session.touched = now;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { anonymousId, sessionId: session.id };
}

const clean = (value: string | null, max: number) => value?.trim().replace(/[\u0000-\u001f]/g, "").slice(0, max) || undefined;
export function captureAttribution() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(location.search);
  const current = {
    utm_source: clean(q.get("utm_source"), 120), utm_medium: clean(q.get("utm_medium"), 120),
    utm_campaign: clean(q.get("utm_campaign"), 160), utm_content: clean(q.get("utm_content"), 160),
    utm_term: clean(q.get("utm_term"), 160),
  };
  let saved: any = {};
  try { saved = JSON.parse(localStorage.getItem(UTM_KEY) ?? "{}"); } catch { /* ignore */ }
  if (Object.values(current).some(Boolean)) {
    saved = { first: saved.first ?? current, last: current };
    localStorage.setItem(UTM_KEY, JSON.stringify(saved));
  }
  let referrer_host: string | undefined;
  try { referrer_host = document.referrer ? new URL(document.referrer).hostname.slice(0, 253) : undefined; } catch { /* ignore */ }
  return { ...(saved.last ?? current), referrer_host };
}

export function getConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null"); return c && typeof c.analytics === "boolean" && typeof c.marketing === "boolean" ? { necessary: true, analytics: c.analytics, marketing: c.marketing } : null; } catch { return null; }
}
export function saveConsent(consent: Omit<AnalyticsConsent,"necessary">): AnalyticsConsent {
  const value = { necessary: true as const, ...consent }; localStorage.setItem(CONSENT_KEY, JSON.stringify(value)); window.dispatchEvent(new CustomEvent("visualskin:consent", { detail: value })); return value;
}
export const openConsentPreferences = () => window.dispatchEvent(new Event("visualskin:open-consent"));
