import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { formatDateTime, nf } from "../../lib/formatters";
import type { SalesDashboardResponse, SalesEntry } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function intentLabel(intent: SalesEntry["assessment"]["intent"]): string {
  if (intent === "high") return "Quente";
  if (intent === "medium") return "Médio";
  if (intent === "customer") return "Cliente";
  return "Baixo";
}

function signalLabel(name: string): string {
  const labels: Record<string, string> = {
    site_visit: "visitou o site",
    pricing_view: "viu preços",
    trial_started: "iniciou trial",
    signup_completed: "concluiu cadastro",
    first_order_created: "criou primeira OS",
    subscription_started: "assinou",
    whatsapp_click: "clicou no WhatsApp",
    contact_submit: "enviou contato",
  };
  return labels[name] ?? name;
}

export function SalesPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SalesDashboardResponse | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<SalesDashboardResponse>("/api/sales", workspace, controller.signal)
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace]);

  if (!data) {
    return (
      <section className="usage-panel sales-panel">
        <div className="usage-header">
          <div><h2>Sales Agent</h2><p>Leads priorizados pelo Harness a partir do funil real.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const priority = [...data.entries]
    .filter((entry) => entry.assessment.intent !== "low")
    .sort((a, b) => b.assessment.score - a.assessment.score)
    .slice(0, 12);

  return (
    <section className="usage-panel sales-panel">
      <div className="usage-header">
        <div><h2>Sales Agent</h2><p>Leads reais classificados por intenção. Rascunhos ainda exigem aprovação humana.</p></div>
        <span>{data.updatedAt ? `Atualizado ${formatDateTime(data.updatedAt)}` : "Sem execução salva"}</span>
      </div>

      <div className="kpi-row">
        <Kpi label="Leads" value={nf.format(data.summary.total)} />
        <Kpi label="Quentes" value={nf.format(data.summary.hot)} />
        <Kpi label="Médios" value={nf.format(data.summary.medium)} />
        <Kpi label="Clientes" value={nf.format(data.summary.customers)} />
        <Kpi label="Rascunhos p/ aprovação" value={nf.format(data.summary.draftsPendingApproval)} />
      </div>

      {priority.length === 0 ? (
        <p className="empty-state">Nenhum lead médio ou quente encontrado no último processamento.</p>
      ) : (
        <div className="perf-table-wrap">
          <table>
            <thead>
              <tr><th>Lead</th><th>Score</th><th>Intenção</th><th>Sinais</th><th>Próxima ação</th><th>Rascunho IA</th></tr>
            </thead>
            <tbody>
              {priority.map((entry) => (
                <tr key={entry.lead.leadId}>
                  <td>
                    <strong>{entry.lead.userId ?? entry.lead.anonymousId ?? entry.lead.leadId}</strong>
                    {entry.lead.source ? <div className="muted">Origem: {entry.lead.source}</div> : null}
                  </td>
                  <td><strong>{entry.assessment.score}/100</strong></td>
                  <td>{intentLabel(entry.assessment.intent)}</td>
                  <td>{entry.lead.signals.slice(-4).map((signal) => signalLabel(signal.name)).join(" · ") || "—"}</td>
                  <td>{entry.assessment.nextAction.replaceAll("_", " ")}</td>
                  <td>
                    {entry.outreach ? (
                      <details>
                        <summary>{entry.outreach.requiresHumanApproval ? "Pendente de aprovação" : "Ver rascunho"}</summary>
                        {entry.outreach.subject ? <strong>{entry.outreach.subject}</strong> : null}
                        <p>{entry.outreach.message}</p>
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
