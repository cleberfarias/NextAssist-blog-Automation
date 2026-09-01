import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf, formatDateTime } from "../../lib/formatters";
import type { ConversionSummary } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

interface AttributionRow {
  origem: string;
  views: number;
  leads: number;
  rate: number;
}

export function ConversionPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ConversionSummary | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<ConversionSummary>("/api/conversions", workspace, controller.signal)
      .then(setData)
      .catch((err) => { if ((err as Error).name !== "AbortError") setData(null); });
    return () => controller.abort();
  }, [workspace]);

  if (!data) {
    return (
      <section className="usage-panel conversion-panel">
        <div className="usage-header">
          <div><h2>Conversões do blog</h2><p>Eventos enviados pelas páginas de conteúdo e demonstração.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const campaigns = (data.byCampaign ?? []).filter((row) => row.campaign !== "(não informado)").slice(0, 5);
  const positions = (data.byContent ?? []).filter((row) => row.content !== "(não informado)").slice(0, 5);
  const rows: AttributionRow[] = [
    ...campaigns.map((row) => ({ origem: `Artigo: ${row.campaign}`, views: row.demoViews, leads: row.leads, rate: row.demoRate })),
    ...positions.map((row) => ({ origem: `Posição: ${row.content}`, views: row.demoViews, leads: row.leads, rate: row.demoRate })),
  ];

  return (
    <section className="usage-panel conversion-panel">
      <div className="usage-header">
        <div><h2>Conversões do blog</h2><p>Eventos enviados pelas páginas de conteúdo e demonstração.</p></div>
        <span>Atualizado {formatDateTime(data.updatedAt)}</span>
      </div>
      <div className="kpi-row">
        <Kpi label="Visitas à demo" value={nf.format(data.demoViews)} />
        <Kpi label="Testes iniciados" value={nf.format(data.demoSubmits)} />
        <Kpi label="Contatos enviados" value={nf.format(data.contactSubmits)} />
        <Kpi label="Cliques WhatsApp" value={nf.format(data.whatsappClicks)} />
        <Kpi label="Trials iniciados" value={nf.format(data.trials)} />
        <Kpi label="Cadastros concluídos" value={nf.format(data.signups)} />
        <Kpi label="Conversão" value={`${(data.demoRate * 100).toFixed(1)}%`} />
      </div>
      {rows.length > 0 && (
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>Origem</th><th>Visitas à demo</th><th>Leads</th><th>Conversão</th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.origem}</td>
                  <td>{nf.format(row.views)}</td>
                  <td>{nf.format(row.leads)}</td>
                  <td>{(row.rate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
