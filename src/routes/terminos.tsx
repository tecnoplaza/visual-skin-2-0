import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_LEGAL_IDENTITY, DEFAULT_LEGAL_TERMS, legalIdentityQueryOptions, legalTermsQueryOptions, useLegalTerms, useLegalIdentity, TERMS_SECTIONS } from "@/lib/cms";
import { LegalDocView } from "@/components/legal/LegalDocView";
import { buildSeoHead } from "@/lib/seo";

const TITLE = "Términos y condiciones — VISUALSKIN";
const DESCRIPTION = "Términos y condiciones de uso y compra en VISUALSKIN.";

export const Route = createFileRoute("/terminos")({
  component: TerminosPage,
  loader: async ({ context }) => {
    const [doc, identity] = await Promise.all([
      context.queryClient.ensureQueryData(legalTermsQueryOptions()).catch(() => DEFAULT_LEGAL_TERMS),
      context.queryClient.ensureQueryData(legalIdentityQueryOptions()).catch(() => DEFAULT_LEGAL_IDENTITY),
    ]);
    return { doc, identity };
  },
  head: () => buildSeoHead({ pathname: "/terminos", title: TITLE, description: DESCRIPTION, type: "article" }),
});

function TerminosPage() {
  const initial = Route.useLoaderData();
  const { data: queriedDoc } = useLegalTerms();
  const { data: queriedIdentity } = useLegalIdentity();
  const doc = queriedDoc ?? initial.doc;
  const identity = queriedIdentity ?? initial.identity;
  return <LegalDocView title="Términos y condiciones" doc={doc} spec={TERMS_SECTIONS} identity={identity} />;
}
