import { Link } from "@tanstack/react-router";
import type { LegalDoc, LegalIdentity, LegalSectionSpec } from "@/lib/cms";

export function LegalDocView({
  title, doc, spec, identity,
}: {
  title: string;
  doc: LegalDoc | undefined;
  spec: LegalSectionSpec[];
  identity?: LegalIdentity | undefined;
}) {
  const isPublished = doc?.status === "published";
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Volver al inicio</Link>
      <h1 className="mt-4 font-display text-3xl font-bold md:text-4xl">{title}</h1>
      {isPublished && doc?.updated_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          Última actualización: {new Date(doc.updated_at).toLocaleDateString("es-CL")}
        </p>
      )}
      {!isPublished ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
          Este documento se encuentra en preparación y será publicado antes de
          la apertura comercial de VisualSkin.
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {identity && identity.status === "published" && (
            <IdentityBlock identity={identity} />
          )}
          {spec.map((s) => {
            const body = doc.sections[s.key]?.trim();
            if (!body) return null;
            return (
              <section key={s.key}>
                <h2 className="font-display text-xl font-semibold">{s.title}</h2>
                <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {body.split(/\n{2,}/).map((p, i) => (
                    <p key={i} className="whitespace-pre-wrap">{p}</p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IdentityBlock({ identity }: { identity: LegalIdentity }) {
  // El representante legal es un dato interno y nunca se muestra públicamente.
  const rows: [string, string][] = [
    ["Razón social", identity.legal_name],
    ["RUT", identity.rut],
    ["Nombre de fantasía", identity.trade_name],
    ["Domicilio legal", [identity.address, identity.comuna, identity.region].filter(Boolean).join(", ")],
    ["Contacto oficial", identity.official_channel],
    ["Correo", identity.legal_email],
    ["Teléfono / WhatsApp", identity.phone],
  ].filter((r): r is [string, string] => Boolean(r[1] && r[1].trim()));
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">Identidad del vendedor</h2>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
