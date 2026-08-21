import { createFileRoute } from "@tanstack/react-router";
import { CommercialLanding } from "@/components/seo/CommercialLanding";
import { promoPacksQueryOptions } from "@/lib/cms";
import { COMMERCIAL_LANDINGS } from "@/lib/commercial-landings";
import { buildSeoHead } from "@/lib/seo";

const config = COMMERCIAL_LANDINGS["carcasas-personalizadas"];

export const Route = createFileRoute("/carcasas-personalizadas")({
  loader: ({ context }) => context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
  head: () => buildSeoHead({ pathname: "/carcasas-personalizadas", title: config.title, description: config.description }),
  component: CarcasasPersonalizadasPage,
});

function CarcasasPersonalizadasPage() {
  return <CommercialLanding slug="carcasas-personalizadas" initialPacks={Route.useLoaderData()} />;
}
