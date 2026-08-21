import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_LEGAL_IDENTITY, DEFAULT_LEGAL_PRIVACY, legalIdentityQueryOptions, legalPrivacyQueryOptions, useLegalPrivacy, useLegalIdentity, PRIVACY_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";
import { buildSeoHead } from "@/lib/seo";

const TITLE = "Política de privacidad — VISUALSKIN";
const DESCRIPTION = "Cómo VISUALSKIN trata tus datos personales y qué derechos tienes.";

export const Route = createFileRoute("/privacidad")({
  component: PrivacidadPage,
  loader: async ({ context }) => {
    const [doc, identity] = await Promise.all([
      context.queryClient.ensureQueryData(legalPrivacyQueryOptions()).catch(() => DEFAULT_LEGAL_PRIVACY),
      context.queryClient.ensureQueryData(legalIdentityQueryOptions()).catch(() => DEFAULT_LEGAL_IDENTITY),
    ]);
    return { doc, identity };
  },
  head: () => buildSeoHead({ pathname: "/privacidad", title: TITLE, description: DESCRIPTION, type: "article" }),
});

function PrivacidadPage() {
  const initial = Route.useLoaderData();
  const { data: queriedDoc } = useLegalPrivacy();
  const { data: queriedIdentity } = useLegalIdentity();
  const doc = queriedDoc ?? initial.doc;
  const identity = queriedIdentity ?? initial.identity;
  return <LegalDocView title="Política de privacidad" doc={doc} spec={PRIVACY_SECTIONS} identity={identity} />;
}
