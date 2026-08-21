import { createFileRoute } from "@tanstack/react-router";
import { CommercialLanding } from "@/components/seo/CommercialLanding";
import { promoPacksQueryOptions } from "@/lib/cms";
import { COMMERCIAL_LANDINGS } from "@/lib/commercial-landings";
import { buildSeoHead } from "@/lib/seo";

const config = COMMERCIAL_LANDINGS["packs-personalizados"];

export const Route = createFileRoute("/packs-personalizados")({
  loader: ({ context }) => context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
  head: () => buildSeoHead({ pathname: "/packs-personalizados", title: config.title, description: config.description }),
  component: PacksPersonalizadosPage,
});

function PacksPersonalizadosPage() {
  return <CommercialLanding slug="packs-personalizados" initialPacks={Route.useLoaderData()} />;
}
