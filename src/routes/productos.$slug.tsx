import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { promoPacksQueryOptions } from "@/lib/cms";
import { breadcrumbJsonLd, buildSeoHead, serializeJsonLd, type BreadcrumbEntry } from "@/lib/seo";
import {
  canonicalPromoPackPricing,
  packTypeForProductSlug,
  productJsonLd,
  productPathForPack,
  publicProductImage,
  resolveActiveProduct,
} from "@/lib/product-seo";

export const Route = createFileRoute("/productos/$slug")({
  loader: async ({ context, params }) => {
    if (!packTypeForProductSlug(params.slug)) throw notFound();
    const packs = await context.queryClient.ensureQueryData(promoPacksQueryOptions(true));
    const pack = resolveActiveProduct(params.slug, packs);
    if (!pack) throw notFound();
    return { pack };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { pack } = loaderData;
    const pathname = productPathForPack(pack)!;
    const description = pack.description?.trim() || `Personaliza ${pack.name} en VISUALSKIN.`;
    return buildSeoHead({
      pathname,
      title: `${pack.name} personalizado | VISUALSKIN`,
      description,
      type: "product",
      image: publicProductImage(pack.image_url),
    });
  },
  component: ProductPage,
});

function ProductPage() {
  const { pack } = Route.useLoaderData();
  const pathname = productPathForPack(pack)!;
  const pricing = canonicalPromoPackPricing(pack);
  const image = publicProductImage(pack.image_url);
  const tag = pack.tag?.trim();
  const breadcrumbs: BreadcrumbEntry[] = [
    { name: "Inicio", pathname: "/" },
    { name: "Packs personalizados", pathname: "/packs-personalizados" },
    { name: pack.name, pathname },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [breadcrumbJsonLd(breadcrumbs), productJsonLd(pack, pathname)],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <main className="mx-auto max-w-7xl px-4 py-10 md:py-16">
        <nav aria-label="Migas de pan" className="mb-8 flex flex-wrap gap-2 text-sm text-muted-foreground">
          {breadcrumbs.map((entry, index) => (
            <span key={entry.pathname} className="inline-flex items-center gap-2">
              {index < breadcrumbs.length - 1 ? <Link to={entry.pathname}>{entry.name}</Link> : <span aria-current="page">{entry.name}</span>}
              {index < breadcrumbs.length - 1 && <span aria-hidden="true">/</span>}
            </span>
          ))}
        </nav>

        <article className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div className={`relative aspect-square overflow-hidden rounded-3xl border border-border bg-gradient-to-br ${pack.gradient || "from-neon-blue/20 to-neon-green/20"}`}>
            {image ? (
              <img src={image} alt={pack.name} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
            ) : (
              <div className="h-full w-full" />
            )}
          </div>
          <div className="lg:py-6">
            {tag && <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neon-blue">{tag}</p>}
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">{pack.name}</h1>
            {pack.description && <p className="mt-5 text-lg leading-8 text-muted-foreground">{pack.description}</p>}
            {pricing && (
              <div className="mt-7 flex items-baseline gap-3">
                <strong className="font-mono text-3xl text-neon-green">${pricing.effectivePrice.toLocaleString("es-CL")} CLP</strong>
                {pricing.hasSale && <span className="text-muted-foreground line-through">${pricing.basePrice.toLocaleString("es-CL")}</span>}
              </div>
            )}
            {pack.includes?.length > 0 && (
              <section className="mt-8" aria-labelledby="pack-includes">
                <h2 id="pack-includes" className="font-display text-2xl font-semibold">Qué incluye</h2>
                <ul className="mt-4 space-y-3 text-muted-foreground">
                  {pack.includes.map((item) => <li key={item} className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-neon-green" />{item}</li>)}
                </ul>
              </section>
            )}
            <Link
              to="/personalizador"
              search={{ pack: pack.pack_type, id: pack.id } as any}
              className="mt-9 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-7 py-4 font-semibold text-background"
            >
              Personalizar <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">En el personalizador podrás elegir las opciones disponibles, cargar tu diseño y ajustarlo antes de agregarlo al carrito.</p>
          </div>
        </article>
      </main>
    </>
  );
}
