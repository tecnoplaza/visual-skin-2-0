import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { renderSitemap } from "@/lib/seo";

export const BASE_PATHS = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/catalogo", changefreq: "weekly", priority: "0.9" },
  { path: "/crear-mi-pack", changefreq: "weekly", priority: "0.9" },
  { path: "/carcasas-personalizadas", changefreq: "weekly", priority: "0.8" },
  { path: "/poleras-personalizadas", changefreq: "weekly", priority: "0.8" },
  { path: "/polerones-personalizados", changefreq: "weekly", priority: "0.8" },
  { path: "/packs-personalizados", changefreq: "weekly", priority: "0.9" },
  { path: "/personalizador", changefreq: "monthly", priority: "0.7" },
  { path: "/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/contacto", changefreq: "monthly", priority: "0.5" },
];

const LEGAL_PATHS: Record<string, { path: string; changefreq: string; priority: string }> = {
  legal_terms: { path: "/terminos", changefreq: "monthly", priority: "0.4" },
  legal_privacy: { path: "/privacidad", changefreq: "monthly", priority: "0.4" },
  legal_returns: { path: "/cambios-y-devoluciones", changefreq: "monthly", priority: "0.4" },
};

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const paths = [...BASE_PATHS];
        try {
          const supabaseUrl = process.env.SUPABASE_URL;
          const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (supabaseUrl && supabaseKey) {
            const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
              auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
            });
            const { data } = await supabase
              .from("site_content")
              .select("key,value")
              .in("key", Object.keys(LEGAL_PATHS));
            for (const row of data ?? []) {
              const spec = LEGAL_PATHS[row.key as keyof typeof LEGAL_PATHS];
              const status = (row.value as any)?.status;
              if (spec && status === "published") paths.push(spec);
            }
          }
        } catch {
          // ignore, base sitemap still returned
        }

        const xml = renderSitemap(paths);
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
