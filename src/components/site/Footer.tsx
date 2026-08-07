import { Link } from "@tanstack/react-router";
import { Instagram, Facebook, Sparkles } from "lucide-react";
import {
  useContactContent, instagramUrl, facebookUrl,
  useLegalTerms, useLegalPrivacy, useLegalReturns,
} from "@/lib/cms";

export function Footer() {
  const { data: contact } = useContactContent();
  const igUrl = instagramUrl(contact?.instagram);
  const fbUrl = facebookUrl(contact?.facebook);
  const hasSocial = Boolean(igUrl || fbUrl);
  const { data: terms } = useLegalTerms();
  const { data: privacy } = useLegalPrivacy();
  const { data: returns } = useLegalReturns();
  const legalLinks: { to: "/terminos" | "/privacidad" | "/cambios-y-devoluciones"; label: string }[] = [];
  if (terms?.status === "published") legalLinks.push({ to: "/terminos", label: "Términos y condiciones" });
  if (privacy?.status === "published") legalLinks.push({ to: "/privacidad", label: "Política de privacidad" });
  if (returns?.status === "published") legalLinks.push({ to: "/cambios-y-devoluciones", label: "Cambios y devoluciones" });

  return (
    <footer className="border-t border-border/60 bg-background">
      <div className={`mx-auto grid max-w-7xl gap-8 px-4 py-12 ${hasSocial ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        <div>
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-neon-blue to-neon-green text-background">
              <Sparkles className="h-4 w-4" />
            </span>
            VISUAL<span className="text-gradient-neon">SKIN</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Packs urbanos personalizados. Carcasa + polera o polerón, diseñado por ti.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Tienda</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/catalogo" className="hover:text-foreground">Catálogo</Link></li>
            <li><Link to="/crear-mi-pack" className="hover:text-foreground">Crear pack</Link></li>
            <li><Link to="/personalizador" className="hover:text-foreground">Personalizador</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Ayuda</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/faq" className="hover:text-foreground">Preguntas frecuentes</Link></li>
            <li><Link to="/contacto" className="hover:text-foreground">Contacto</Link></li>
          </ul>
        </div>
        {hasSocial && (
          <div>
            <h4 className="text-sm font-semibold">Síguenos</h4>
            <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
              {igUrl && (
                <a
                  href={igUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  <Instagram className="h-4 w-4" /> Instagram
                </a>
              )}
              {fbUrl && (
                <a
                  href={fbUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  <Facebook className="h-4 w-4" /> Facebook
                </a>
              )}
            </div>
          </div>
        )}
      </div>
      {legalLinks.length > 0 && (
        <div className="border-t border-border/60">
          <ul className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-4 text-xs text-muted-foreground">
            {legalLinks.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="hover:text-foreground">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} VISUALSKIN. Todos los derechos reservados.
      </div>
    </footer>
  );
}
