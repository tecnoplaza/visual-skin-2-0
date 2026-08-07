import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useFaqs } from "@/lib/cms";

export const Route = createFileRoute("/faq")({
  component: Faq,
  head: () => ({
    meta: [
      { title: "Preguntas frecuentes — VISUALSKIN" },
      { name: "description", content: "Envíos, tallas, personalización, calidad de impresión y más." },
    ],
  }),
});

function Faq() {
  const { data: items = [] } = useFaqs(true);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl font-bold md:text-5xl">Preguntas frecuentes</h1>
      <p className="mt-2 text-muted-foreground">Todo lo que necesitas saber antes de armar tu pack.</p>

      <div className="mt-10 space-y-3">
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={it.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
                <span className="font-medium">{it.question}</span>
                <ChevronDown className={`h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180 text-neon-blue" : ""}`} />
              </button>
              {isOpen && <div className="border-t border-border px-5 py-4 text-sm text-muted-foreground whitespace-pre-line">{it.answer}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
