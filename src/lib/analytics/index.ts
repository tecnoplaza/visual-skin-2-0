import { supabase } from "@/integrations/supabase/client";
import { captureAttribution, getAnalyticsIdentity, getConsent } from "./identity";
import { consentAllowsProvider, type AnalyticsSetting, type VisualSkinEvent } from "./types";
import { loadMeta, sendMeta } from "./providers/meta";
import { configureGoogleAds, loadGoogle, sendGoogle } from "./providers/google";
import { loadTikTok, sendTikTok } from "./providers/tiktok";
import { claimApprovedPurchase } from "@/lib/orders.functions";
import { recordAnalyticsEvent } from "./analytics.functions";

let settings: AnalyticsSetting[]=[];
let initialization:Promise<void>|null=null;
export async function initializeAnalyticsProviders(){
  if(initialization)return initialization;initialization=(async()=>{const {data}=await (supabase as any).from("analytics_settings").select("provider,enabled,public_id,conversion_id,conversion_label"); settings=(data??[]) as AnalyticsSetting[];
    const consent=getConsent();if(!consent)return;const ga=settings.find(s=>s.provider==="ga4");const ads=settings.find(s=>s.provider==="google_ads");
    if(ga&&consentAllowsProvider("ga4",consent))loadGoogle(ga);if(consent.marketing){const meta=settings.find(s=>s.provider==="meta");const tt=settings.find(s=>s.provider==="tiktok");if(meta)loadMeta(meta);if(tt)loadTikTok(tt);if(ads)configureGoogleAds(ads);}})();
  try{await initialization;}finally{initialization=null;}
}
function dispatchProviders(e:VisualSkinEvent){const c=getConsent();if(!c)return;const ga=settings.find(s=>s.provider==="ga4");const ads=settings.find(s=>s.provider==="google_ads");if(ga?.enabled&&consentAllowsProvider("ga4",c))sendGoogle(e,c.marketing?ads:undefined);if(c.marketing){if(settings.find(s=>s.provider==="meta")?.enabled)sendMeta(e);if(settings.find(s=>s.provider==="tiktok")?.enabled)sendTikTok(e);}}
export function trackVisualSkinEvent(event:VisualSkinEvent):void{
  if(typeof window==="undefined")return; queueMicrotask(async()=>{try{const consent=getConsent();if(!consent)return;
    if(event.event_name==="purchase"){if(!consent.analytics)return;const identity=getAnalyticsIdentity();const result=await claimApprovedPurchase({data:{orderId:event.order_id!,sessionId:identity.sessionId,anonymousId:identity.anonymousId}});if(result?.ok&&!result.deduplicated){await (initialization??initializeAnalyticsProviders());dispatchProviders({...event,value:result.value,currency:result.currency,items:result.items,order_id:result.order_id});}return;}
    if(consent.analytics){const identity=getAnalyticsIdentity();const attr=captureAttribution();const path=location.pathname.slice(0,300);await recordAnalyticsEvent({data:{eventName:event.event_name as Exclude<VisualSkinEvent["event_name"],"purchase">,sessionId:identity.sessionId,anonymousId:identity.anonymousId,orderId:event.order_id??null,orderItemId:event.order_item_id??null,packType:event.pack_type??null,phoneBrand:event.phone_brand??null,phoneModel:event.phone_model??null,path,referrerHost:attr.referrer_host??null,utmSource:attr.utm_source??null,utmMedium:attr.utm_medium??null,utmCampaign:attr.utm_campaign??null,utmContent:attr.utm_content??null,utmTerm:attr.utm_term??null,metadata:event.metadata??{}}});}await (initialization??initializeAnalyticsProviders());dispatchProviders(event);
  }catch{/* analytics must never interrupt commerce */}});
}
