// Vitest is invoked on demand in this repository and is not a package dependency.
// @ts-ignore -- the temporary runner supplies this module at test time.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getAnalyticsIdentity, captureAttribution, getConsent, saveConsent } from "./identity";
import { loadMeta, sendMeta } from "./providers/meta";
import { configureGoogleAds, isValidGa4MeasurementId, loadGoogle, mapGoogleEvent, sendGoogle } from "./providers/google";
import { loadTikTok } from "./providers/tiktok";
import { consentAllowsProvider } from "./types";
import { hasPendingSensitiveToken, sanitizedPageLocation } from "./privacy";

class StorageMock { private values=new Map<string,string>(); getItem(k:string){return this.values.get(k)??null} setItem(k:string,v:string){this.values.set(k,String(v))} clear(){this.values.clear()} }
const migration=readFileSync(new URL("../../../supabase/migrations/20260819020000_visualskin_analytics.sql",import.meta.url),"utf8");
const endpoint=readFileSync(new URL("./analytics.functions.ts",import.meta.url),"utf8");
const analyticsClient=readFileSync(new URL("./index.ts",import.meta.url),"utf8");
const analyticsManager=readFileSync(new URL("../../components/analytics/AnalyticsManager.tsx",import.meta.url),"utf8");
describe("VisualSkin analytics privacy and identity",()=>{
  beforeEach(()=>{vi.stubGlobal("localStorage",new StorageMock());vi.stubGlobal("sessionStorage",new StorageMock());vi.stubGlobal("location",{search:"",pathname:"/catalogo"});vi.stubGlobal("document",{referrer:"",head:{appendChild:vi.fn()},createElement:()=>({})});vi.stubGlobal("window",{dispatchEvent:vi.fn()});vi.stubGlobal("crypto",{randomUUID:()=>"12345678-1234-4234-8234-123456789abc"});});
  it("creates stable anonymous and session ids without PII",()=>{const a=getAnalyticsIdentity(),b=getAnalyticsIdentity();expect(a).toEqual(b);expect(a.anonymousId).toMatch(/^vs_a_/);expect(a.sessionId).toMatch(/^vs_s_/);expect(JSON.stringify(a)).not.toMatch(/email|phone|address/i)});
  it("sanitizes and limits UTM values",()=>{vi.stubGlobal("location",{search:`?utm_source=${"x".repeat(200)}&utm_medium=social`,pathname:"/"});const a:any=captureAttribution();expect(a.utm_source).toHaveLength(120);expect(a.utm_medium).toBe("social")});
  it("stores explicit consent categories",()=>{expect(getConsent()).toBeNull();saveConsent({analytics:true,marketing:false});expect(getConsent()).toEqual({necessary:true,analytics:true,marketing:false})});
});
describe("provider loading guards",()=>{
  beforeEach(()=>{vi.stubGlobal("document",{head:{appendChild:vi.fn()},createElement:()=>({})});vi.stubGlobal("window",{location:{origin:"https://www.visualskin.cl",pathname:"/catalogo",search:""}});});
  it("does not load disabled Meta",()=>{loadMeta({provider:"meta",enabled:false,public_id:"12345",conversion_id:null,conversion_label:null});expect((document.head.appendChild as any)).not.toHaveBeenCalled()});
  it("loads configured Meta id once",()=>{const setting={provider:"meta" as const,enabled:true,public_id:"158527017237409",conversion_id:null,conversion_label:null};loadMeta(setting);loadMeta(setting);expect(document.head.appendChild).toHaveBeenCalledTimes(1);expect((document.head.appendChild as any).mock.calls[0][0].src).toBe("https://connect.facebook.net/en_US/fbevents.js");expect((window as any).fbq.queue).toContainEqual(["init","158527017237409"])});
  it("forwards Meta events after the SDK installs callMethod",()=>{loadMeta({provider:"meta",enabled:true,public_id:"158527017237409",conversion_id:null,conversion_label:null});const callMethod=vi.fn();(window as any).fbq.callMethod=callMethod;sendMeta({event_name:"page_view"});expect(callMethod).toHaveBeenCalledWith("track","PageView",expect.any(Object))});
  it("does not load disabled or invalid GA4",()=>{loadGoogle({provider:"ga4",enabled:false,public_id:"G-D88TF5GXW7",conversion_id:null,conversion_label:null});loadGoogle({provider:"ga4",enabled:true,public_id:"not-ga4",conversion_id:null,conversion_label:null});expect(document.head.appendChild).not.toHaveBeenCalled()});
  it("loads and configures the exact GA4 measurement once without automatic page_view",()=>{const setting={provider:"ga4" as const,enabled:true,public_id:"G-D88TF5GXW7",conversion_id:null,conversion_label:null};loadGoogle(setting);loadGoogle(setting);expect(isValidGa4MeasurementId(setting.public_id)).toBe(true);expect(document.head.appendChild).toHaveBeenCalledTimes(1);expect((document.head.appendChild as any).mock.calls[0][0].src).toBe("https://www.googletagmanager.com/gtag/js?id=G-D88TF5GXW7");const calls=(window as any).dataLayer.map((entry:IArguments)=>Array.from(entry));expect(calls.filter((entry:any[])=>entry[0]==="config")).toEqual([["config","G-D88TF5GXW7",{send_page_view:false}]]);expect(calls.flat()).not.toContain("page_view")});
  it("loads Google Ads without requiring GA4",()=>{configureGoogleAds({provider:"google_ads",enabled:true,public_id:null,conversion_id:"AW-123456",conversion_label:"sale"});expect((document.head.appendChild as any)).toHaveBeenCalled();expect((window as any).gtag).toBeTypeOf("function")});
  it("loads configured TikTok",()=>{loadTikTok({provider:"tiktok",enabled:true,public_id:"ABCDEFGHIJKL",conversion_id:null,conversion_label:null});expect((document.head.appendChild as any)).toHaveBeenCalled();expect((window as any).ttq).toBeTruthy()});
  it("does not emit page views while merely loading SDKs",()=>{loadMeta({provider:"meta",enabled:true,public_id:"12345",conversion_id:null,conversion_label:null});expect((window as any).fbq.queue.flat()).not.toContain("PageView")});
});
describe("provider consent contract",()=>{
  it("does not initialize Meta without marketing consent",()=>expect(analyticsClient).toMatch(/if\(consent\.marketing\)\{const meta=/));
  it("allows marketing events without first-party analytics consent",()=>expect(analyticsClient).toContain("if(consent.analytics){const identity="));
  it("keeps GA4 on analytics and Meta on marketing independently",()=>{const analyticsOnly={necessary:true as const,analytics:true,marketing:false};const marketingOnly={necessary:true as const,analytics:false,marketing:true};expect(consentAllowsProvider("ga4",analyticsOnly)).toBe(true);expect(consentAllowsProvider("meta",analyticsOnly)).toBe(false);expect(consentAllowsProvider("ga4",marketingOnly)).toBe(false);expect(consentAllowsProvider("meta",marketingOnly)).toBe(true)});
  it("keeps token URLs blocked and emits one explicit page_view per pathname",()=>{expect(hasPendingSensitiveToken("?token=secret")).toBe(true);expect(hasPendingSensitiveToken("?utm_source=x")).toBe(false);expect(analyticsManager).toContain("if(hasPendingSensitiveToken(location.searchStr))return");expect(analyticsManager).toContain("lastPageViewPath.current===location.pathname")});
});
describe("GA4 event mapping and privacy",()=>{
  beforeEach(()=>{vi.stubGlobal("window",{location:{origin:"https://www.visualskin.cl",pathname:"/pedido/abc",search:"?token=secret&utm_source=x"},dataLayer:[],gtag:vi.fn()});});
  it.each([["view_item","view_item"],["add_to_cart","add_to_cart"],["begin_checkout","begin_checkout"]] as const)("maps %s to %s",(source: "view_item" | "add_to_cart" | "begin_checkout",target: string)=>expect(mapGoogleEvent({event_name:source}).name).toBe(target));
  it("preserves canonical CLP ecommerce values and maps item fields",()=>{const mapped=mapGoogleEvent({event_name:"add_to_cart",value:21990,currency:"CLP",items:[{item_id:"item-1",pack_type:"carcasa+polera",unit_price:21990,quantity:1}]});expect(mapped.parameters).toEqual({value:21990,currency:"CLP",items:[{item_id:"item-1",price:21990,quantity:1}]})});
  it("sanitizes page location and never forwards query tokens or PII",()=>{expect(sanitizedPageLocation()).toBe("https://www.visualskin.cl/pedido/abc");const mapped=mapGoogleEvent({event_name:"page_view",metadata:{source:"test"},email:"private@example.com",token:"secret"} as any);expect(mapped.parameters).toEqual({page_location:"https://www.visualskin.cl/pedido/abc",page_path:"/pedido/abc"});expect(JSON.stringify(mapped)).not.toMatch(/private|secret|token|email|\?/i)});
  it("sends explicit page_view and canonical purchase transaction_id",()=>{sendGoogle({event_name:"page_view"});sendGoogle({event_name:"purchase",order_id:"order-public",value:1000,currency:"CLP"});expect((window as any).gtag).toHaveBeenNthCalledWith(1,"event","page_view",{page_location:"https://www.visualskin.cl/pedido/abc",page_path:"/pedido/abc"});expect((window as any).gtag).toHaveBeenNthCalledWith(2,"event","purchase",{value:1000,currency:"CLP",transaction_id:"order-public"})});
});
describe("database security contract",()=>{
  it("forbids client purchase insertion",()=>expect(migration).toContain("purchase_requires_backend_claim"));
  it("requires approved backend order and canonical totals",()=>{expect(migration).toContain("payment_status='approved'");expect(migration).toContain("v_order.total_amount");expect(migration).toContain("v_order.currency")});
  it("deduplicates purchase by order and payment",()=>{expect(migration).toContain("'purchase:'||v_order.id::text||':'||v_payment");expect(migration).toContain("dedupe_key text not null unique")});
  it("requires an approved backend payment id",()=>{expect(migration).toContain("from public.payment_attempts");expect(migration).toContain("status='approved'");expect(migration).toContain("missing_approved_payment_id");expect(migration).not.toContain("'approved-order'")});
  it("uses approved custom_orders for dashboard revenue",()=>expect(migration).toMatch(/custom_orders where payment_status='approved'/));
  it("restricts event metadata and omits PII columns",()=>{expect(migration).toContain("metadata - array['quantity','item_count','step','source','item_ids']");const eventTable=migration.split("create table if not exists public.analytics_events")[1].split(");")[0];expect(eventTable).not.toMatch(/customer_email|customer_name|customer_phone|shipping_address|authorization|mercado/i)});
  it("keeps analytics admin-only and supports multi-item purchase",()=>{expect(migration).toContain("Admins read analytics events");expect(migration).toContain("from public.order_items where order_id=v_order.id and is_active")});
  it("keeps the insert RPC service-role only",()=>{const grant=migration.match(/grant execute on function public\.track_visualskin_event[^;]+;/i)?.[0]??"";expect(grant).toContain("to service_role");expect(grant).not.toMatch(/anon|authenticated/) });
  it("grants public settings access only to explicit columns",()=>expect(migration).toContain("grant select(provider,enabled,public_id,conversion_id,conversion_label) on public.analytics_settings to anon, authenticated"));
  it("validates and rate-limits the public server endpoint",()=>{expect(endpoint).toContain(".strict()");expect(endpoint).toContain("enforceRateLimit(\"analytics_event\"");expect(endpoint).toContain("assertSameOrigin()")});
});
