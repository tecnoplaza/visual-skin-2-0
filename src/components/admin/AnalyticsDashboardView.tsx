import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getAdminAnalyticsDashboard } from "@/lib/analytics/analytics.functions";

type Data = { visitors:number; sessions:number; views:number; events:Record<string,number>; sales:{orders:number;revenue:number;average_order_value:number}; products:Array<{pack_type:string;brand:string;phone_model:string;quantity:number}>; sources:Array<{source:string;medium:string;utm_campaign?:string;sessions:number}> };
const empty:Data={visitors:0,sessions:0,views:0,events:{},sales:{orders:0,revenue:0,average_order_value:0},products:[],sources:[]};
const clp=(v:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(v);
const REPORT_TIME_ZONE="America/Santiago";

export function reportRange(days:number,now=new Date()){
  const dateParts=new Intl.DateTimeFormat("en-CA",{timeZone:REPORT_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part=(type:string)=>Number(dateParts.find(p=>p.type===type)?.value);
  const guess=Date.UTC(part("year"),part("month")-1,part("day")-(days-1));
  const zonedParts=new Intl.DateTimeFormat("en-US",{timeZone:REPORT_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
  const z=(type:string)=>Number(zonedParts.find(p=>p.type===type)?.value);
  const represented=Date.UTC(z("year"),z("month")-1,z("day"),z("hour"),z("minute"),z("second"));
  return {from:new Date(guess-(represented-guess)),to:now};
}

export default function AnalyticsDashboardView(){
  const [days,setDays]=useState(7);const [data,setData]=useState<Data>(empty);const [loading,setLoading]=useState(true);
  useEffect(()=>{setLoading(true);const {from,to}=reportRange(days);void getAdminAnalyticsDashboard({data:{from:from.toISOString(),to:to.toISOString()}}).then(r=>setData(r as Data)).finally(()=>setLoading(false))},[days]);
  if(loading)return <Loader2 className="h-6 w-6 animate-spin text-neon-blue"/>;
  const visits=data.events.view_item??data.events.customizer_started??0,adds=data.events.add_to_cart??0,checkouts=data.events.begin_checkout??0,conversion=data.sessions?data.sales.orders/data.sessions*100:0;
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">Analítica VisualSkin</h2><p className="text-sm text-muted-foreground">Ventas reales: pedidos aprobados en backend. Zona horaria: Santiago.</p></div><div className="flex gap-2">{[[1,"Hoy"],[7,"7 días"],[30,"30 días"]].map(([n,l])=><button key={n} onClick={()=>setDays(Number(n))} className={`rounded-lg border px-3 py-2 text-sm ${days===n?"border-neon-blue text-neon-blue":"border-border"}`}>{l}</button>)}</div></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Visitantes" value={data.visitors}/><Metric label="Sesiones" value={data.sessions}/><Metric label="Vistas" value={data.views}/><Metric label="Conversión" value={`${conversion.toFixed(1)}%`}/><Metric label="Compras aprobadas" value={data.sales.orders}/><Metric label="Ventas CLP" value={clp(data.sales.revenue)}/><Metric label="Ticket promedio" value={clp(data.sales.average_order_value)}/><Metric label="Agregar al carrito" value={adds}/></div>
    <section><h3 className="mb-3 font-semibold">Embudo</h3><div className="grid gap-2 md:grid-cols-6">{[["Visitas",data.views],["Producto / personalizador",visits],["Carrito",adds],["Checkout",checkouts],["Pago",data.events.add_payment_info??0],["Compra",data.sales.orders]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="mt-1 text-2xl font-bold">{v}</div></div>)}</div></section>
    <div className="grid gap-5 lg:grid-cols-2"><SimpleTable title="Productos vendidos" heads={["Pack","Marca / modelo","Unidades"]} rows={data.products.slice(0,10).map(x=>[x.pack_type,x.brand?`${x.brand} ${x.phone_model??""}`:"—",x.quantity])}/><SimpleTable title="Fuentes y campañas" heads={["Source / medium","Campaña","Sesiones"]} rows={data.sources.slice(0,10).map(x=>[`${x.source} / ${x.medium}`,x.utm_campaign??"—",x.sessions])}/></div>
    <section><h3 className="font-semibold">Publicidad</h3><p className="mt-1 text-sm text-muted-foreground">Conecta la API publicitaria para visualizar gasto, campañas, CPA y ROAS.</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{["Meta Ads","Google Ads","TikTok Ads"].map(x=><div key={x} className="rounded-xl border border-border bg-card p-4"><b>{x}</b><div className="mt-2 text-sm text-muted-foreground">No conectado</div></div>)}</div></section>
  </div>;
}
function Metric({label,value}:{label:string;value:string|number}){return <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>}
function SimpleTable({title,heads,rows}:{title:string;heads:string[];rows:any[][]}){return <section><h3 className="mb-3 font-semibold">{title}</h3><div className="overflow-auto rounded-xl border border-border"><table className="w-full text-sm"><thead><tr>{heads.map(h=><th key={h} className="p-3 text-left text-xs text-muted-foreground">{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i} className="border-t border-border">{r.map((v,j)=><td key={j} className="p-3">{v}</td>)}</tr>):<tr><td colSpan={heads.length} className="p-5 text-center text-muted-foreground">Sin datos</td></tr>}</tbody></table></div></section>}
