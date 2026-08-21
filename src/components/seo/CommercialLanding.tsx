import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Palette, Smartphone, Upload } from "lucide-react";
import { usePromoPacks, type PromoPack } from "@/lib/cms";
import { breadcrumbJsonLd, canonicalUrl, serializeJsonLd, type BreadcrumbEntry } from "@/lib/seo";
import { COMMERCIAL_LANDINGS, packsForLanding, type CommercialLandingSlug } from "@/lib/commercial-landings";
import { canonicalPromoPackPricing, productPathForPack } from "@/lib/product-seo";

type Props = { slug: CommercialLandingSlug; initialPacks: PromoPack[] };

export function CommercialLanding({ slug, initialPacks }: Props) {
  const config = COMMERCIAL_LANDINGS[slug];
  const { data: queriedPacks } = usePromoPacks(true);
  const packs = packsForLanding(slug, queriedPacks ?? initialPacks);
  const ctaSearch = config.ctaPack ? ({ pack: config.ctaPack } as const) : undefined;
  const breadcrumbs: BreadcrumbEntry[] = [
    { name: "Inicio", pathname: "/" },
    ...(slug === "packs-personalizados" ? [] : [{ name: "Packs personalizados", pathname: "/packs-personalizados" }]),
    { name: config.heading, pathname: `/${slug}` },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbJsonLd(breadcrumbs),
      ...(packs.length > 0 ? [{
          "@type": "ItemList",
          name: config.productsHeading,
          itemListElement: packs.map((pack, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: pack.name,
            url: canonicalUrl(productPathForPack(pack) ?? `/${slug}`),
          })),
        }] : []),
      {
        "@type": "FAQPage",
        mainEntity: config.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <main>
        <section className="relative overflow-hidden border-b border-border/60">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-neon-blue/15 blur-3xl" />
          <div className="relative mx-auto max-w-5xl px-4 py-16 text-center md:py-24">
            <nav aria-label="Migas de pan" className="mb-6 flex flex-wrap justify-center gap-2 text-sm text-muted-foreground">
              {breadcrumbs.map((entry, index) => (
                <span key={entry.pathname} className="inline-flex items-center gap-2">
                  {index < breadcrumbs.length - 1 ? <Link to={entry.pathname} className="hover:text-foreground">{entry.name}</Link> : <span aria-current="page">{entry.name}</span>}
                  {index < breadcrumbs.length - 1 && <span aria-hidden="true">/</span>}
                </span>
              ))}
            </nav>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neon-blue">{config.eyebrow}</p>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight md:text-6xl">{config.heading}</h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">{config.introduction}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {config.ctaPack ? (
                <Link to="/personalizador" search={ctaSearch as any} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-6 py-3 font-semibold text-background">
                  {config.ctaLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link to="/crear-mi-pack" className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-6 py-3 font-semibold text-background">
                  {config.ctaLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <Link to="/catalogo" className="rounded-lg border border-border bg-card/70 px-6 py-3 font-semibold">Ver catálogo</Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-bold md:text-4xl">{config.productsHeading}</h2>
            <p className="mt-3 leading-7 text-muted-foreground">{config.productsIntroduction}</p>
          </div>
          {packs.length > 0 ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {packs.map((pack) => <CommercialPackCard key={pack.id} pack={pack} />)}
            </div>
          ) : (
            <div className="mt-10 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No hay packs activos para esta selección en este momento. Puedes revisar el catálogo para ver las opciones disponibles.
            </div>
          )}
        </section>

        <section className="border-y border-border/60 bg-card/30 py-16">
          <div className="mx-auto max-w-7xl px-4">
            <h2 className="text-center font-display text-3xl font-bold">Cómo comenzar</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                { icon: Smartphone, title: "Elige una opción", text: "Selecciona un pack activo y, dentro del flujo, la marca y el modelo disponibles." },
                { icon: Upload, title: "Sube tu diseño", text: "Carga tu imagen y ajústala en el área correspondiente de cada producto." },
                { icon: Palette, title: "Revisa y agrega", text: "Comprueba la vista previa y agrega tu personalización al carrito cuando esté lista." },
              ].map(({ icon: Icon, title, text }) => (
                <article key={title} className="rounded-2xl border border-border bg-card p-6">
                  <Icon className="h-7 w-7 text-neon-blue" />
                  <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 lg:grid-cols-[1fr_1.2fr] lg:py-20">
          <div>
            <h2 className="font-display text-3xl font-bold">Un flujo basado en el catálogo real</h2>
            <ul className="mt-6 space-y-4 text-sm leading-6 text-muted-foreground">
              <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-neon-green" /> El selector utiliza únicamente packs activos publicados por VISUALSKIN.</li>
              <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-neon-green" /> Cada card conserva el nombre, descripción, imagen y precio vigente del catálogo.</li>
              <li className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-neon-green" /> La elección continúa en el personalizador existente, sin crear un catálogo paralelo.</li>
            </ul>
            {slug === "packs-personalizados" && (
              <nav aria-label="Tipos de productos personalizados" className="mt-8 flex flex-wrap gap-2 text-sm">
                <Link to="/carcasas-personalizadas" className="rounded-full border border-border px-4 py-2 hover:border-neon-blue">Carcasas personalizadas</Link>
                <Link to="/poleras-personalizadas" className="rounded-full border border-border px-4 py-2 hover:border-neon-blue">Poleras personalizadas</Link>
                <Link to="/polerones-personalizados" className="rounded-full border border-border px-4 py-2 hover:border-neon-blue">Polerones personalizados</Link>
              </nav>
            )}
          </div>
          <div>
            <h2 className="font-display text-3xl font-bold">Preguntas frecuentes</h2>
            <div className="mt-6 space-y-3">
              {config.faqs.map((faq) => (
                <details key={faq.question} className="group rounded-xl border border-border bg-card p-5">
                  <summary className="cursor-pointer list-none font-semibold">{faq.question}</summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border/60 py-16 text-center">
          <div className="mx-auto max-w-2xl px-4">
            <h2 className="font-display text-3xl font-bold">Empieza con una opción activa</h2>
            <p className="mt-3 text-muted-foreground">Explora el catálogo o entra al flujo de personalización para preparar tu diseño.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to="/crear-mi-pack" className="rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-6 py-3 font-semibold text-background">Crear mi pack</Link>
              <Link to="/faq" className="rounded-lg border border-border px-6 py-3 font-semibold">Ver preguntas frecuentes</Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function CommercialPackCard({ pack }: { pack: PromoPack }) {
  const pricing = canonicalPromoPackPricing(pack);
  const productPath = productPathForPack(pack);
  return (
    <article id={`pack-${pack.id}`} className="flex scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-neon-blue/50 sm:flex-col">
      <Link to={productPath ?? "/packs-personalizados"} className={`relative block aspect-square w-32 shrink-0 bg-gradient-to-br ${pack.gradient || "from-neon-blue/20 to-neon-green/20"} sm:w-full`}>
        {pack.image_url && <img src={pack.image_url} alt={pack.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h3 className="font-display text-lg font-semibold"><Link to={productPath ?? "/packs-personalizados"}>{pack.name}</Link></h3>
        {pack.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{pack.description}</p>}
        {pricing && <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-4">
          <strong className="font-mono text-lg text-neon-green">${pricing.effectivePrice.toLocaleString("es-CL")} CLP</strong>
          {pricing.hasSale && <span className="text-xs text-muted-foreground line-through">${pricing.basePrice.toLocaleString("es-CL")}</span>}
        </div>}
        <Link to="/personalizador" search={{ pack: pack.pack_type, id: pack.id } as any} className="mt-3 inline-flex items-center justify-center rounded-lg border border-neon-blue/50 px-4 py-2 text-sm font-semibold text-neon-blue">
          Personalizar
        </Link>
      </div>
    </article>
  );
}
