import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { AttributionResult } from "../../types/api";

export function AttributionPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<AttributionResult | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<AttributionResult>("/api/attribution", workspace, controller.signal)
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace]);

  const rows = [...(data?.rows ?? [])].sort((a, b) => b.customers - a.customers || b.activated - a.activated);

  return (
    <section className="usage-panel attribution-panel">
      <div className="usage-header">
        <div>
          <h2>Atribuição: conteúdo → cliente</h2>
          <p>Junta visitas, trials, ativação (1ª Ordem de Serviço) e assinatura por conteúdo. Ordenado por clientes.</p>
        </div>
        <span>{data?.unattributedEvents ? `${data.unattributedEvents} evento(s) sem conteúdo/identidade atribuível` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Nenhum conteúdo publicado com registro de atribuição ainda.</p>
      ) : (
        <div className="perf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conteúdo</th><th>Canal</th><th>Tema</th><th>Visitas</th><th>Trials</th><th>Cadastros</th>
                <th>Ativados</th><th>Clientes</th><th>Visita→Trial</th><th>Trial→Ativação</th><th>Ativação→Cliente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contentId}>
                  <td>{row.contentId}</td>
                  <td>{row.channel}</td>
                  <td>{row.tema}</td>
                  <td>{nf.format(row.visits)}</td>
                  <td>{nf.format(row.trials)}</td>
                  <td>{nf.format(row.signups)}</td>
                  <td>{nf.format(row.activated)}</td>
                  <td>{nf.format(row.customers)}</td>
                  <td>{row.rateReliable ? `${(row.visitToTrialRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                  <td>{row.rateReliable ? `${(row.trialToActivationRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                  <td>{row.rateReliable ? `${(row.activationToCustomerRate * 100).toFixed(1)}%` : "amostra insuficiente"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
