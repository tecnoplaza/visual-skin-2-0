import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ShoppingBag, Sparkles } from "lucide-react";
import { useVisualContent } from "@/lib/cms";

const nav = [
  { to: "/", label: "Inicio" },
  { to: "/crear-mi-pack", label: "Crear mi pack" },
  { to: "/catalogo", label: "Catálogo" },
  { to: "/personalizador", label: "Personalizador" },
  { to: "/faq", label: "FAQ" },
  { to: "/contacto", label: "Contacto" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  const { data: visual } = useVisualContent();
  const logoUrl = visual?.logo_url?.trim() ?? "";
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  const showCustomLogo = Boolean(logoUrl) && !logoFailed;

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
          {showCustomLogo ? (
            <img
              src={logoUrl}
              alt="VISUALSKIN"
              className="max-h-11 w-auto max-w-[160px] object-contain sm:max-w-[200px]"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-neon-blue to-neon-green text-background">
                <Sparkles className="h-4 w-4" />
              </span>
              <span>VISUAL<span className="text-gradient-neon">SKIN</span></span>
            </>
          )}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground bg-secondary" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/crear-mi-pack"
            className="hidden items-center gap-2 rounded-md bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.02] md:inline-flex"
          >
            <ShoppingBag className="h-4 w-4" /> Diseñar pack
          </Link>
          <button
            className="grid h-10 w-10 place-items-center rounded-md border border-border md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border/60 md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground"
                activeProps={{ className: "text-foreground bg-secondary" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
            <Link
              to="/crear-mi-pack"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-neon-blue to-neon-green px-4 py-2 text-sm font-semibold text-background"
            >
              <ShoppingBag className="h-4 w-4" /> Diseñar pack
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
