import { createFileRoute } from "@tanstack/react-router";
import { CommercialLanding } from "@/components/seo/CommercialLanding";
import { promoPacksQueryOptions } from "@/lib/cms";
import { COMMERCIAL_LANDINGS } from "@/lib/commercial-landings";
import { buildSeoHead } from "@/lib/seo";

const config = COMMERCIAL_LANDINGS["poleras-personalizadas"];

export const Route = createFileRoute("/poleras-personalizadas")({
  loader: ({ context }) => context.queryClient.ensureQueryData(promoPacksQueryOptions(true)).catch(() => []),
  head: () => buildSeoHead({ pathname: "/poleras-personalizadas", title: config.title, description: config.description }),
  component: PolerasPersonalizadasPage,
});

function PolerasPersonalizadasPage() {
  return <CommercialLanding slug="poleras-personalizadas" initialPacks={Route.useLoaderData()} />;
}
