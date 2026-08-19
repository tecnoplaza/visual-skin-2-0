import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, hashBucketKey, ipHashFromRequest, RATE_LIMITS } from "@/lib/rate-limit";

const EventInput=z.object({
  eventName:z.enum(["page_view","view_item","customizer_started","customizer_completed","add_to_cart","remove_from_cart","begin_checkout","add_payment_info","checkout_shipping_completed","payment_rejected"]),
  sessionId:z.string().regex(/^vs_s_[A-Za-z0-9_-]{16,80}$/),anonymousId:z.string().regex(/^vs_a_[A-Za-z0-9_-]{16,80}$/),
  orderId:z.string().uuid().nullish(),orderItemId:z.string().uuid().nullish(),packType:z.string().max(80).nullish(),phoneBrand:z.string().max(120).nullish(),phoneModel:z.string().max(120).nullish(),
  path:z.string().max(300).regex(/^\//),referrerHost:z.string().max(253).nullish(),utmSource:z.string().max(120).nullish(),utmMedium:z.string().max(120).nullish(),utmCampaign:z.string().max(160).nullish(),utmContent:z.string().max(160).nullish(),utmTerm:z.string().max(160).nullish(),
  metadata:z.object({quantity:z.number().int().min(1).max(100).optional(),item_count:z.number().int().min(0).max(100).optional(),step:z.number().int().min(0).max(100).optional(),source:z.string().max(80).optional(),item_ids:z.array(z.string().uuid()).max(100).optional()}).strict().default({}),
}).strict();

export const recordAnalyticsEvent=createServerFn({method:"POST"}).inputValidator(i=>EventInput.parse(i)).handler(async({data})=>{
  assertSameOrigin();const request=getRequest();
  await enforceRateLimit("analytics_event",hashBucketKey(ipHashFromRequest(request),data.anonymousId,data.sessionId),RATE_LIMITS.analytics_event.limit,RATE_LIMITS.analytics_event.window);
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {error}=await supabaseAdmin.rpc("track_visualskin_event" as any,{p_event_name:data.eventName,p_session_id:data.sessionId,p_anonymous_id:data.anonymousId,p_order_id:data.orderId??null,p_order_item_id:data.orderItemId??null,p_pack_type:data.packType??null,p_phone_brand:data.phoneBrand??null,p_phone_model:data.phoneModel??null,p_path:data.path,p_referrer_host:data.referrerHost??null,p_utm_source:data.utmSource??null,p_utm_medium:data.utmMedium??null,p_utm_campaign:data.utmCampaign??null,p_utm_content:data.utmContent??null,p_utm_term:data.utmTerm??null,p_metadata:data.metadata} as any);
  if(error)throw new Error("analytics_event_rejected");return {ok:true as const};
});
const RangeInput=z.object({from:z.string().datetime(),to:z.string().datetime()});
export const getAdminAnalyticsDashboard=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(i=>RangeInput.parse(i)).handler(async({data,context})=>{
  const {data:isAdmin}=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"}); if(!isAdmin)throw new Error("Forbidden");
  const {data:result,error}=await context.supabase.rpc("admin_analytics_dashboard" as any,{p_from:data.from,p_to:data.to} as any); if(error)throw new Error(error.message); return result as any;
});
