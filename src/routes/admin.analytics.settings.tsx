import { createFileRoute } from "@tanstack/react-router";
import AnalyticsSettingsView from "@/components/admin/AnalyticsSettingsView";
import { AnalyticsNav } from "./admin.analytics";
export const Route=createFileRoute("/admin/analytics/settings")({component:Page,head:()=>({meta:[{title:"Píxeles — Admin VISUALSKIN"},{name:"robots",content:"noindex,nofollow"}]})});
function Page(){return <section className="mx-auto max-w-5xl px-4 py-8"><AnalyticsNav/><AnalyticsSettingsView/></section>}
