import type { AnalyticsSetting, VisualSkinEvent } from "../types";
declare global { interface Window { dataLayer?: any[]; gtag?: (...args:any[])=>void } }
function ensureGoogleTag(id:string){
  if(window.gtag)return;
  window.dataLayer=window.dataLayer??[]; window.gtag=(...args:any[])=>window.dataLayer!.push(args);
  const s=document.createElement("script"); s.async=true; s.src=`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`; document.head.appendChild(s); window.gtag("js",new Date());
}
export function loadGoogle(setting: AnalyticsSetting) {
  if(!setting.enabled || !setting.public_id) return;
  ensureGoogleTag(setting.public_id);window.gtag!("config",setting.public_id,{send_page_view:false});
}
export function configureGoogleAds(setting: AnalyticsSetting) { if(setting.enabled && setting.conversion_id){ensureGoogleTag(setting.conversion_id);window.gtag!("config",setting.conversion_id);} }
export function sendGoogle(e: VisualSkinEvent, ads?: AnalyticsSetting) { if(!window.gtag) return; window.gtag("event",e.event_name,{value:e.value,currency:e.currency,transaction_id:e.order_id,items:e.items}); if(e.event_name==="purchase" && ads?.enabled && ads.conversion_id && ads.conversion_label) window.gtag("event","conversion",{send_to:`${ads.conversion_id}/${ads.conversion_label}`,value:e.value,currency:e.currency,transaction_id:e.order_id}); }
