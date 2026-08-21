import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_LEGAL_IDENTITY, DEFAULT_LEGAL_RETURNS, legalIdentityQueryOptions, legalReturnsQueryOptions, useLegalReturns, useLegalIdentity, RETURNS_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";
import { buildSeoHead } from "@/lib/seo";

const TITLE = "Cambios y devoluciones — VISUALSKIN";
const DESCRIPTION = "Política de cambios, devoluciones, garantía y retracto de VISUALSKIN.";

export const Route = createFileRoute("/cambios-y-devoluciones")({
  component: DevolucionesPage,
  loader: async ({ context }) => {
    const [doc, identity] = await Promise.all([
      context.queryClient.ensureQueryData(legalReturnsQueryOptions()).catch(() => DEFAULT_LEGAL_RETURNS),
      context.queryClient.ensureQueryData(legalIdentityQueryOptions()).catch(() => DEFAULT_LEGAL_IDENTITY),
    ]);
    return { doc, identity };
  },
  head: () => buildSeoHead({ pathname: "/cambios-y-devoluciones", title: TITLE, description: DESCRIPTION, type: "article" }),
});

function DevolucionesPage() {
  const initial = Route.useLoaderData();
  const { data: queriedDoc } = useLegalReturns();
  const { data: queriedIdentity } = useLegalIdentity();
  const doc = queriedDoc ?? initial.doc;
  const identity = queriedIdentity ?? initial.identity;
  return <LegalDocView title="Cambios, devoluciones y garantía" doc={doc} spec={RETURNS_SECTIONS} identity={identity} />;
}
