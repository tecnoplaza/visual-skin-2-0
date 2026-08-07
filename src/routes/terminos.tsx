import { createFileRoute } from "@tanstack/react-router";
import { useLegalTerms, useLegalIdentity, TERMS_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";

export const Route = createFileRoute("/terminos")({
  component: TerminosPage,
  head: () => ({
    meta: [
      { title: "Términos y condiciones — VISUALSKIN" },
      { name: "description", content: "Términos y condiciones de uso y compra en VISUALSKIN." },
      { property: "og:title", content: "Términos y condiciones — VISUALSKIN" },
      { property: "og:description", content: "Términos y condiciones de uso y compra en VISUALSKIN." },
    ],
  }),
});

function TerminosPage() {
  const { data: doc } = useLegalTerms();
  const { data: identity } = useLegalIdentity();
  return <LegalDocView title="Términos y condiciones" doc={doc} spec={TERMS_SECTIONS} identity={identity} />;
}
