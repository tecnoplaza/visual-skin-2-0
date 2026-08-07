import { createFileRoute } from "@tanstack/react-router";
import { useLegalPrivacy, useLegalIdentity, PRIVACY_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";

export const Route = createFileRoute("/privacidad")({
  component: PrivacidadPage,
  head: () => ({
    meta: [
      { title: "Política de privacidad — VISUALSKIN" },
      { name: "description", content: "Cómo VISUALSKIN trata tus datos personales y qué derechos tienes." },
      { property: "og:title", content: "Política de privacidad — VISUALSKIN" },
      { property: "og:description", content: "Cómo VISUALSKIN trata tus datos personales y qué derechos tienes." },
    ],
  }),
});

function PrivacidadPage() {
  const { data: doc } = useLegalPrivacy();
  const { data: identity } = useLegalIdentity();
  return <LegalDocView title="Política de privacidad" doc={doc} spec={PRIVACY_SECTIONS} identity={identity} />;
}
