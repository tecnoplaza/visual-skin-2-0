import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { packs as fallbackPacks } from "../lib/mock-data";
import { promoPacksQueryOptions, usePromoPacks } from "@/lib/cms";
import { buildSeoHead } from "@/lib/seo";

const TITLE = "Catálogo — VISUALSKIN";
const DESCRIPTION = "Explora todos nuestros packs urbanos: carcasa + polera o polerón. Ediciones limitadas y bestsellers.";

export const Route = createFileRoute("/catalogo")({
  component: Catalogo,
  loader: ({ context }) => context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
  head: () => buildSeoHead({ pathname: "/catalogo", title: TITLE, description: DESCRIPTION }),
});

const TYPE_LABEL: Record<string, string> = {
  "carcasa": "Solo Carcasa",
  "carcasa+polera": "Carcasa + Polera",
  "carcasa+poleron": "Carcasa + Polerón",
  "carcasa+polera+poleron": "Carcasa + Polera + Polerón",
};

function Catalogo() {
  const initialPacks = Route.useLoaderData();
  const { data: queriedPacks } = usePromoPacks(true);
  const cmsPacks = queriedPacks ?? initialPacks;
  const [filter, setFilter] = useState<string>("all");

  const items = cmsPacks.length > 0
    ? cmsPacks.map((p) => ({
        id: p.id, name: p.name, description: p.description,
        price: Number(p.sale_price ?? p.price),
        basePrice: Number(p.price),
        hasSale: p.sale_price != null && Number(p.sale_price) < Number(p.price),
        image_url: p.image_url, tag: p.tag, gradient: p.gradient || "from-blue-500 to-cyan-400",
        type: p.pack_type,
        cmsId: p.id,
      }))
    : fallbackPacks.map((p) => ({
        id: p.id, name: p.name, description: p.description, price: p.price,
        basePrice: p.price, hasSale: false,
        image_url: null as string | null, tag: p.tag, gradient: p.gradient, type: p.type,
        cmsId: undefined as string | undefined,
      }));

  const filterOptions = [
    { id: "all", label: "Todos" },
    { id: "carcasa", label: "Solo Carcasa" },
    { id: "carcasa+polera", label: "Carcasa + Polera" },
    { id: "carcasa+poleron", label: "Carcasa + Polerón" },
    { id: "carcasa+polera+poleron", label: "Carcasa + Polera + Polerón" },
  ];

  const filtered = items.filter((p) => filter === "all" || p.type === filter);

  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold md:text-5xl">Catálogo</h1>
          <p className="mt-2 text-muted-foreground">Elige un pack o crea el tuyo desde cero.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full border px-4 py-2 text-sm transition-all ${filter === f.id ? "border-neon-blue bg-neon-blue/10 text-neon-blue" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-neon-green/50">
            <div className={`relative aspect-[4/5] bg-gradient-to-br ${p.gradient}`}>
              {p.image_url && <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
              <div className="absolute inset-0 bg-black/10 transition-opacity group-hover:opacity-0" />
              {p.tag && <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2 py-1 text-[10px] font-semibold backdrop-blur">{p.tag}</span>}
              <span className="absolute right-3 top-3 rounded-full bg-background/80 px-2 py-1 text-[10px] font-medium backdrop-blur">
                {TYPE_LABEL[p.type] ?? p.type}
              </span>
            </div>
            <div className="p-5">
              <div className="font-display text-lg font-semibold">{p.name}</div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  {p.hasSale && (
                    <span className="font-mono text-sm text-muted-foreground line-through">${p.basePrice.toLocaleString("es-CL")}</span>
                  )}
                  <span className="font-mono text-lg font-bold text-neon-green">${p.price.toLocaleString("es-CL")}</span>
                </div>
                <Link
                  to="/personalizador"
                  search={{ pack: p.type, ...(p.cmsId ? { id: p.cmsId } : {}) } as any}
                  className="rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background"
                >
                  Personalizar
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
