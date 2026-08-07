import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, MessageCircle, MapPin, Send, Instagram, Facebook, Clock } from "lucide-react";
import {
  useContactContent,
  normalizeEmail,
  normalizeWhatsapp,
  whatsappUrl,
  instagramUrl,
  facebookUrl,
} from "@/lib/cms";

export const Route = createFileRoute("/contacto")({
  component: Contacto,
  head: () => ({
    meta: [
      { title: "Contacto — VISUALSKIN" },
      { name: "description", content: "Escríbenos por WhatsApp o correo. Respondemos en menos de 24h." },
      { property: "og:title", content: "Contacto — VISUALSKIN" },
      { property: "og:description", content: "Escríbenos por WhatsApp o correo. Respondemos en menos de 24h." },
    ],
  }),
});

function Contacto() {
  const { data: contact } = useContactContent();
  const [status, setStatus] = useState<null | "opened" | "no-channel" | "invalid">(null);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const waDigits = normalizeWhatsapp(contact?.whatsapp).value;
  const contactEmail = normalizeEmail(contact?.email).value;
  const igUrl = instagramUrl(contact?.instagram);
  const fbUrl = facebookUrl(contact?.facebook);
  const waLink = whatsappUrl(contact?.whatsapp);

  const cards = [
    contactEmail && { icon: Mail, label: "Email", value: contactEmail, href: `mailto:${contactEmail}` },
    waLink && { icon: MessageCircle, label: "WhatsApp", value: `+${waDigits}`, href: waLink, external: true },
    igUrl && { icon: Instagram, label: "Instagram", value: igUrl.replace(/^https?:\/\//, ""), href: igUrl, external: true },
    fbUrl && { icon: Facebook, label: "Facebook", value: fbUrl.replace(/^https?:\/\//, ""), href: fbUrl, external: true },
    contact?.address?.trim() && { icon: MapPin, label: "Ubicación", value: contact.address.trim(), href: null },
    contact?.hours?.trim() && { icon: Clock, label: "Horario", value: contact.hours.trim(), href: null },
  ].filter(Boolean) as { icon: any; label: string; value: string; href: string | null; external?: boolean }[];

  const hasAnyChannel = Boolean(waLink || contactEmail || igUrl || fbUrl);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const subject = form.subject.trim();
    const message = form.message.trim();

    if (!name || !normalizeEmail(email).value || !message) {
      setStatus("invalid");
      return;
    }

    if (waLink) {
      const lines = [
        `Nombre: ${name}`,
        `Correo: ${email}`,
        subject ? `Asunto: ${subject}` : null,
        "",
        message,
      ].filter(Boolean).join("\n");
      const url = `${waLink}?text=${encodeURIComponent(lines)}`;
      const win = window.open(url, "_blank", "noopener,noreferrer");
      setStatus(win ? "opened" : "no-channel");
      return;
    }

    if (contactEmail) {
      const body = [`Nombre: ${name}`, `Correo: ${email}`, "", message].join("\n");
      const url = `mailto:${contactEmail}?subject=${encodeURIComponent(subject || "Consulta desde VISUALSKIN")}&body=${encodeURIComponent(body)}`;
      window.location.href = url;
      setStatus("opened");
      return;
    }

    setStatus("no-channel");
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h1 className="font-display text-4xl font-bold md:text-5xl">Hablemos</h1>
          <p className="mt-3 text-muted-foreground">¿Dudas con tu pack, pedidos grandes o colaboraciones? Aquí estamos.</p>

          <div className="mt-8 space-y-4">
            {cards.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                Los canales de contacto estarán disponibles próximamente.
              </div>
            )}
            {cards.map((c) => {
              const inner = (
                <>
                  <div className="grid h-12 w-12 place-items-center rounded-lg bg-gradient-to-br from-neon-blue/20 to-neon-green/20 text-neon-blue">
                    <c.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                    <div className="font-medium break-all">{c.value}</div>
                  </div>
                </>
              );
              const cls = "flex items-center gap-4 rounded-xl border border-border bg-card p-4";
              return c.href ? (
                <a
                  key={c.label}
                  href={c.href}
                  {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={cls + " hover:border-neon-blue transition-colors"}
                >
                  {inner}
                </a>
              ) : (
                <div key={c.label} className={cls}>{inner}</div>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-display text-xl font-semibold">Escríbenos</h2>
          <div className="mt-6 space-y-4">
            <Field label="Nombre" name="name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required />
            <Field label="Email" name="email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} required />
            <Field label="Asunto" name="subject" value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: v }))} />
            <div>
              <label htmlFor="message" className="text-xs uppercase tracking-wider text-muted-foreground">Mensaje</label>
              <textarea
                id="message"
                required
                rows={5}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
              />
            </div>

            {status === "opened" && (
              <div className="rounded-lg border border-neon-green/40 bg-neon-green/10 px-3 py-2 text-sm text-foreground">
                Se abrió el canal de contacto con tu mensaje preparado. Revisa y presiona enviar para completar la consulta.
              </div>
            )}
            {status === "invalid" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                Revisa que el nombre, el correo y el mensaje estén completos.
              </div>
            )}
            {status === "no-channel" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                Los canales de contacto aún no están configurados. Inténtalo nuevamente más tarde.
              </div>
            )}

            <button
              type="submit"
              disabled={!hasAnyChannel}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-neon-blue to-neon-green px-5 py-3 font-semibold text-background disabled:opacity-50"
            >
              Abrir canal de contacto <Send className="h-4 w-4" />
            </button>
            {!hasAnyChannel && (
              <p className="text-center text-xs text-muted-foreground">
                Los canales de contacto aún no están configurados.
              </p>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function Field({ label, name, type = "text", required, value, onChange }: { label: string; name: string; type?: string; required?: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={name} className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-neon-blue"
      />
    </div>
  );
}
