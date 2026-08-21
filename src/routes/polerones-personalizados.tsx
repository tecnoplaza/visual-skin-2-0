import { createFileRoute } from "@tanstack/react-router";
import { CommercialLanding } from "@/components/seo/CommercialLanding";
import { promoPacksQueryOptions } from "@/lib/cms";
import { COMMERCIAL_LANDINGS } from "@/lib/commercial-landings";
import { buildSeoHead } from "@/lib/seo";

const config = COMMERCIAL_LANDINGS["polerones-personalizados"];

export const Route = createFileRoute("/polerones-personalizados")({
  loader: ({ context }) => context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
  head: () => buildSeoHead({ pathname: "/polerones-personalizados", title: config.title, description: config.description }),
  component: PoleronesPersonalizadosPage,
});

function PoleronesPersonalizadosPage() {
  return <CommercialLanding slug="polerones-personalizados" initialPacks={Route.useLoaderData()} />;
}
