import { createFileRoute, Link } from "@tanstack/react-router";
import { Shirt, Package, Smartphone, Loader2 } from "lucide-react";
import { usePromoPacks, type PromoPack } from "@/lib/cms";

export const Route = createFileRoute("/crear-mi-pack")({
  component: CrearPack,
  head: () => ({
    meta: [
      { title: "Crear mi pack — VISUALSKIN" },
      { name: "description", content: "Elige tu combo: solo carcasa, carcasa + polera o carcasa + polerón. 100% personalizado." },
    ],
  }),
});

const ICONS = {
  "carcasa": Smartphone,
  "carcasa+polera": Shirt,
  "carcasa+poleron": Package,
  "carcasa+polera+poleron": Package,
} as const;

const ACCENTS = {
  "carcasa": { grad: "from-neon-green/20 to-transparent", text: "text-neon-green" },
  "carcasa+polera": { grad: "from-neon-blue/20 to-transparent", text: "text-neon-blue" },
  "carcasa+poleron": { grad: "from-neon-green/20 to-transparent", text: "text-neon-green" },
  "carcasa+polera+poleron": { grad: "from-fuchsia-500/20 to-transparent", text: "text-fuchsia-400" },
} as const;

function CrearPack() {
  const { data: packs = [], isLoading } = usePromoPacks(true);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl font-bold md:text-5xl">Crea tu pack</h1>
        <p className="mt-3 text-muted-foreground">Elige el combo que va contigo. Después lo personalizas al 100%.</p>
      </div>

      {isLoading ? (
        <div className="mt-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-neon-blue" /></div>
      ) : packs.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">No hay packs disponibles.</p>
      ) : (
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {packs.map((p) => <PackCard key={p.id} pack={p} />)}
        </div>
      )}
    </section>
  );
}

function PackCard({ pack }: { pack: PromoPack }) {
  const Icon = ICONS[pack.pack_type] ?? Smartphone;
  const { grad, text } = ACCENTS[pack.pack_type] ?? ACCENTS["carcasa+polera"];
  const displayPrice = Number(pack.sale_price ?? pack.price);
  const hasSale = pack.sale_price != null && Number(pack.sale_price) < Number(pack.price);

  return (
    <div className="group relative overflow-hidden rounded-3xl border border-border bg-card p-8 transition-all hover:border-neon-blue/50 hover:-translate-y-1">
      <div className={`absolute inset-0 bg-gradient-to-br ${grad} opacity-40 pointer-events-none`} />
      <div className="relative">
        {pack.image_url ? (
          <img src={pack.image_url} alt="" className="mb-4 h-32 w-full rounded-2xl object-cover" />
        ) : (
          <div className={`inline-grid h-14 w-14 place-items-center rounded-2xl bg-secondary ${text}`}>
            <Icon className="h-7 w-7" />
          </div>
        )}
        {pack.tag && <span className="ml-2 inline-block rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold">{pack.tag}</span>}
        <h2 className="mt-4 font-display text-2xl font-bold">{pack.name}</h2>
        {pack.description && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{pack.description}</p>}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold">${displayPrice.toLocaleString("es-CL")}</span>
          {hasSale && <span className="text-sm text-muted-foreground line-through">${Number(pack.price).toLocaleString("es-CL")}</span>}
          <span className="text-sm text-muted-foreground">CLP</span>
        </div>
        {pack.features?.length > 0 && (
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            {pack.features.map((f) => (
              <li key={f} className="flex gap-2"><span className={text}>▸</span> {f}</li>
            ))}
          </ul>
        )}
        <Link
          to="/personalizador"
          search={{ pack: pack.pack_type, id: pack.id } as any}
          className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-6 py-3 font-semibold text-background transition-transform hover:scale-[1.02]"
        >
          {pack.button_label || "Personalizar este pack"}
        </Link>
      </div>
    </div>
  );
}
