import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf, usd } from "../../lib/formatters";
import type { UsageReport } from "../../types/api";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function UsagePanel() {
  const { workspace } = useWorkspace();
  const [report, setReport] = useState<UsageReport | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<UsageReport>("/api/usage", workspace, controller.signal)
      .then(setReport)
      .catch((err) => { if ((err as Error).name !== "AbortError") setReport(null); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <section className="usage-panel">
      <div className="usage-header">
        <div>
          <h2>Consumo de IA</h2>
          <p>Estimativa calculada pelos tokens e pesquisas registrados pelo pipeline.</p>
        </div>
        <span id="usage-updated">
          {report && report.trackedRuns
            ? `${report.trackedRuns} execução(ões) medidas · não representa o saldo restante`
            : "Aguardando a primeira execução com medição"}
        </span>
      </div>
      {report && (
        <div className="kpi-row">
          <Kpi label="Gasto neste mês" value={usd.format(report.month.estimatedUsd)} />
          <Kpi label="Custo médio / post" value={usd.format(report.averagePublishedUsd)} />
          <Kpi label="Tokens de entrada" value={nf.format(report.month.inputTokens)} />
          <Kpi label="Tokens de saída" value={nf.format(report.month.outputTokens)} />
          <Kpi label="Pesquisas web" value={nf.format(report.month.webSearchRequests)} />
          <Kpi label="Total registrado" value={usd.format(report.total.estimatedUsd)} />
        </div>
      )}
    </section>
  );
}
