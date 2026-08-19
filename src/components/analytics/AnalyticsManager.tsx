import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { getConsent, saveConsent } from "@/lib/analytics/identity";
import { initializeAnalyticsProviders, trackVisualSkinEvent } from "@/lib/analytics";

export default function AnalyticsManager(){
  const location=useRouterState({select:s=>s.location}); const [open,setOpen]=useState(false); const [custom,setCustom]=useState(false);
  useEffect(()=>{setOpen(!getConsent());void initializeAnalyticsProviders();const show=()=>{setCustom(true);setOpen(true)};const changed=()=>void initializeAnalyticsProviders();window.addEventListener("visualskin:open-consent",show);window.addEventListener("visualskin:consent",changed);return()=>{window.removeEventListener("visualskin:open-consent",show);window.removeEventListener("visualskin:consent",changed)}},[]);
  useEffect(()=>{trackVisualSkinEvent({event_name:"page_view"})},[location.pathname]);
  if(!open)return null;
  const choose=(analytics:boolean,marketing:boolean)=>{saveConsent({analytics,marketing});setOpen(false);setCustom(false)};
  return <div role="dialog" aria-label="Preferencias de cookies" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-2xl"><h2 className="font-display text-lg font-semibold">Privacidad y cookies</h2><p className="mt-2 text-sm text-muted-foreground">Usamos almacenamiento necesario para que la tienda funcione. Con tu permiso, medimos el uso y activamos píxeles publicitarios.</p>{custom&&<div className="mt-3 text-xs text-muted-foreground">Analítica mide visitas y embudo sin guardar datos personales. Marketing permite Meta, Google Ads y TikTok.</div>}<div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>choose(true,true)} className="rounded-lg bg-neon-blue px-4 py-2 text-sm font-semibold text-black">Aceptar todas</button><button onClick={()=>choose(true,false)} className="rounded-lg border border-border px-4 py-2 text-sm">Solo analítica</button><button onClick={()=>choose(false,false)} className="rounded-lg border border-border px-4 py-2 text-sm">Solo necesarias</button>{!custom&&<button onClick={()=>setCustom(true)} className="px-3 py-2 text-sm text-muted-foreground underline">Ver preferencias</button>}</div></div>;
}
