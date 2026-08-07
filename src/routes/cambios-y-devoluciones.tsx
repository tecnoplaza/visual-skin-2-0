import { createFileRoute } from "@tanstack/react-router";
import { useLegalReturns, useLegalIdentity, RETURNS_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";

export const Route = createFileRoute("/cambios-y-devoluciones")({
  component: DevolucionesPage,
  head: () => ({
    meta: [
      { title: "Cambios y devoluciones — VISUALSKIN" },
      { name: "description", content: "Política de cambios, devoluciones, garantía y retracto de VISUALSKIN." },
      { property: "og:title", content: "Cambios y devoluciones — VISUALSKIN" },
      { property: "og:description", content: "Política de cambios, devoluciones, garantía y retracto de VISUALSKIN." },
    ],
  }),
});

function DevolucionesPage() {
  const { data: doc } = useLegalReturns();
  const { data: identity } = useLegalIdentity();
  return <LegalDocView title="Cambios, devoluciones y garantía" doc={doc} spec={RETURNS_SECTIONS} identity={identity} />;
}
