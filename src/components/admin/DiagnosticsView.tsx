// §6 Admin diagnostics panel — booleans only, no values.
// Reads adminGetPaymentsDiagnostics; every field is either a boolean or the
// mpEnv label ("test" | "production"). No secrets, no URLs, no hashes.
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { adminGetPaymentsDiagnostics } from "@/lib/orders.functions";

type Diag = Awaited<ReturnType<typeof adminGetPaymentsDiagnostics>>;


function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "text-neon-green" : "text-destructive"}>
        {ok ? (
          <CheckCircle2 className="h-4 w-4" aria-label="sí" />
        ) : (
          <XCircle className="h-4 w-4" aria-label="no" />
        )}
      </span>
    </div>
  );
}

export default function DiagnosticsView() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await adminGetPaymentsDiagnostics();
        if (!cancelled) setDiag(d);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Error al cargar diagnóstico");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  if (err) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
        {err}
      </div>
    );
  }
  if (!diag) {
    return (
      <div className="grid place-items-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg rounded-2xl border border-border bg-card p-6">
      <h2 className="font-display text-lg font-semibold">
        Diagnóstico de pagos
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Solo se muestran indicadores booleanos y el entorno actual. No se
        exponen valores de secretos ni URLs.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Entorno Mercado Pago</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-mono ${
              diag.mpEnv === "production"
                ? "bg-destructive/20 text-destructive"
                : diag.mpEnv === "test"
                  ? "bg-neon-blue/20 text-neon-blue"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {diag.mpEnv ?? "no-configurado"}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <Row label="Payments enabled" ok={diag.paymentsEnabled} />
        <Row label="Credenciales MP presentes" ok={diag.credentialsConfigured} />
        <Row label="Webhook configurado" ok={diag.webhookConfigured} />
        <Row label="Collector configurado" ok={diag.collectorConfigured} />
        <Row
          label="Cron secret presente"
          ok={diag.cronSecretConfigured}
        />
        <Row
          label="CSRF signing secret presente"
          ok={diag.csrfSigningSecretConfigured}
        />
        <Row label="CSP Report-Only activo" ok={diag.cspReportOnly} />
        <Row label="Site origin en HTTPS" ok={diag.siteOriginHttps} />
        <Row
          label="Producción lista para cobrar"
          ok={diag.productionReady}
        />
        <Row
          label="Clave administrativa configurada"
          ok={diag.adminKeyConfigured}
        />
        <div className="flex items-center justify-between border-t border-border py-2 text-sm">
          <span className="text-muted-foreground">
            Tipo de clave administrativa
          </span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-mono ${
              diag.adminKeyType === "secret" ||
              diag.adminKeyType === "legacy_service_role"
                ? "bg-neon-blue/20 text-neon-blue"
                : "bg-destructive/20 text-destructive"
            }`}
          >
            {diag.adminKeyType}
          </span>
        </div>
        <Row
          label="Cliente admin validado"
          ok={diag.adminClientValidated}
        />
      </div>
    </div>
  );
}
