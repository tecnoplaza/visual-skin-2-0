import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Zap, Palette, Truck, ShieldCheck, Star, Smartphone, Shirt } from "lucide-react";
import { packs as fallbackPacks } from "../lib/mock-data";
import { DEFAULT_HOME, homeContentQueryOptions, promoPacksQueryOptions, useHomeContent, usePromoPacks } from "@/lib/cms";
import { buildSeoHead, serializeJsonLd, websiteJsonLd } from "@/lib/seo";

const HOME_TITLE = "VISUALSKIN — Diseña tu pack: carcasa + polera o polerón";
const HOME_DESCRIPTION = "Pack urbano 100% personalizado. Elige tu modelo de celular, sube tu diseño y recíbelo en casa.";

export const Route = createFileRoute("/")({
  component: Home,
  loader: async ({ context }) => {
    const [home, packs] = await Promise.all([
      context.queryClient.ensureQueryData(homeContentQueryOptions()).catch(() => DEFAULT_HOME),
      context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
    ]);
    return { home, packs };
  },
  head: () => buildSeoHead({ pathname: "/", title: HOME_TITLE, description: HOME_DESCRIPTION }),
});

function Home() {
  const initial = Route.useLoaderData();
  const { data: queriedHome } = useHomeContent();
  const { data: queriedPacks } = usePromoPacks(true);
  const home = queriedHome ?? initial.home;
  const cmsPacks = queriedPacks ?? initial.packs;
  const packs = (cmsPacks && cmsPacks.length > 0) ? cmsPacks.map((p) => ({
    id: p.id, name: p.name, tag: p.tag, gradient: p.gradient || "from-blue-500 to-cyan-400",
    price: Number(p.sale_price ?? p.price), image_url: p.image_url, description: p.description,
    button_url: `/personalizador?pack=${encodeURIComponent(p.pack_type)}&id=${p.id}`,
    button_label: p.button_label || "Personalizar",
    type: p.pack_type,
  })) : fallbackPacks.map((p) => ({ ...p, image_url: null as string | null, button_url: "/catalogo", button_label: "Ver", }));


  const sections = home?.sections ?? { hero: true, how_it_works: true, featured_packs: true, why_us: true, cta: true };
  const titleParts = (home?.hero_title?.trim() || DEFAULT_HOME.hero_title).split("\n");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd()) }}
      />
      {sections.hero && (
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-40" />
          <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-neon-blue/20 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-neon-green/20 blur-3xl" />
          <div className="relative mx-auto max-w-7xl px-4 py-20 md:py-32">
            <div className="mx-auto max-w-3xl text-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-neon-green animate-pulse" />
                Envío gratis en packs sobre $35.000
              </div>
              <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
                {titleParts.map((line, i) => (
                  <span key={i}>
                    {i === titleParts.length - 1 && titleParts.length > 1 ? <span className="text-gradient-neon">{line}</span> : line}
                    {i < titleParts.length - 1 && <br />}
                  </span>
                ))}
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground whitespace-pre-line">
                {home?.hero_subtitle}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link to="/crear-mi-pack" className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-6 py-3 font-semibold text-background transition-transform hover:scale-[1.03] glow-blue">
                  {home?.hero_cta_primary ?? "Crear mi pack"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link to="/catalogo" className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-6 py-3 font-semibold text-foreground backdrop-blur hover:bg-secondary">
                  {home?.hero_cta_secondary ?? "Ver catálogo"}
                </Link>
              </div>
            </div>

            {home?.hero_image_url ? (
              <div className="mx-auto mt-16 max-w-3xl">
                <img src={home.hero_image_url} alt={home.hero_title?.trim() || DEFAULT_HOME.hero_title.replace("\n", " ")} decoding="async" fetchPriority="high" className="mx-auto rounded-2xl border border-border" />
              </div>
            ) : (
              <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 md:grid-cols-3">
                {packs.slice(0, 3).map((p, i) => (
                  <div key={p.id} className={`group relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-gradient-to-br ${p.gradient} p-4 transition-transform hover:-translate-y-1 ${i === 1 ? "md:translate-y-6" : ""}`}>
                    {p.image_url && <img src={p.image_url} alt={p.name} decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
                    <div className="absolute inset-0 bg-black/20" />
                    <div className="relative flex h-full flex-col justify-between text-white">
                      <span className="w-fit rounded-full bg-white/20 px-2 py-1 text-[10px] backdrop-blur">{p.tag || "Pack"}</span>
                      <div className="font-display text-lg font-bold">{p.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {sections.how_it_works && (
        <section className="border-t border-border/60 py-20">
          <div className="mx-auto max-w-7xl px-4">
            <div className="mb-12 text-center">
              <h2 className="font-display text-3xl font-bold md:text-4xl">Cómo funciona</h2>
              <p className="mt-2 text-muted-foreground">4 pasos y tu pack va en camino</p>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { icon: Smartphone, title: "Elige tu modelo", desc: "Marca y modelo de celular" },
                { icon: Palette, title: "Sube tu diseño", desc: "Fotos, arte, tipografía" },
                { icon: Shirt, title: "Diseña tu prenda", desc: "Polera o polerón" },
                { icon: Truck, title: "Recibe en casa", desc: "3-5 días hábiles" },
              ].map((s, i) => (
                <div key={i} className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-neon-blue/50">
                  <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-neon-blue/20 to-neon-green/20 text-neon-blue">
                    <s.icon className="h-6 w-6" />
                  </div>
                  <div className="text-xs text-muted-foreground">Paso {i + 1}</div>
                  <h3 className="mt-1 font-display text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.featured_packs && (
        <section className="border-t border-border/60 py-20">
          <div className="mx-auto max-w-7xl px-4">
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2 className="font-display text-3xl font-bold md:text-4xl">Packs destacados</h2>
                <p className="mt-2 text-muted-foreground">Ediciones limitadas y bestsellers</p>
              </div>
              <Link to="/catalogo" className="hidden text-sm text-neon-blue hover:underline md:inline-flex">Ver todo →</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {packs.slice(0, 6).map((p) => (
                <a key={p.id} href={p.button_url} className="group overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-neon-green/50">
                  <div className={`relative aspect-square bg-gradient-to-br ${p.gradient}`}>
                    {p.image_url && <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
                    <div className="absolute inset-0 bg-black/10 transition-opacity group-hover:opacity-0" />
                    {p.tag && (
                      <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2 py-1 text-[10px] font-semibold backdrop-blur">{p.tag}</span>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="font-display font-semibold">{p.name}</div>
                      <div className="font-mono text-sm text-neon-green">${Number(p.price).toLocaleString("es-CL")}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {sections.why_us && (
        <section className="border-t border-border/60 py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-3">
            {(home?.benefits ?? []).slice(0, 6).map((f, i) => {
              const Icon = [Zap, ShieldCheck, Star][i % 3];
              return (
                <div key={i} className="flex gap-4 rounded-2xl border border-border bg-card p-6">
                  <Icon className="h-8 w-8 flex-shrink-0 text-neon-blue" />
                  <div>
                    <div className="font-display font-semibold">{f.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {sections.cta && (
        <section className="relative overflow-hidden border-t border-border/60 py-20">
          <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/10 via-transparent to-neon-green/10" />
          <div className="relative mx-auto max-w-3xl px-4 text-center">
            <h2 className="font-display text-4xl font-bold md:text-5xl">¿Listo para armar el tuyo?</h2>
            <p className="mt-4 text-muted-foreground">Tú diseñas. Nosotros lo hacemos realidad.</p>
            <Link to="/crear-mi-pack" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-8 py-4 text-lg font-semibold text-background glow-green transition-transform hover:scale-[1.03]">
              Empezar ahora <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
