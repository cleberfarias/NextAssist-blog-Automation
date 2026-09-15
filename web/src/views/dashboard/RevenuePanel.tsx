import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { RevenueDashboardResponse } from "../../types/api";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function label(value: string): string {
  return value.split("_").join(" ");
}

export function RevenuePanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<RevenueDashboardResponse | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<RevenueDashboardResponse>("/api/revenue", workspace, controller.signal)
      .then(setData)
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setData(null);
      });
    return () => controller.abort();
  }, [workspace]);

  if (!data) {
    return (
      <section className="usage-panel">
        <div className="usage-header">
          <div><h2>Revenue Director</h2><p>Diagnóstico do gargalo comercial.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const { snapshot, decision } = data;
  const target = data.monthlyCustomerTarget;
  const progress = target ? Math.min(100, (snapshot.customers / target) * 100) : null;

  return (
    <section className="usage-panel">
      <div className="usage-header">
        <div>
          <h2>Revenue Director</h2>
          <p>Decisão orientada ao próximo cliente, sem execução automática nesta versão.</p>
        </div>
        <span>{decision.priority.toUpperCase()}</span>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="kpi-label">Visitas</div><div className="kpi-value">{nf.format(snapshot.visits)}</div></div>
        <div className="kpi"><div className="kpi-label">Trials</div><div className="kpi-value">{nf.format(snapshot.trials)}</div></div>
        <div className="kpi"><div className="kpi-label">Ativados</div><div className="kpi-value">{nf.format(snapshot.activated)}</div></div>
        <div className="kpi"><div className="kpi-label">Clientes</div><div className="kpi-value">{nf.format(snapshot.customers)}{target ? ` / ${nf.format(target)}` : ""}</div></div>
        <div className="kpi"><div className="kpi-label">Leads quentes</div><div className="kpi-value">{nf.format(snapshot.hotLeads)}</div></div>
      </div>

      {progress !== null ? (
        <p><strong>Meta mensal:</strong> {progress.toFixed(0)}% concluída ({snapshot.customers}/{target}).</p>
      ) : null}

      <div className="perf-table-wrap">
        <table>
          <tbody>
            <tr><th>Gargalo</th><td>{label(decision.bottleneck)}</td></tr>
            <tr><th>Próxima ação</th><td><strong>{label(decision.action)}</strong></td></tr>
            <tr><th>Motivo</th><td>{decision.reason}</td></tr>
            <tr><th>Visita → trial</th><td>{pct(snapshot.visitToTrialRate)}</td></tr>
            <tr><th>Trial → ativação</th><td>{pct(snapshot.trialToActivationRate)}</td></tr>
            <tr><th>Ativação → cliente</th><td>{pct(snapshot.activationToCustomerRate)}</td></tr>
          </tbody>
        </table>
      </div>

      {decision.evidence.length ? (
        <div>
          <strong>Evidências:</strong>
          <ul>{decision.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
