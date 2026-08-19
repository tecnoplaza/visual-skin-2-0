import type { AnalyticsSetting, VisualSkinEvent } from "../types";
declare global { interface Window { fbq?: (...args: any[]) => void; _fbq?: unknown } }
const names: Record<string,string> = { page_view:"PageView",view_item:"ViewContent",add_to_cart:"AddToCart",begin_checkout:"InitiateCheckout",add_payment_info:"AddPaymentInfo",purchase:"Purchase" };
export function loadMeta(setting: AnalyticsSetting) {
  if (!setting.enabled || !setting.public_id || window.fbq) return;
  const fbq: any = (...args:any[]) => { fbq.queue.push(args); }; fbq.queue=[]; fbq.loaded=true; fbq.version="2.0"; window.fbq=fbq;
  const s=document.createElement("script"); s.async=true; s.src="https://connect.facebook.net/en_US/fbevents.js"; document.head.appendChild(s); fbq("init",setting.public_id);
}
export function sendMeta(e: VisualSkinEvent) { const n=names[e.event_name]; if(n && window.fbq) window.fbq("track",n,{ value:e.value,currency:e.currency,content_ids:e.items?.map(i=>i.item_id).filter(Boolean),num_items:e.items?.reduce((n,i)=>n+(i.quantity??1),0) }); }
