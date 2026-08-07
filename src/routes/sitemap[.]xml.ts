import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const BASE_PATHS = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/catalogo", changefreq: "weekly", priority: "0.9" },
  { path: "/crear-mi-pack", changefreq: "weekly", priority: "0.9" },
  { path: "/personalizador", changefreq: "monthly", priority: "0.7" },
  { path: "/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/contacto", changefreq: "monthly", priority: "0.5" },
];

const LEGAL_PATHS: Record<string, { path: string; changefreq: string; priority: string }> = {
  legal_terms: { path: "/terminos", changefreq: "monthly", priority: "0.4" },
  legal_privacy: { path: "/privacidad", changefreq: "monthly", priority: "0.4" },
  legal_returns: { path: "/cambios-y-devoluciones", changefreq: "monthly", priority: "0.4" },
};

function escapeXml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;

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

        const urls = paths.map(
          (e) =>
            `  <url>\n    <loc>${escapeXml(origin + e.path)}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`
        );
        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");
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
